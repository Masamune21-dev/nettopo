import {
  BaseEdge,
  EdgeLabelRenderer,
  type EdgeProps,
  Position,
  useReactFlow,
  useStore,
} from '@xyflow/react'
import { memo, useCallback, useRef } from 'react'
import { buildEdgePath, endpointDirections } from '@/lib/edgePath'
import { ifaceVlanLabel } from '@/lib/iface'
import { summarizeTrunk } from '@/lib/trunks'
import { useTopologyStore } from '@/store/useTopologyStore'
import { useUiStore } from '@/store/useUiStore'
import type { AppEdge, AppNode } from '@/store/types'
import { isDeviceNode } from '@/store/types'
import { SPEED_COLOR, SPEED_WIDTH } from '@/types/topology'

/** Geser label nama port ke arah kabel keluar, bukan menumpuk di atas portnya. */
function labelOffset(pos: Position): { x: number; y: number } {
  switch (pos) {
    case Position.Right:
      return { x: 30, y: -9 }
    case Position.Left:
      return { x: -30, y: -9 }
    case Position.Bottom:
      return { x: 0, y: 14 }
    default:
      return { x: 0, y: -14 }
  }
}

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
  const { screenToFlowPosition } = useReactFlow()
  const setWaypoints = useTopologyStore((st) => st.setWaypoints)
  const addWaypoint = useTopologyStore((st) => st.addWaypoint)
  const removeWaypoint = useTopologyStore((st) => st.removeWaypoint)
  const commit = useTopologyStore((st) => st.commit)
  const dragging = useRef(false)

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
      if (trunk) {
        return `${trunk.name}\u0001${summarizeTrunk(trunk, n.data.ports).composition}\u0001${ifaceVlanLabel(trunk)}`
      }
      const port = n.data.ports.find((p) => p.id === handle)
      return port ? `${port.name}\u0001\u0001${ifaceVlanLabel(port)}` : '\u0000'
    }
    return `${describe(source, edge?.sourceHandle)}\u0002${describe(target, edge?.targetHandle)}`
  })

  const [aSide, bSide] = endpoints.split('\u0002').map((part) => {
    const [name, composition, vlan] = part.split('\u0001')
    return {
      name: name === '\u0000' ? '' : (name ?? ''),
      composition: composition ?? '',
      vlan: vlan ?? '',
    }
  })
  const bundle = aSide?.composition || bSide?.composition
  // VLAN diambil dari konfigurasi interface; kolom VLAN pada link hanya penimpa manual.
  const vlanLabel = data?.vlans ? `vl ${data.vlans}` : aSide?.vlan || bSide?.vlan || ''

  const waypoints = data?.waypoints ?? []
  const routing = data?.routing ?? 'bezier'
  const { sourcePosition: sPos, targetPosition: tPos } = endpointDirections(
    sourceX,
    sourceY,
    targetX,
    targetY,
    waypoints,
  )
  const [path, labelX, labelY] = buildEdgePath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition: sPos,
    targetPosition: tPos,
    routing,
    waypoints,
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

  const startDrag = useCallback(
    (index: number) => (event: React.PointerEvent) => {
      event.stopPropagation()
      event.preventDefault()
      const target = event.currentTarget as HTMLElement
      target.setPointerCapture(event.pointerId)
      // Satu langkah undo untuk satu kali geser, bukan per gerakan mouse.
      commit()
      dragging.current = true

      const onMove = (e: PointerEvent) => {
        const point = screenToFlowPosition({ x: e.clientX, y: e.clientY })
        const current = useTopologyStore.getState().edges.find((x) => x.id === id)?.data?.waypoints ?? []
        const next = [...current]
        next[index] = { x: Math.round(point.x), y: Math.round(point.y) }
        setWaypoints(id, next)
      }
      const onUp = () => {
        dragging.current = false
        target.removeEventListener('pointermove', onMove)
        target.removeEventListener('pointerup', onUp)
      }
      target.addEventListener('pointermove', onMove)
      target.addEventListener('pointerup', onUp)
    },
    [commit, id, screenToFlowPosition, setWaypoints],
  )

  /** Titik tengah tiap ruas — diklik untuk menambah belokan baru di situ. */
  const chain = [{ x: sourceX, y: sourceY }, ...waypoints, { x: targetX, y: targetY }]
  const insertPoints = selected
    ? chain.slice(0, -1).map((p, i) => {
        const next = chain[i + 1]!
        return { index: i, x: (p.x + next.x) / 2, y: (p.y + next.y) / 2 }
      })
    : []

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
          {vlanLabel ? <span style={{ color: 'var(--muted)' }}>{vlanLabel}</span> : null}
          {data?.label ? <span style={{ color: 'var(--muted)' }}>{data.label}</span> : null}
        </div>

        {selected
          ? insertPoints.map((p) => (
              <button
                key={`add-${p.index}`}
                type="button"
                className="nodrag nopan absolute size-[9px] cursor-copy rounded-full border opacity-50 hover:opacity-100"
                style={{
                  transform: `translate(-50%, -50%) translate(${p.x}px, ${p.y}px)`,
                  pointerEvents: 'all',
                  background: 'var(--panel)',
                  borderColor: color,
                }}
                title="Klik untuk menambah titik belok di sini"
                onClick={(e) => {
                  e.stopPropagation()
                  addWaypoint(id, p.index, { x: Math.round(p.x), y: Math.round(p.y) })
                }}
              />
            ))
          : null}

        {selected
          ? waypoints.map((p, i) => (
              <div
                key={`wp-${i}`}
                className="nodrag nopan absolute size-3 cursor-grab rounded-full border-2 shadow active:cursor-grabbing"
                style={{
                  transform: `translate(-50%, -50%) translate(${p.x}px, ${p.y}px)`,
                  pointerEvents: 'all',
                  background: 'var(--panel)',
                  borderColor: color,
                  touchAction: 'none',
                }}
                title="Geser untuk membelokkan kabel · klik ganda untuk menghapus"
                onPointerDown={startDrag(i)}
                onDoubleClick={(e) => {
                  e.stopPropagation()
                  removeWaypoint(id, i)
                }}
              />
            ))
          : null}

        {showPortLabels && aSide?.name ? (
          <div
            className="nodrag nopan pointer-events-none absolute font-mono text-[8.5px]"
            style={{
              transform: `translate(-50%, -50%) translate(${sourceX + labelOffset(sPos).x}px, ${sourceY + labelOffset(sPos).y}px)`,
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
              transform: `translate(-50%, -50%) translate(${targetX + labelOffset(tPos).x}px, ${targetY + labelOffset(tPos).y}px)`,
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
