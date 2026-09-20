import { Handle, type NodeProps, Position, useUpdateNodeInternals } from '@xyflow/react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { memo, useEffect, useMemo } from 'react'
import { RoleIcon } from '@/components/ui/RoleIcon'
import { getModel, VENDOR_META } from '@/data/deviceCatalog'
import { ifaceBadge, ifaceSummary } from '@/lib/iface'
import { summarizeTrunk } from '@/lib/trunks'
import { deviceUsage } from '@/lib/usage'
import { useTopologyStore } from '@/store/useTopologyStore'
import type { DeviceNode as DeviceNodeType } from '@/store/types'
import { PORT_MODE_COLOR, ROLE_COLOR, SPEED_COLOR, type Port, type Trunk } from '@/types/topology'

/** Badge kecil penanda link-type: A100 (access), T (trunk), H (hybrid), L3. */
function ModeBadge({ config }: { config: Parameters<typeof ifaceBadge>[0] }) {
  const text = ifaceBadge(config)
  if (!text) return null
  const color = PORT_MODE_COLOR[config.linkType]
  return (
    <span
      className="shrink-0 rounded-sm px-[3px] text-[8px] font-bold leading-[13px]"
      style={{ background: `${color}26`, color }}
      title={ifaceSummary(config)}
    >
      {text}
    </span>
  )
}

function PortRow({ port, used, align }: { port: Port; used: boolean; align: 'left' | 'right' }) {
  const cfg = ifaceSummary(port)
  return (
    <div className={`flex min-w-0 items-center gap-1 ${align === 'right' ? 'flex-row-reverse' : ''}`}>
      <Handle
        id={port.id}
        type="source"
        position={align === 'left' ? Position.Left : Position.Right}
        className={`port-handle${used ? ' is-used' : ''}`}
        style={{ background: used ? SPEED_COLOR[port.speed] : 'var(--panel-2)' }}
        title={`${port.name} · ${port.speed} · ${port.media}${cfg ? ` · ${cfg}` : ''}${port.description ? ` · ${port.description}` : ''}`}
      />
      <span
        className="truncate font-mono text-[10px] leading-none"
        style={{ color: used ? 'var(--text)' : 'var(--muted)' }}
        title={port.description || port.name}
      >
        {port.name}
      </span>
      <ModeBadge config={port} />
    </div>
  )
}

function TrunkRow({
  trunk,
  ports,
  used,
  align,
}: {
  trunk: Trunk
  ports: Port[]
  used: boolean
  align: 'left' | 'right'
}) {
  const summary = summarizeTrunk(trunk, ports)
  const color = summary.memberSpeed ? SPEED_COLOR[summary.memberSpeed] : '#a855f7'
  const memberNames = trunk.memberIds
    .map((id) => ports.find((p) => p.id === id)?.name)
    .filter(Boolean)
    .join(', ')

  return (
    <div className={`flex min-w-0 items-center gap-1.5 ${align === 'right' ? 'flex-row-reverse' : ''}`}>
      <Handle
        id={trunk.id}
        type="source"
        position={align === 'left' ? Position.Left : Position.Right}
        className={`trunk-handle${used ? ' is-used' : ''}`}
        style={{ background: used ? color : 'var(--panel-2)', borderColor: color }}
        title={`${trunk.name} (${trunk.mode.toUpperCase()}) · ${summary.label}${ifaceSummary(trunk) ? ` · ${ifaceSummary(trunk)}` : ''} · ${memberNames}`}
      />
      <span className={`flex min-w-0 flex-col ${align === 'right' ? 'items-end' : 'items-start'}`}>
        <span className="flex items-center gap-1">
          <span className="truncate font-mono text-[10px] font-semibold leading-none" style={{ color }}>
            {trunk.name}
          </span>
          <ModeBadge config={trunk} />
        </span>
        <span className="truncate text-[8.5px] leading-tight" style={{ color: 'var(--muted)' }}>
          {summary.composition}
        </span>
      </span>
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

  const usage = useMemo(() => deviceUsage(id, data.trunks, edges), [edges, id, data.trunks])
  const usedIds = usage.handles

  // Port yang sudah masuk trunk tidak ditampilkan sendiri — diwakili trunk-nya.
  const memberIds = useMemo(
    () => new Set(data.trunks.flatMap((t) => t.memberIds)),
    [data.trunks],
  )
  const freePorts = data.ports.filter((p) => !memberIds.has(p.id))
  const visible = data.expanded ? freePorts : freePorts.filter((p) => usedIds.has(p.id))

  const trunksLeft = data.trunks.filter((t) => t.side === 'left')
  const trunksRight = data.trunks.filter((t) => t.side === 'right')
  const trunkRows = Math.max(trunksLeft.length, trunksRight.length)

  const left = visible.filter((p) => p.side === 'left')
  const right = visible.filter((p) => p.side === 'right')
  const rows = Math.max(left.length, right.length)

  // Jumlah/posisi handle berubah saat expand-collapse atau trunk diubah.
  useEffect(() => {
    updateNodeInternals(id)
  }, [id, data.expanded, data.ports, data.trunks, updateNodeInternals])

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

      {/* Interface agregasi (Eth-Trunk / ae / bond) */}
      {trunkRows > 0 ? (
        <div
          className="grid grid-cols-2 gap-x-2 gap-y-[5px] border-b px-1.5 py-1.5"
          style={{ borderColor: 'var(--border)' }}
        >
          {Array.from({ length: trunkRows }, (_, i) => (
            <div key={`trunk-${i}`} className="contents">
              <div className="min-w-0">
                {trunksLeft[i] ? (
                  <TrunkRow
                    trunk={trunksLeft[i]}
                    ports={data.ports}
                    used={usedIds.has(trunksLeft[i].id)}
                    align="left"
                  />
                ) : null}
              </div>
              <div className="min-w-0">
                {trunksRight[i] ? (
                  <TrunkRow
                    trunk={trunksRight[i]}
                    ports={data.ports}
                    used={usedIds.has(trunksRight[i].id)}
                    align="right"
                  />
                ) : null}
              </div>
            </div>
          ))}
        </div>
      ) : null}

      {/* Port fisik yang belum masuk trunk */}
      {rows > 0 ? (
        <div className="grid grid-cols-2 gap-x-2 gap-y-[3px] px-1.5 py-2">
          {Array.from({ length: rows }, (_, i) => (
            <div key={`row-${i}`} className="contents">
              <div className="min-w-0">
                {left[i] ? <PortRow port={left[i]} used={usedIds.has(left[i].id)} align="left" /> : null}
              </div>
              <div className="min-w-0">
                {right[i] ? (
                  <PortRow port={right[i]} used={usedIds.has(right[i].id)} align="right" />
                ) : null}
              </div>
            </div>
          ))}
        </div>
      ) : trunkRows === 0 ? (
        <div className="px-2.5 py-2 text-[10px]" style={{ color: 'var(--muted)' }}>
          Belum ada link — klik ▸ untuk menampilkan port.
        </div>
      ) : null}

      <div
        className="flex items-center justify-between rounded-b-lg border-t px-2.5 py-1 text-[9.5px]"
        style={{ borderColor: 'var(--border)', color: 'var(--muted)' }}
      >
        <span>
          {data.ports.length} port · {usage.ports.size} terpakai
          {data.trunks.length > 0 ? ` · ${data.trunks.length} trunk` : ''}
        </span>
        {data.site ? <span className="truncate">{data.site}</span> : null}
      </div>
    </div>
  )
}

export const DeviceNode = memo(DeviceNodeInner)
