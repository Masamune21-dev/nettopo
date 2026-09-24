/**
 * Aturan akses untuk penerus /ai — dipakai bersama oleh fungsi Vercel
 * (api/ai/[...path].ts) dan proxy dev server (vite.config.ts).
 *
 * Penerus itu menempelkan kunci API ke setiap permintaan, jadi tanpa aturan ini
 * siapa pun yang tahu alamatnya bisa memakai kunci tersebut untuk apa saja.
 * Yang diizinkan hanya dua panggilan yang memang dipakai aplikasi, dan hanya
 * dari halaman aplikasi itu sendiri.
 *
 * Catatan: ini menutup penyalahgunaan lewat browser (situs lain) dan endpoint
 * provider selain chat. Orang yang memanggil langsung dengan curl masih bisa
 * memalsukan header Origin — untuk deploy publik, lindungi juga dengan Vercel
 * Deployment Protection atau batasi kuota kunci di sisi provider.
 */

/** Pasangan method + jalur (setelah awalan /ai dibuang) yang boleh diteruskan. */
export const AI_ROUTES: ReadonlySet<string> = new Set(['GET /models', 'POST /chat/completions'])

/** Batas ukuran badan permintaan; konteks topologi besar pun jauh di bawah ini. */
export const AI_MAX_BODY_BYTES = 2_000_000

export interface AiRequestInfo {
  method: string
  /** Jalur tanpa awalan /ai dan tanpa query, mis. "/chat/completions". */
  path: string
  /** Header Host permintaan. */
  host?: string | null
  origin?: string | null
  secFetchSite?: string | null
  contentType?: string | null
  contentLength?: string | null
}

export interface AiRejection {
  status: number
  error: string
}

/** Kembalikan alasan penolakan, atau null kalau permintaan boleh diteruskan. */
export function checkAiRequest(req: AiRequestInfo): AiRejection | null {
  const method = req.method.toUpperCase()
  if (!AI_ROUTES.has(`${method} ${req.path}`)) {
    return { status: 404, error: 'Jalur tidak dikenal.' }
  }

  // Browser modern mengirim Sec-Fetch-Site; permintaan dari situs lain ditolak.
  const site = req.secFetchSite?.toLowerCase()
  if (site && site !== 'same-origin' && site !== 'none') {
    return { status: 403, error: 'Permintaan dari situs lain ditolak.' }
  }
  if (req.origin && req.host) {
    let originHost = ''
    try {
      originHost = new URL(req.origin).host
    } catch {
      /* Origin rusak diperlakukan sebagai asal lain */
    }
    if (originHost !== req.host) {
      return { status: 403, error: 'Permintaan dari situs lain ditolak.' }
    }
  }

  if (method === 'POST') {
    // Mewajibkan JSON juga memaksa preflight CORS untuk permintaan lintas situs.
    if (!req.contentType?.toLowerCase().startsWith('application/json')) {
      return { status: 415, error: 'Badan permintaan harus berupa JSON.' }
    }
    const length = Number(req.contentLength ?? 0)
    if (Number.isFinite(length) && length > AI_MAX_BODY_BYTES) {
      return { status: 413, error: 'Permintaan terlalu besar.' }
    }
  }

  return null
}
