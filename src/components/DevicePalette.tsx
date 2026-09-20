import { useReactFlow } from '@xyflow/react'
import { Search } from 'lucide-react'
import { useMemo, useState } from 'react'
import { RoleIcon } from '@/components/ui/RoleIcon'
import {
  DEVICE_CATALOG,
  type DeviceModel,
  VENDOR_META,
  VENDOR_ORDER,
  type Vendor,
} from '@/data/deviceCatalog'
import { useTopologyStore } from '@/store/useTopologyStore'
import { ROLE_COLOR, ROLE_LABEL } from '@/types/topology'

export const DRAG_MIME = 'application/x-nettopo-model'

function portSummary(m: DeviceModel): string {
  return m.ports.map((t) => `${t.count}× ${t.speed}`).join(' + ')
}

export function DevicePalette() {
  const [query, setQuery] = useState('')
  const addDevice = useTopologyStore((s) => s.addDevice)
  const { screenToFlowPosition } = useReactFlow()

  const grouped = useMemo(() => {
    const q = query.trim().toLowerCase()
    const match = (m: DeviceModel) =>
      !q ||
      m.model.toLowerCase().includes(q) ||
      m.series.toLowerCase().includes(q) ||
      m.vendor.includes(q) ||
      ROLE_LABEL[m.role].toLowerCase().includes(q) ||
      (m.note ?? '').toLowerCase().includes(q)

    const out: { vendor: Vendor; models: DeviceModel[] }[] = []
    for (const vendor of VENDOR_ORDER) {
      const models = DEVICE_CATALOG.filter((m) => m.vendor === vendor && match(m))
      if (models.length) out.push({ vendor, models })
    }
    return out
  }, [query])

  const addAtCenter = (modelId: string) => {
    const el = document.querySelector('.react-flow')
    const rect = el?.getBoundingClientRect()
    const point = rect
      ? screenToFlowPosition({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 })
      : { x: 0, y: 0 }
    addDevice(modelId, { x: Math.round(point.x - 120), y: Math.round(point.y - 70) })
  }

  return (
    <aside
      className="flex h-full w-[264px] shrink-0 flex-col border-r"
      style={{ background: 'var(--panel)', borderColor: 'var(--border)' }}
    >
      <div className="border-b p-2.5" style={{ borderColor: 'var(--border)' }}>
        <div className="relative">
          <Search
            size={13}
            className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2"
            style={{ color: 'var(--muted)' }}
          />
          <input
            className="field pl-7"
            placeholder="Cari perangkat…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <p className="mt-1.5 text-[10px] leading-snug" style={{ color: 'var(--muted)' }}>
          Seret ke kanvas, atau klik untuk menaruh di tengah.
        </p>
      </div>

      <div className="thin-scroll flex-1 overflow-y-auto p-2">
        {grouped.length === 0 ? (
          <p className="p-3 text-center text-[11px]" style={{ color: 'var(--muted)' }}>
            Tidak ada model yang cocok.
          </p>
        ) : null}

        {grouped.map(({ vendor, models }) => (
          <section key={vendor} className="mb-3">
            <h3
              className="mb-1 flex items-center gap-1.5 px-1 text-[10px] font-bold uppercase tracking-wider"
              style={{ color: 'var(--muted)' }}
            >
              <span
                className="inline-block size-2 rounded-sm"
                style={{ background: VENDOR_META[vendor].color }}
              />
              {VENDOR_META[vendor].label}
            </h3>
            <ul className="space-y-1">
              {models.map((m) => (
                <li key={m.id}>
                  <button
                    type="button"
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.setData(DRAG_MIME, m.id)
                      e.dataTransfer.effectAllowed = 'move'
                    }}
                    onClick={() => addAtCenter(m.id)}
                    title={`${m.model}${m.note ? ` — ${m.note}` : ''}`}
                    className="flex w-full cursor-grab items-center gap-2 rounded-md border px-2 py-1.5 text-left transition-colors active:cursor-grabbing"
                    style={{ borderColor: 'var(--border)', background: 'var(--panel-2)' }}
                  >
                    <span
                      className="flex size-6 shrink-0 items-center justify-center rounded"
                      style={{ background: ROLE_COLOR[m.role], color: '#fff' }}
                    >
                      <RoleIcon role={m.role} size={13} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[11.5px] font-medium">{m.model}</span>
                      <span className="block truncate text-[9.5px]" style={{ color: 'var(--muted)' }}>
                        {ROLE_LABEL[m.role]} · {portSummary(m)}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </aside>
  )
}
