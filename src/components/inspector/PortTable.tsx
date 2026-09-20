import { Plus, Trash2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTopologyStore } from '@/store/useTopologyStore'
import type { DeviceNode } from '@/store/types'
import { MEDIA, SPEED_COLOR, SPEEDS } from '@/types/topology'

export function PortTable({ device }: { device: DeviceNode }) {
  const edges = useTopologyStore((s) => s.edges)
  const updatePort = useTopologyStore((s) => s.updatePort)
  const addPort = useTopologyStore((s) => s.addPort)
  const removePort = useTopologyStore((s) => s.removePort)
  const [onlyUsed, setOnlyUsed] = useState(false)
  const [filter, setFilter] = useState('')

  const used = useMemo(() => {
    const set = new Set<string>()
    for (const e of edges) {
      if (e.source === device.id && e.sourceHandle) set.add(e.sourceHandle)
      if (e.target === device.id && e.targetHandle) set.add(e.targetHandle)
    }
    return set
  }, [edges, device.id])

  const q = filter.trim().toLowerCase()
  const shown = device.data.ports.filter(
    (p) =>
      (!onlyUsed || used.has(p.id)) &&
      (!q || p.name.toLowerCase().includes(q) || p.description.toLowerCase().includes(q)),
  )

  return (
    <section>
      <div className="mb-1.5 flex items-center justify-between">
        <span className="label mb-0">
          Port ({used.size}/{device.data.ports.length} terpakai)
        </span>
        <button type="button" className="btn px-1.5 py-0.5 text-[11px]" onClick={() => addPort(device.id)}>
          <Plus size={11} /> Tambah
        </button>
      </div>

      <div className="mb-1.5 flex items-center gap-1.5">
        <input
          className="field py-0.5 text-[11px]"
          placeholder="Saring port…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
        <button
          type="button"
          className="btn shrink-0 px-1.5 py-0.5 text-[11px]"
          onClick={() => setOnlyUsed((v) => !v)}
          style={{ color: onlyUsed ? '#4f46e5' : undefined }}
          title="Tampilkan hanya port yang terpakai"
        >
          Terpakai
        </button>
      </div>

      <ul
        className="thin-scroll max-h-[44vh] space-y-1 overflow-y-auto rounded-md border p-1"
        style={{ borderColor: 'var(--border)' }}
      >
        {shown.length === 0 ? (
          <li className="py-3 text-center text-[11px]" style={{ color: 'var(--muted)' }}>
            Tidak ada port yang cocok.
          </li>
        ) : null}

        {shown.map((p) => {
          const isUsed = used.has(p.id)
          return (
            <li
              key={p.id}
              className="rounded-md border p-1.5"
              style={{ borderColor: 'var(--border)', background: 'var(--panel-2)' }}
            >
              <div className="flex items-center gap-1">
                <span
                  className="size-2.5 shrink-0 rounded-sm"
                  style={{ background: isUsed ? SPEED_COLOR[p.speed] : 'var(--border)' }}
                  title={isUsed ? 'Terpakai' : 'Kosong'}
                />
                <input
                  className="field min-w-0 flex-1 px-1 py-0.5 font-mono text-[11px]"
                  value={p.name}
                  aria-label="Nama port"
                  onChange={(e) => updatePort(device.id, p.id, { name: e.target.value })}
                />
                <button
                  type="button"
                  className="btn shrink-0 px-1.5 py-0.5 text-[10px]"
                  title="Pindahkan port ke sisi lain node"
                  onClick={() => updatePort(device.id, p.id, { side: p.side === 'left' ? 'right' : 'left' })}
                >
                  {p.side === 'left' ? 'L' : 'R'}
                </button>
                <button
                  type="button"
                  className="btn shrink-0 px-1 py-0.5"
                  title={isUsed ? 'Port terpakai — hapus link dulu' : 'Hapus port'}
                  onClick={() => removePort(device.id, p.id)}
                  style={{ color: isUsed ? 'var(--muted)' : '#ef4444' }}
                >
                  <Trash2 size={11} />
                </button>
              </div>

              <div className="mt-1 flex items-center gap-1">
                <select
                  className="field w-[66px] shrink-0 px-1 py-0.5 text-[10.5px]"
                  value={p.speed}
                  aria-label="Kecepatan port"
                  onChange={(e) => updatePort(device.id, p.id, { speed: e.target.value as typeof p.speed })}
                >
                  {SPEEDS.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
                <select
                  className="field w-[74px] shrink-0 px-1 py-0.5 text-[10.5px]"
                  value={p.media}
                  aria-label="Media port"
                  onChange={(e) => updatePort(device.id, p.id, { media: e.target.value as typeof p.media })}
                >
                  {MEDIA.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
                <input
                  className="field min-w-0 flex-1 px-1 py-0.5 text-[10.5px]"
                  placeholder="deskripsi…"
                  aria-label="Deskripsi port"
                  value={p.description}
                  onChange={(e) => updatePort(device.id, p.id, { description: e.target.value })}
                />
              </div>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
