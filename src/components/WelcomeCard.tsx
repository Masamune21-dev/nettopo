import { BookOpen, Cable, MousePointerClick, PackagePlus, SquareTerminal, X } from 'lucide-react'
import type { ReactNode } from 'react'
import { useTopologyStore } from '@/store/useTopologyStore'
import { useUiStore } from '@/store/useUiStore'
import { isDeviceNode } from '@/store/types'

interface Step {
  icon: ReactNode
  title: string
  text: string
}

const STEPS: Step[] = [
  {
    icon: <PackagePlus size={16} />,
    title: 'Taruh perangkat',
    text: 'Seret model dari katalog di kiri ke kanvas.',
  },
  {
    icon: <Cable size={16} />,
    title: 'Sambungkan kabel',
    text: 'Tarik dari titik port kecil di sisi perangkat ke port perangkat lain.',
  },
  {
    icon: <MousePointerClick size={16} />,
    title: 'Atur di panel kanan',
    text: 'Klik perangkat atau kabel untuk mengubah hostname, VLAN, IP, dan trunk.',
  },
  {
    icon: <SquareTerminal size={16} />,
    title: 'Coba lewat CLI',
    text: 'Klik ganda perangkat untuk membuka konsolnya, lalu ketik perintah seperti di perangkat asli.',
  },
]

/**
 * Panduan singkat untuk kunjungan pertama. Muncul di atas kanvas sampai
 * ditutup sekali; bisa dibuka lagi dari panel kanan atau dialog bantuan.
 */
export function WelcomeCard() {
  const open = useUiStore((s) => s.welcomeOpen)
  const setWelcome = useUiStore((s) => s.setWelcome)
  const setUi = useUiStore((s) => s.set)
  // Saran mencoba diarahkan ke perangkat yang memang ada di topologi contoh.
  const hasSample = useTopologyStore((s) => s.nodes.some((n) => isDeviceNode(n) && n.data.hostname === 'SSW-JKT-01'))

  if (!open) return null

  return (
    <div
      className="absolute left-1/2 top-3 z-30 w-[min(640px,calc(100%-24px))] -translate-x-1/2 rounded-xl border p-4 shadow-2xl"
      style={{ background: 'var(--panel)', borderColor: 'var(--border)' }}
      role="dialog"
      aria-label="Mulai di sini"
    >
      <div className="mb-3 flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-[14px] font-semibold">Mulai di sini</h2>
          <p className="mt-0.5 text-[12px] leading-relaxed" style={{ color: 'var(--muted)' }}>
            NetTopo menggambar jaringan sampai ke level port, lalu bisa diuji lewat CLI seperti Packet Tracer.
          </p>
        </div>
        <button
          type="button"
          className="rounded p-1 hover:bg-black/5 dark:hover:bg-white/10"
          onClick={() => setWelcome(false)}
          title="Tutup panduan"
          aria-label="Tutup panduan"
        >
          <X size={14} />
        </button>
      </div>

      <ol className="grid gap-2 sm:grid-cols-2">
        {STEPS.map((s, i) => (
          <li
            key={s.title}
            className="flex gap-2.5 rounded-lg border p-2.5"
            style={{ borderColor: 'var(--border)', background: 'var(--panel-2)' }}
          >
            <span
              className="flex size-8 shrink-0 items-center justify-center rounded-md"
              style={{ background: '#4f46e51f', color: '#818cf8' }}
            >
              {s.icon}
            </span>
            <span className="min-w-0">
              <span className="block text-[12px] font-semibold">
                {i + 1}. {s.title}
              </span>
              <span className="block text-[11.5px] leading-snug" style={{ color: 'var(--muted)' }}>
                {s.text}
              </span>
            </span>
          </li>
        ))}
      </ol>

      {hasSample ? (
        <p
          className="mt-3 rounded-md border px-2.5 py-2 text-[11.5px] leading-relaxed"
          style={{ borderColor: '#0ea5e955', background: '#0ea5e912' }}
        >
          <strong>Coba sekarang:</strong> klik ganda <span className="font-mono">SSW-JKT-01</span>, lalu ketik{' '}
          <code className="rounded bg-black/10 px-1 font-mono dark:bg-white/10">ping 10.255.0.5</code> dan tekan Enter.
          Zoom dengan <kbd className="font-mono">Alt/⌥ + scroll</kbd> supaya nama perangkat terbaca.
        </p>
      ) : null}

      <div className="mt-3 flex items-center justify-end gap-2">
        <button
          type="button"
          className="btn"
          onClick={() => {
            setWelcome(false)
            setUi('helpOpen', true)
          }}
        >
          <BookOpen size={13} /> Bantuan lengkap
        </button>
        <button type="button" className="btn btn-primary" onClick={() => setWelcome(false)}>
          Mengerti
        </button>
      </div>
    </div>
  )
}
