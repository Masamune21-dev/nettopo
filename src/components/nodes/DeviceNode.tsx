import { Handle, type NodeProps, Position, useUpdateNodeInternals } from '@xyflow/react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { memo, useEffect, useMemo } from 'react'
import { RoleIcon } from '@/components/ui/RoleIcon'
import { getModel, VENDOR_META } from '@/data/deviceCatalog'
import { useTopologyStore } from '@/store/useTopologyStore'
import type { DeviceNode as DeviceNodeType } from '@/store/types'
import { ROLE_COLOR, SPEED_COLOR, type Port } from '@/types/topology'

function PortRow({
  port,
  used,
  align,
}: {
  port: Port
  used: boolean
  align: 'left' | 'right'
}) {
  const dot = (
    <Handle
      id={port.id}
      type="source"
      position={align === 'left' ? Position.Left : Position.Right}
      className={`port-handle${used ? ' is-used' : ''}`}
      style={{ background: used ? SPEED_COLOR[port.speed] : 'var(--panel-2)' }}
      title={`${port.name} · ${port.speed} · ${port.media}${port.description ? ` · ${port.description}` : ''}`}
    />
  )
  const text = (
    <span
      className="truncate font-mono text-[10px] leading-none"
      style={{ color: used ? 'var(--text)' : 'var(--muted)' }}
      title={port.description || port.name}
    >
      {port.name}
    </span>
  )
  return (
    <div
      className={`flex min-w-0 items-center gap-1.5 ${align === 'right' ? 'flex-row-reverse' : ''}`}
    >
      {dot}
      {text}
    </div>
  )
}

function DeviceNodeInner({ id, data, selected }: NodeProps<DeviceNodeType>) {
  const edges = useTopologyStore((s) => s.edges)
  const toggleExpanded = useTopologyStore((s) => s.toggleExpanded)
  const updateNodeInternals = useUpdateNodeInternals()

  const model = getModel(data.modelId)
  const accent = ROLE_COLOR[data.role]
  const vendor = model ? VENDOR_META[model.vendor] : undefined

  const usedPortIds = useMemo(() => {
    const set = new Set<string>()
    for (const e of edges) {
      if (e.source === id && e.sourceHandle) set.add(e.sourceHandle)
      if (e.target === id && e.targetHandle) set.add(e.targetHandle)
    }
    return set
  }, [edges, id])

  const visible = data.expanded ? data.ports : data.ports.filter((p) => usedPortIds.has(p.id))
  const left = visible.filter((p) => p.side === 'left')
  const right = visible.filter((p) => p.side === 'right')
  const rows = Math.max(left.length, right.length)

  // Jumlah/posisi handle berubah saat expand-collapse → React Flow harus diberi tahu.
  useEffect(() => {
    updateNodeInternals(id)
  }, [id, data.expanded, data.ports, updateNodeInternals])

  return (
    <div
      className="rounded-lg border text-[11px] shadow-sm transition-shadow"
      style={{
        background: 'var(--panel)',
        borderColor: selected ? accent : 'var(--border)',
        boxShadow: selected ? `0 0 0 2px ${accent}55, 0 6px 20px rgb(15 23 42 / 0.12)` : undefined,
        minWidth: 208,
        maxWidth: 300,
      }}
    >
      {/* Header */}
      <div
        className="flex items-start gap-2 rounded-t-lg border-b px-2.5 py-2"
        style={{ borderColor: 'var(--border)', background: `${accent}14` }}
      >
        <span
          className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded"
          style={{ background: accent, color: '#fff' }}
        >
          <RoleIcon role={data.role} size={14} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[12.5px] font-semibold leading-tight">{data.hostname}</div>
          <div className="truncate text-[10px]" style={{ color: 'var(--muted)' }}>
            {vendor ? `${vendor.label} · ` : ''}
            {model?.model ?? data.modelId}
          </div>
          {data.mgmtIp ? (
            <div className="truncate font-mono text-[10px]" style={{ color: 'var(--muted)' }}>
              {data.mgmtIp}
            </div>
          ) : null}
        </div>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            toggleExpanded(id)
          }}
          className="nodrag rounded p-0.5 hover:bg-black/10 dark:hover:bg-white/10"
          title={data.expanded ? 'Sembunyikan port kosong' : 'Tampilkan semua port'}
          style={{ color: 'var(--muted)' }}
        >
          {data.expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        </button>
      </div>

      {/* Port */}
      {rows > 0 ? (
        <div className="grid grid-cols-2 gap-x-2 gap-y-[3px] px-1.5 py-2">
          {Array.from({ length: rows }, (_, i) => (
            <div key={`row-${i}`} className="contents">
              <div className="min-w-0">
                {left[i] ? (
                  <PortRow port={left[i]} used={usedPortIds.has(left[i].id)} align="left" />
                ) : null}
              </div>
              <div className="min-w-0">
                {right[i] ? (
                  <PortRow port={right[i]} used={usedPortIds.has(right[i].id)} align="right" />
                ) : null}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="px-2.5 py-2 text-[10px]" style={{ color: 'var(--muted)' }}>
          Belum ada link — klik ▸ untuk menampilkan port.
        </div>
      )}

      {/* Footer ringkasan */}
      <div
        className="flex items-center justify-between rounded-b-lg border-t px-2.5 py-1 text-[9.5px]"
        style={{ borderColor: 'var(--border)', color: 'var(--muted)' }}
      >
        <span>
          {data.ports.length} port · {usedPortIds.size} terpakai
        </span>
        {data.site ? <span className="truncate">{data.site}</span> : null}
      </div>
    </div>
  )
}

export const DeviceNode = memo(DeviceNodeInner)
