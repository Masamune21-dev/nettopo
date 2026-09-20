import { Dialog } from '@/components/Dialog'
import { useUiStore } from '@/store/useUiStore'

const isMac = navigator.platform.toLowerCase().includes('mac')
const mod = isMac ? '⌘' : 'Ctrl'

const SHORTCUTS: [string, string][] = [
  [`${mod} S`, 'Simpan topologi ke browser'],
  [`${mod} Z`, 'Undo'],
  [`Shift ${mod} Z`, 'Redo'],
  [`${mod} D`, 'Duplikat yang terpilih'],
  ['Delete / Backspace', 'Hapus yang terpilih'],
  ['Klik kanan', 'Menu tambah area / catatan'],
  ['Scroll', 'Geser kanvas · ⌥/Alt + scroll untuk zoom'],
  ['Drag kiri', 'Seleksi kotak'],
  ['Drag tengah / kanan', 'Geser kanvas'],
  ['?', 'Buka bantuan ini'],
]

export function HelpDialog() {
  const open = useUiStore((s) => s.helpOpen)
  const setUi = useUiStore((s) => s.set)
  if (!open) return null

  return (
    <Dialog title="Cara pakai & pintasan" onClose={() => setUi('helpOpen', false)}>
      <section className="mb-4">
        <h3 className="mb-1.5 text-[12px] font-semibold">Menggambar topologi</h3>
        <ol className="list-decimal space-y-1 pl-4 text-[12px] leading-relaxed" style={{ color: 'var(--muted)' }}>
          <li>Seret perangkat dari panel kiri ke kanvas (atau klik untuk menaruh di tengah).</li>
          <li>
            Tarik dari kotak port kecil di sisi node ke port perangkat lain untuk membuat kabel. Port yang
            sudah terpakai tidak bisa dipakai dua kali.
          </li>
          <li>Klik perangkat atau kabel untuk mengubah hostname, IP, nama port, VLAN, dan kecepatan di panel kanan.</li>
          <li>
            Perangkat dengan port banyak tampil ringkas — klik tanda ▸ di pojok kanan atas node untuk
            menampilkan semua portnya.
          </li>
          <li>Selesai? Tekan Simpan, lalu Ekspor ke PNG/SVG untuk laporan atau JSON untuk cadangan.</li>
        </ol>
      </section>

      <section>
        <h3 className="mb-1.5 text-[12px] font-semibold">Pintasan keyboard</h3>
        <ul className="space-y-1">
          {SHORTCUTS.map(([key, desc]) => (
            <li key={key} className="flex items-center gap-3 text-[12px]">
              <kbd
                className="min-w-[110px] rounded border px-1.5 py-0.5 text-center font-mono text-[10.5px]"
                style={{ borderColor: 'var(--border)', background: 'var(--panel-2)' }}
              >
                {key}
              </kbd>
              <span style={{ color: 'var(--muted)' }}>{desc}</span>
            </li>
          ))}
        </ul>
      </section>
    </Dialog>
  )
}
