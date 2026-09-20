import {
  BaseEdge,
  EdgeLabelRenderer,
  type EdgeProps,
  getBezierPath,
  Position,
  useStore,
} from '@xyflow/react'
import { memo } from 'react'
import { summarizeTrunk } from '@/lib/trunks'
import { useUiStore } from '@/store/useUiStore'
import type { AppEdge, AppNode } from '@/store/types'
import { isDeviceNode } from '@/store/types'
import { SPEED_COLOR, SPEED_WIDTH } from '@/types/topology'

function LinkEdgeInner({
  id,
  source,
  target,
  sourceX,
  sourceY,
  targetX,
  targetY,
  data,
  selected,
}: EdgeProps<AppEdge>) {
  const showPortLabels = useUiStore((s) => s.showPortLabels)

  // Dikembalikan sebagai satu string agar perbandingan selector tetap murah:
  // objek baru tiap render akan memicu re-render di setiap perubahan store.
  const endpoints = useStore((s) => {
    const edge = s.edgeLookup.get(id)
    const describe = (nodeId: string, handle: string | null | undefined) => {
      const node = s.nodeLookup.get(nodeId)
      if (!node || !handle) return '\u0000'
      const n = node.internals.userNode as AppNode
      if (!isDeviceNode(n)) return '\u0000'
      const trunk = n.data.trunks.find((t) => t.id === handle)
      if (trunk) return `${trunk.name}\u0001${summarizeTrunk(trunk, n.data.ports).composition}`
      const port = n.data.ports.find((p) => p.id === handle)
      return port ? `${port.name}\u0001` : '\u0000'
    }
    return `${describe(source, edge?.sourceHandle)}\u0002${describe(target, edge?.targetHandle)}`
  })

  const [aSide, bSide] = endpoints.split('\u0002').map((part) => {
    const [name, composition] = part.split('\u0001')
    return { name: name === '\u0000' ? '' : (name ?? ''), composition: composition ?? '' }
  })
  const bundle = aSide?.composition || bSide?.composition

  // Arah keluar kabel dihitung dari posisi relatif kedua ujung, bukan dari sisi
  // handle-nya. Tanpa ini kabel sering melingkar balik saat port ada di sisi
  // yang "salah" terhadap perangkat lawannya.
  const dx = targetX - sourceX
  const dy = targetY - sourceY
  const horizontal = Math.abs(dx) >= Math.abs(dy)
  const sPos = horizontal
    ? dx >= 0
      ? Position.Right
      : Position.Left
    : dy >= 0
      ? Position.Bottom
      : Position.Top
  const tPos = horizontal
    ? dx >= 0
      ? Position.Left
      : Position.Right
    : dy >= 0
      ? Position.Top
      : Position.Bottom

  const [path, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition: sPos,
    targetX,
    targetY,
    targetPosition: tPos,
    curvature: 0.3,
  })

  const speed = data?.speed ?? '1G'
  const color = data?.color ?? SPEED_COLOR[speed]
  const width = SPEED_WIDTH[speed]
  const kind = data?.kind ?? 'single'
  const media = data?.media ?? 'fiber'

  const dash =
    media === 'wireless' ? '2 5' : media === 'virtual' ? '7 5' : kind === 'backup' ? '9 5' : undefined

  const style = {
    stroke: color,
    strokeWidth: selected ? width + 1.4 : width,
    strokeDasharray: dash,
    strokeLinecap: 'round' as const,
  }

  return (
    <>
      {kind === 'lacp' ? (
        <g className="link-path">
          <path d={path} fill="none" style={style} transform="translate(0,-2)" />
          <path d={path} fill="none" style={style} transform="translate(0,2)" />
        </g>
      ) : (
        <BaseEdge id={id} path={path} style={style} className="link-path" />
      )}

      <EdgeLabelRenderer>
        <div
          className="nodrag nopan pointer-events-none absolute flex -translate-x-1/2 -translate-y-1/2 items-center gap-1 rounded-md border px-1.5 py-[1px] text-[9.5px] font-medium shadow-sm"
          style={{
            transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
            background: 'var(--panel)',
            borderColor: selected ? color : 'var(--border)',
            color: 'var(--text)',
          }}
        >
          <span style={{ color }}>{bundle || speed}</span>
          {kind === 'lacp' ? (
            <span style={{ color: 'var(--muted)' }}>{bundle ? 'LACP' : 'bundle'}</span>
          ) : null}
          {data?.vlans ? (
            <span style={{ color: 'var(--muted)' }}>vl {data.vlans}</span>
          ) : null}
          {data?.label ? <span style={{ color: 'var(--muted)' }}>{data.label}</span> : null}
        </div>

        {showPortLabels && aSide?.name ? (
          <div
            className="nodrag nopan pointer-events-none absolute font-mono text-[8.5px]"
            style={{
              transform: `translate(-50%, -50%) translate(${sourceX + (horizontal ? (dx >= 0 ? 30 : -30) : 0)}px, ${sourceY + (horizontal ? -9 : dy >= 0 ? 14 : -14)}px)`,
              color: 'var(--muted)',
            }}
          >
            {aSide.name}
          </div>
        ) : null}
        {showPortLabels && bSide?.name ? (
          <div
            className="nodrag nopan pointer-events-none absolute font-mono text-[8.5px]"
            style={{
              transform: `translate(-50%, -50%) translate(${targetX + (horizontal ? (dx >= 0 ? -30 : 30) : 0)}px, ${targetY + (horizontal ? -9 : dy >= 0 ? -14 : 14)}px)`,
              color: 'var(--muted)',
            }}
          >
            {bSide.name}
          </div>
        ) : null}
      </EdgeLabelRenderer>
    </>
  )
}

export const LinkEdge = memo(LinkEdgeInner)
