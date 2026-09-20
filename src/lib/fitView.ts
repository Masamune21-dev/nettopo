import type { FitViewOptions } from '@xyflow/react'

export type FitViewFn = (options?: FitViewOptions) => Promise<boolean>

/**
 * `fitView` diam-diam gagal selama node belum selesai diukur — misalnya tepat
 * setelah aplikasi dibuka, atau setelah auto-layout memindahkan port sehingga
 * tinggi node berubah. Di sinilah panggilannya diulang sampai berhasil,
 * bukan menebak-nebak lewat satu setTimeout.
 */
export async function fitViewWhenReady(
  fitView: FitViewFn,
  options: FitViewOptions = { padding: 0.18, duration: 300 },
  attempts = 10,
  gapMs = 150,
): Promise<boolean> {
  for (let i = 0; i < attempts; i += 1) {
    // Percobaan pertama tanpa animasi supaya tidak berkedip kalau langsung berhasil.
    const ok = await fitView(i === 0 ? { ...options, duration: 0 } : options)
    if (ok) return true
    await new Promise((resolve) => setTimeout(resolve, gapMs))
  }
  return false
}
