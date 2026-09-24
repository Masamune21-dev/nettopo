/**
 * Klien untuk endpoint yang kompatibel OpenAI (9Router).
 *
 * Semua permintaan lewat /ai/... — dev server Vite yang menyisipkan header
 * Authorization di sisi server, sehingga kunci API tidak pernah sampai ke
 * browser maupun ikut ter-bundle.
 */

import { AI_ACCESS_HEADER, AI_REASON_HEADER } from './aiGuard'

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
/** Server mengatur AI_ACCESS_CODE, jadi pengguna perlu mengisi kode akses. */
export const aiNeedsCode = (): boolean => __AI_NEEDS_CODE__

const ACCESS_KEY = 'nettopo:ai-access'

/** Kode akses yang tersimpan di browser ini (kosong kalau belum diisi). */
export function getAccessCode(): string {
  try {
    return localStorage.getItem(ACCESS_KEY) ?? ''
  } catch {
    return ''
  }
}

export function setAccessCode(code: string): void {
  try {
    if (code) localStorage.setItem(ACCESS_KEY, code)
    else localStorage.removeItem(ACCESS_KEY)
  } catch {
    /* tanpa penyimpanan, kode tetap harus diisi ulang tiap kali */
  }
}

function accessHeaders(): Record<string, string> {
  const code = getAccessCode()
  return code ? { [AI_ACCESS_HEADER]: code } : {}
}

/** Ubah kegagalan HTTP jadi pesan yang bisa dimengerti pengguna. */
async function toError(res: Response): Promise<AiError> {
  if (res.headers.get(AI_REASON_HEADER) === 'access-code') {
    return new AiError('Kode akses salah atau belum diisi — isi kolom "Kode akses" di atas.', res.status)
  }
  // Baca sebagai teks dulu: badan hanya bisa dibaca sekali, dan halaman error
  // HTML (502/504 dari gateway) tetap perlu ditampilkan kalau bukan JSON.
  const raw = await res.text().catch(() => '')
  let detail = raw.trim().slice(0, 300)
  try {
    const obj = JSON.parse(raw) as { error?: { message?: string } | string; message?: string }
    detail =
      (typeof obj.error === 'string' ? obj.error : obj.error?.message) ?? obj.message ?? detail
  } catch {
    /* bukan JSON — pakai teks mentahnya */
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
  const res = await fetch('/ai/models', { signal, headers: accessHeaders() })
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

/** Teks dari satu baris SSE (`data: {...}`); baris lain dan potongan rusak diabaikan. */
function sseLineText(line: string): string {
  if (!line.startsWith('data:')) return ''
  const payload = line.slice(5).trim()
  if (!payload || payload === '[DONE]') return ''
  try {
    return pickContent(JSON.parse(payload) as ChunkShape)
  } catch {
    return ''
  }
}

/**
 * Pecah aliran SSE jadi baris utuh. Mengembalikan baris yang sudah lengkap dan
 * sisa yang belum diakhiri pemisah baris. Menerima \n, \r\n, maupun \r.
 */
function splitSseLines(buffer: string): { lines: string[]; rest: string } {
  const lines = buffer.split(/\r\n|\r|\n/)
  const rest = lines.pop() ?? ''
  return { lines, rest }
}

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
    headers: { 'Content-Type': 'application/json', ...accessHeaders() },
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

    // Tiap baris `data:` berdiri sendiri; baris terakhir bisa belum utuh.
    const { lines, rest } = splitSseLines(buffer)
    buffer = rest
    for (const line of lines) text += sseLineText(line)
    if (text) onChunk?.(text)
  }

  // Sebagian proxy menutup aliran tanpa baris kosong penutup — jangan sampai
  // potongan terakhir hilang.
  buffer += decoder.decode()
  const tail = sseLineText(buffer)
  if (tail) {
    text += tail
    onChunk?.(text)
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
