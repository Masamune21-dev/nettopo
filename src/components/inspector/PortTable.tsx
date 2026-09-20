import { Link2, Plus, Trash2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { trunkOfPort } from '@/lib/trunks'
import { deviceUsage } from '@/lib/usage'
import { useTopologyStore } from '@/store/useTopologyStore'
import type { DeviceNode } from '@/store/types'
import { MEDIA, SPEED_COLOR, SPEEDS } from '@/types/topology'
import { TrunkSection } from './TrunkSection'

export function PortTable({ device }: { device: DeviceNode }) {
  const edges = useTopologyStore((s) => s.edges)
  const updatePort = useTopologyStore((s) => s.updatePort)
  const addPort = useTopologyStore((s) => s.addPort)
  const removePort = useTopologyStore((s) => s.removePort)
  const createTrunk = useTopologyStore((s) => s.createTrunk)
  const [onlyUsed, setOnlyUsed] = useState(false)
  const [filter, setFilter] = useState('')
  const [picked, setPicked] = useState<string[]>([])

  const usage = useMemo(
    () => deviceUsage(device.id, device.data.trunks, edges),
    [edges, device.id, device.data.trunks],
  )
  const used = usage.ports

  // Port yang sudah jadi anggota trunk tidak bisa dipilih lagi.
  const selectable = (portId: string) => !trunkOfPort(device.data.trunks, portId)
  const pickedValid = picked.filter(selectable)
  const togglePick = (portId: string) =>
    setPicked((prev) => (prev.includes(portId) ? prev.filter((x) => x !== portId) : [...prev, portId]))

  const q = filter.trim().toLowerCase()
  const shown = device.data.ports.filter(
    (p) =>
      (!onlyUsed || used.has(p.id)) &&
      (!q || p.name.toLowerCase().includes(q) || p.description.toLowerCase().includes(q)),
  )

  return (
    <div className="space-y-3.5">
      <TrunkSection
        device={device}
        selectedPortIds={pickedValid}
        onConsumeSelection={() => setPicked([])}
      />

      <section>
      <div className="mb-1.5 flex items-center justify-between">
        <span className="label mb-0">
          Port ({used.size}/{device.data.ports.length} terpakai)
        </span>
        <button type="button" className="btn px-1.5 py-0.5 text-[11px]" onClick={() => addPort(device.id)}>
          <Plus size={11} /> Tambah
        </button>
      </div>

      {pickedValid.length > 0 ? (
        <div
          className="mb-1.5 flex items-center gap-1.5 rounded-md border px-2 py-1.5"
          style={{ borderColor: '#a855f7', background: '#a855f714' }}
        >
          <span className="flex-1 text-[11px]">{pickedValid.length} port dipilih</span>
          <button
            type="button"
            className="btn px-1.5 py-0.5 text-[11px]"
            disabled={pickedValid.length < 2}
            title={
              pickedValid.length < 2
                ? 'Pilih minimal 2 port untuk dijadikan trunk'
                : 'Gabungkan port terpilih menjadi satu interface agregasi'
            }
            onClick={() => {
              createTrunk(device.id, pickedValid)
              setPicked([])
            }}
          >
            <Link2 size={11} /> Jadikan trunk
          </button>
          <button type="button" className="btn px-1.5 py-0.5 text-[11px]" onClick={() => setPicked([])}>
            Batal
          </button>
        </div>
      ) : null}

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
          const owner = trunkOfPort(device.data.trunks, p.id)
          return (
            <li
              key={p.id}
              className="rounded-md border p-1.5"
              style={{
                borderColor: picked.includes(p.id) ? '#a855f7' : 'var(--border)',
                background: 'var(--panel-2)',
              }}
            >
              <div className="flex items-center gap-1">
                {owner ? (
                  <span
                    className="shrink-0 rounded border px-1 font-mono text-[9px]"
                    style={{ borderColor: '#a855f7', color: '#a855f7' }}
                    title={`Anggota ${owner.name}`}
                  >
                    {owner.name}
                  </span>
                ) : (
                  <input
                    type="checkbox"
                    className="shrink-0 accent-purple-500"
                    checked={picked.includes(p.id)}
                    disabled={usage.handles.has(p.id)}
                    title={
                      usage.handles.has(p.id)
                        ? 'Port sudah punya link sendiri'
                        : 'Pilih untuk dijadikan trunk'
                    }
                    aria-label={`Pilih ${p.name}`}
                    onChange={() => togglePick(p.id)}
                  />
                )}
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
    </div>
  )
}
