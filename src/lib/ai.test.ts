import { afterEach, describe, expect, it, vi } from 'vitest'
import { chat } from './ai'

const delta = (content: string) => `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}`

/** Balasan SSE palsu, dikirim per potongan persis seperti yang diberikan. */
function sse(chunks: string[]): Response {
  const encoder = new TextEncoder()
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) controller.enqueue(encoder.encode(c))
      controller.close()
    },
  })
  return new Response(body, { headers: { 'content-type': 'text/event-stream' } })
}

const run = () => chat({ model: 'm', system: 's', user: 'u' })

afterEach(() => vi.unstubAllGlobals())

describe('chat — aliran SSE', () => {
  it('membaca aliran berpemisah \\n\\n yang terpotong di tengah baris', async () => {
    const all = `${delta('Hal')}\n\n${delta('o')}\n\ndata: [DONE]\n\n`
    vi.stubGlobal('fetch', async () => sse([all.slice(0, 20), all.slice(20)]))
    expect(await run()).toBe('Halo')
  })

  it('membaca aliran berpemisah \\r\\n', async () => {
    vi.stubGlobal('fetch', async () => sse([`${delta('A')}\r\n\r\n${delta('B')}\r\n\r\n`]))
    expect(await run()).toBe('AB')
  })

  it('tidak membuang potongan terakhir tanpa baris kosong penutup', async () => {
    vi.stubGlobal('fetch', async () => sse([`${delta('A')}\n\n${delta('B')}`]))
    expect(await run()).toBe('AB')
  })
})

describe('chat — pesan error', () => {
  it('menampilkan isi halaman error yang bukan JSON', async () => {
    vi.stubGlobal('fetch', async () => new Response('Bad Gateway dari upstream', { status: 502 }))
    await expect(run()).rejects.toThrow(/Bad Gateway dari upstream/)
  })

  it('mengambil pesan dari badan error JSON', async () => {
    vi.stubGlobal(
      'fetch',
      async () => new Response(JSON.stringify({ error: { message: 'model tidak ada' } }), { status: 400 }),
    )
    await expect(run()).rejects.toThrow('model tidak ada')
  })
})
