import {
  Background,
  BackgroundVariant,
  ConnectionLineType,
  ConnectionMode,
  Controls,
  MiniMap,
  ReactFlow,
  SelectionMode,
  useReactFlow,
  type NodeTypes,
  type EdgeTypes,
  type OnConnectEnd,
} from '@xyflow/react'
import { useCallback, useMemo, useRef, useState } from 'react'
import { DRAG_MIME } from '@/components/DevicePalette'
import { LinkEdge } from '@/components/edges/LinkEdge'
import { DeviceNode } from '@/components/nodes/DeviceNode'
import { GroupNode } from '@/components/nodes/GroupNode'
import { NoteNode } from '@/components/nodes/NoteNode'
import { useTopologyStore } from '@/store/useTopologyStore'
import { useUiStore } from '@/store/useUiStore'
import { isDeviceNode, type AppEdge, type AppNode } from '@/store/types'
import { ROLE_COLOR } from '@/types/topology'

const nodeTypes: NodeTypes = { device: DeviceNode, group: GroupNode, note: NoteNode }
const edgeTypes: EdgeTypes = { link: LinkEdge }

interface ContextMenuState {
  x: number
  y: number
  nodeId?: string
}

export function Canvas() {
  const store = useTopologyStore()
  const snapToGrid = useUiStore((s) => s.snapToGrid)
  const { screenToFlowPosition } = useReactFlow()
  const wrapper = useRef<HTMLDivElement>(null)
  const [menu, setMenu] = useState<ContextMenuState | null>(null)

  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
  }, [])

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      const modelId = e.dataTransfer.getData(DRAG_MIME)
      if (!modelId) return
      const p = screenToFlowPosition({ x: e.clientX, y: e.clientY })
      store.addDevice(modelId, { x: Math.round(p.x - 110), y: Math.round(p.y - 40) })
    },
    [screenToFlowPosition, store],
  )

  const onConnectEnd: OnConnectEnd = useCallback(
    (_event, connectionState) => {
      if (!connectionState.isValid && connectionState.fromHandle) {
        // Dilepas di area kosong — beri petunjuk, bukan diam saja.
        store.pushToast('Lepaskan kabel tepat di port perangkat tujuan.', 'info')
      }
    },
    [store],
  )

  const minimapColor = useCallback(
    (n: AppNode) => (isDeviceNode(n) ? ROLE_COLOR[n.data.role] : 'var(--border)'),
    [],
  )

  const openMenu = (e: React.MouseEvent, nodeId?: string) => {
    e.preventDefault()
    const rect = wrapper.current?.getBoundingClientRect()
    setMenu({ x: e.clientX - (rect?.left ?? 0), y: e.clientY - (rect?.top ?? 0), nodeId })
  }

  const flowPointFromMenu = (m: ContextMenuState) => {
    const rect = wrapper.current?.getBoundingClientRect()
    return screenToFlowPosition({ x: (rect?.left ?? 0) + m.x, y: (rect?.top ?? 0) + m.y })
  }

  const snapGrid = useMemo<[number, number]>(() => [16, 16], [])

  return (
    <div ref={wrapper} className="relative h-full flex-1" onDrop={onDrop} onDragOver={onDragOver}>
      <ReactFlow<AppNode, AppEdge>
        nodes={store.nodes}
        edges={store.edges}
        onNodesChange={store.onNodesChange}
        onEdgesChange={store.onEdgesChange}
        onConnect={store.onConnect}
        onConnectEnd={onConnectEnd}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        connectionMode={ConnectionMode.Loose}
        connectionLineType={ConnectionLineType.Bezier}
        connectionLineStyle={{ stroke: '#6366f1', strokeWidth: 2 }}
        snapToGrid={snapToGrid}
        snapGrid={snapGrid}
        selectionMode={SelectionMode.Partial}
        selectionOnDrag
        panOnDrag={[1, 2]}
        panOnScroll
        zoomOnDoubleClick={false}
        minZoom={0.15}
        maxZoom={2.5}
        deleteKeyCode={null}
        multiSelectionKeyCode={['Meta', 'Shift', 'Control']}
        onPaneClick={() => setMenu(null)}
        onPaneContextMenu={(e) => openMenu(e as React.MouseEvent)}
        onNodeContextMenu={(e, node) => openMenu(e, node.id)}
        onMoveStart={() => setMenu(null)}
        proOptions={{ hideAttribution: true }}
        fitView
      >
        <Background variant={BackgroundVariant.Dots} gap={16} size={1} color="var(--dot)" />
        <Controls showInteractive={false} position="bottom-left" />
        <MiniMap
          position="bottom-right"
          pannable
          zoomable
          nodeColor={minimapColor}
          maskColor="rgb(15 23 42 / 0.14)"
          style={{ width: 180, height: 120 }}
        />
      </ReactFlow>

      {menu ? (
        <div
          className="absolute z-50 min-w-[170px] overflow-hidden rounded-md border py-1 text-[12px] shadow-lg"
          style={{ left: menu.x, top: menu.y, background: 'var(--panel)', borderColor: 'var(--border)' }}
        >
          {menu.nodeId ? (
            <>
              <button
                type="button"
                className="block w-full px-3 py-1.5 text-left hover:bg-black/5 dark:hover:bg-white/5"
                onClick={() => {
                  store.selectOnly(menu.nodeId as string)
                  store.duplicateSelected()
                  setMenu(null)
                }}
              >
                Duplikat
              </button>
              <button
                type="button"
                className="block w-full px-3 py-1.5 text-left hover:bg-black/5 dark:hover:bg-white/5"
                style={{ color: '#ef4444' }}
                onClick={() => {
                  store.selectOnly(menu.nodeId as string)
                  store.deleteSelected()
                  setMenu(null)
                }}
              >
                Hapus
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                className="block w-full px-3 py-1.5 text-left hover:bg-black/5 dark:hover:bg-white/5"
                onClick={() => {
                  store.addGroup(flowPointFromMenu(menu))
                  setMenu(null)
                }}
              >
                Tambah area / POP
              </button>
              <button
                type="button"
                className="block w-full px-3 py-1.5 text-left hover:bg-black/5 dark:hover:bg-white/5"
                onClick={() => {
                  store.addNote(flowPointFromMenu(menu))
                  setMenu(null)
                }}
              >
                Tambah catatan
              </button>
            </>
          )}
        </div>
      ) : null}
    </div>
  )
}
