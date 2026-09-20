/**
 * Klien untuk endpoint yang kompatibel OpenAI (9Router).
 *
 * Semua permintaan lewat /ai/... — dev server Vite yang menyisipkan header
 * Authorization di sisi server, sehingga kunci API tidak pernah sampai ke
 * browser maupun ikut ter-bundle.
 */

export interface AiModel {
  id: string
  owned_by?: string
}

export class AiError extends Error {
  status?: number

  constructor(message: string, status?: number) {
    super(message)
    this.name = 'AiError'
    this.status = status
  }
}

export const aiReady = (): boolean => __AI_READY__
export const aiDefaultModel = (): string => __AI_DEFAULT_MODEL__

/** Ubah kegagalan HTTP jadi pesan yang bisa dimengerti pengguna. */
async function toError(res: Response): Promise<AiError> {
  let detail = ''
  try {
    const body: unknown = await res.json()
    const obj = body as { error?: { message?: string } | string; message?: string }
    detail =
      (typeof obj.error === 'string' ? obj.error : obj.error?.message) ?? obj.message ?? ''
  } catch {
    detail = await res.text().catch(() => '')
  }

  const hint =
    res.status === 401 || res.status === 403
      ? 'Kunci API ditolak — periksa AI_API_KEY di berkas .env, lalu jalankan ulang `npm run dev`.'
      : res.status === 404
        ? 'Endpoint tidak ditemukan — periksa AI_BASE_URL di .env.'
        : res.status === 429
          ? 'Kuota atau batas laju provider tercapai.'
          : res.status >= 500
            ? 'Server AI sedang bermasalah.'
            : ''

  return new AiError([hint, detail].filter(Boolean).join(' ') || `HTTP ${res.status}`, res.status)
}

export async function listModels(signal?: AbortSignal): Promise<AiModel[]> {
  const res = await fetch('/ai/models', { signal })
  if (!res.ok) throw await toError(res)
  const body = (await res.json()) as { data?: AiModel[]; models?: AiModel[] }
  const list = body.data ?? body.models ?? []
  return list.filter((m) => typeof m.id === 'string').sort((a, b) => a.id.localeCompare(b.id))
}

export interface ChatOptions {
  model: string
  system: string
  user: string
  /** Minta balasan berupa JSON saja. */
  json?: boolean
  temperature?: number
  signal?: AbortSignal
  /** Dipanggil tiap potongan teks datang, berisi teks lengkap sejauh ini. */
  onChunk?: (textSoFar: string) => void
}

/** Satu potongan balasan bergaya OpenAI, baik streaming maupun tidak. */
interface ChunkShape {
  choices?: {
    delta?: { content?: string | null }
    message?: { content?: string | null }
  }[]
}

const pickContent = (obj: ChunkShape): string =>
  obj.choices?.[0]?.delta?.content ?? obj.choices?.[0]?.message?.content ?? ''

/**
 * Kirim percakapan dan kembalikan teks lengkapnya.
 *
 * Endpoint bisa membalas dua bentuk: satu objek JSON, atau aliran SSE
 * (`data: {...}` baris demi baris). 9Router memakai SSE secara bawaan, jadi
 * keduanya ditangani di sini — sekaligus memberi umpan balik bertahap lewat
 * `onChunk` supaya keluaran panjang tidak terasa menggantung.
 */
export async function chat({
  model,
  system,
  user,
  json = false,
  temperature = 0.2,
  signal,
  onChunk,
}: ChatOptions): Promise<string> {
  const res = await fetch('/ai/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal,
    body: JSON.stringify({
      model,
      temperature,
      stream: true,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      ...(json ? { response_format: { type: 'json_object' } } : {}),
    }),
  })
  if (!res.ok) throw await toError(res)

  const isStream = (res.headers.get('content-type') ?? '').includes('text/event-stream')
  if (!isStream || !res.body) {
    const body = (await res.json()) as ChunkShape
    const content = pickContent(body)
    if (!content) throw new AiError('Model tidak mengembalikan jawaban.')
    onChunk?.(content)
    return content
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let text = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })

    // Kejadian SSE dipisahkan baris kosong; potongan terakhir bisa belum utuh.
    const events = buffer.split('\n\n')
    buffer = events.pop() ?? ''

    for (const event of events) {
      for (const line of event.split('\n')) {
        if (!line.startsWith('data:')) continue
        const payload = line.slice(5).trim()
        if (!payload || payload === '[DONE]') continue
        try {
          text += pickContent(JSON.parse(payload) as ChunkShape)
        } catch {
          // Potongan rusak diabaikan; sisanya tetap terbaca.
        }
      }
    }
    if (text) onChunk?.(text)
  }

  if (!text) throw new AiError('Model tidak mengembalikan jawaban.')
  return text
}

/**
 * Ambil objek JSON dari balasan model. Sebagian model membungkusnya dalam
 * blok ```json atau menambahi kalimat pengantar, jadi tidak bisa langsung
 * di-JSON.parse.
 */
export function extractJson(text: string): unknown {
  const trimmed = text.trim()
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(trimmed)
  const candidates = [fenced?.[1], trimmed].filter((c): c is string => Boolean(c))

  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate)
    } catch {
      // Coba potong dari kurung pertama sampai kurung terakhir yang cocok.
      const start = candidate.search(/[[{]/)
      const end = Math.max(candidate.lastIndexOf('}'), candidate.lastIndexOf(']'))
      if (start >= 0 && end > start) {
        try {
          return JSON.parse(candidate.slice(start, end + 1))
        } catch {
          /* lanjut ke kandidat berikutnya */
        }
      }
    }
  }
  throw new AiError('Balasan model bukan JSON yang bisa dibaca.')
}
