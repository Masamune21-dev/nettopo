/**
 * Penerus permintaan AI untuk lingkungan produksi (Vercel).
 *
 * Perannya sama persis dengan proxy `/ai` di vite.config.ts saat pengembangan:
 * browser memanggil `/ai/...`, fungsi ini yang menempelkan header Authorization
 * lalu meneruskannya. Kunci API tidak pernah dikirim ke browser.
 *
 * Memakai Edge runtime supaya balasan bisa diteruskan apa adanya sebagai
 * aliran — jawaban model yang panjang mulai tampil dalam hitungan detik, tidak
 * menunggu seluruhnya selesai lebih dulu.
 */
export const config = { runtime: 'edge' }

const JSON_HEADERS = { 'Content-Type': 'application/json' }

export default async function handler(request: Request): Promise<Response> {
  const baseUrl = (process.env.AI_BASE_URL ?? '').replace(/\/+$/, '')
  const apiKey = process.env.AI_API_KEY ?? ''

  if (!baseUrl || !apiKey) {
    return new Response(
      JSON.stringify({
        error:
          'Sambungan AI belum diatur di server. Isi AI_BASE_URL dan AI_API_KEY ' +
          'pada Environment Variables, lalu deploy ulang.',
      }),
      { status: 503, headers: JSON_HEADERS },
    )
  }

  const url = new URL(request.url)
  // Terima /ai/... maupun /api/ai/... — keduanya menunjuk fungsi yang sama.
  const path = url.pathname.replace(/^\/(?:api\/)?ai/, '')
  if (!path.startsWith('/')) {
    return new Response(JSON.stringify({ error: 'Jalur tidak dikenal.' }), {
      status: 404,
      headers: JSON_HEADERS,
    })
  }

  const hasBody = request.method !== 'GET' && request.method !== 'HEAD'

  try {
    const upstream = await fetch(`${baseUrl}${path}${url.search}`, {
      method: request.method,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
        Accept: request.headers.get('accept') ?? '*/*',
      },
      body: hasBody ? await request.text() : undefined,
    })

    // Badan balasan diteruskan sebagai aliran, bukan ditunggu selesai dulu.
    return new Response(upstream.body, {
      status: upstream.status,
      headers: {
        'Content-Type': upstream.headers.get('content-type') ?? 'application/json',
        'Cache-Control': 'no-store',
      },
    })
  } catch (error) {
    return new Response(
      JSON.stringify({ error: `Tidak bisa menghubungi endpoint AI: ${(error as Error).message}` }),
      { status: 502, headers: JSON_HEADERS },
    )
  }
}
