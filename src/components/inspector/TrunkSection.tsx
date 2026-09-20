import { Plus, Trash2, Unlink } from 'lucide-react'
import { summarizeTrunk } from '@/lib/trunks'
import { useTopologyStore } from '@/store/useTopologyStore'
import type { DeviceNode } from '@/store/types'
import { SPEED_COLOR, TRUNK_MODES } from '@/types/topology'
import { SwitchingFields } from './SwitchingFields'

const MODE_LABEL: Record<(typeof TRUNK_MODES)[number], string> = {
  lacp: 'LACP (dinamis)',
  static: 'Manual / static',
}

export function TrunkSection({
  device,
  selectedPortIds,
  onConsumeSelection,
}: {
  device: DeviceNode
  selectedPortIds: string[]
  onConsumeSelection: () => void
}) {
  const updateTrunk = useTopologyStore((s) => s.updateTrunk)
  const deleteTrunk = useTopologyStore((s) => s.deleteTrunk)
  const addTrunkMembers = useTopologyStore((s) => s.addTrunkMembers)
  const removeTrunkMember = useTopologyStore((s) => s.removeTrunkMember)

  if (device.data.trunks.length === 0) return null

  return (
    <section>
      <span className="label">Trunk / bonding ({device.data.trunks.length})</span>
      <ul className="space-y-1.5">
        {device.data.trunks.map((t) => {
          const summary = summarizeTrunk(t, device.data.ports)
          const color = summary.memberSpeed ? SPEED_COLOR[summary.memberSpeed] : '#a855f7'
          return (
            <li
              key={t.id}
              className="rounded-md border p-2"
              style={{ borderColor: 'var(--border)', background: 'var(--panel-2)' }}
            >
              <div className="flex items-center gap-1">
                <span className="h-3 w-4 shrink-0 rounded-sm border" style={{ borderColor: color, background: `${color}44` }} />
                <input
                  className="field min-w-0 flex-1 px-1 py-0.5 font-mono text-[11px] font-semibold"
                  value={t.name}
                  aria-label="Nama trunk"
                  onChange={(e) => updateTrunk(device.id, t.id, { name: e.target.value })}
                />
                <button
                  type="button"
                  className="btn shrink-0 px-1.5 py-0.5 text-[10px]"
                  title="Pindahkan trunk ke sisi lain node"
                  onClick={() => updateTrunk(device.id, t.id, { side: t.side === 'left' ? 'right' : 'left' })}
                >
                  {t.side === 'left' ? 'L' : 'R'}
                </button>
                <button
                  type="button"
                  className="btn shrink-0 px-1 py-0.5"
                  style={{ color: '#ef4444' }}
                  title="Hapus trunk (port anggota kembali bebas, link ikut dilepas)"
                  onClick={() => deleteTrunk(device.id, t.id)}
                >
                  <Trash2 size={11} />
                </button>
              </div>

              <div className="mt-1 flex items-center gap-1">
                <select
                  className="field w-[112px] shrink-0 px-1 py-0.5 text-[10.5px]"
                  value={t.mode}
                  aria-label="Mode trunk"
                  onChange={(e) => updateTrunk(device.id, t.id, { mode: e.target.value as typeof t.mode })}
                >
                  {TRUNK_MODES.map((m) => (
                    <option key={m} value={m}>
                      {MODE_LABEL[m]}
                    </option>
                  ))}
                </select>
                <span className="truncate text-[10.5px] font-medium" style={{ color }}>
                  {summary.label}
                </span>
              </div>

              <div className="mt-1.5 flex flex-wrap gap-1">
                {t.memberIds.map((pid) => {
                  const port = device.data.ports.find((p) => p.id === pid)
                  return (
                    <span
                      key={pid}
                      className="inline-flex items-center gap-1 rounded border px-1 py-[1px] font-mono text-[9.5px]"
                      style={{ borderColor: 'var(--border)' }}
                    >
                      {port?.name ?? '?'}
                      <button
                        type="button"
                        title="Keluarkan dari trunk"
                        onClick={() => removeTrunkMember(device.id, t.id, pid)}
                        style={{ color: 'var(--muted)' }}
                      >
                        <Unlink size={9} />
                      </button>
                    </span>
                  )
                })}
                {selectedPortIds.length > 0 ? (
                  <button
                    type="button"
                    className="btn px-1.5 py-[1px] text-[9.5px]"
                    onClick={() => {
                      addTrunkMembers(device.id, t.id, selectedPortIds)
                      onConsumeSelection()
                    }}
                  >
                    <Plus size={9} /> {selectedPortIds.length} port terpilih
                  </button>
                ) : null}
              </div>

              <SwitchingFields
                value={t}
                onChange={(patch) => updateTrunk(device.id, t.id, patch)}
              />

              <input
                className="field mt-1.5 px-1 py-0.5 text-[10.5px]"
                placeholder="deskripsi trunk…"
                aria-label="Deskripsi trunk"
                value={t.description}
                onChange={(e) => updateTrunk(device.id, t.id, { description: e.target.value })}
              />
            </li>
          )
        })}
      </ul>
    </section>
  )
}
