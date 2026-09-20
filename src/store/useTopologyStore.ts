import {
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  type Connection,
  type EdgeChange,
  type NodeChange,
  type XYPosition,
} from '@xyflow/react'
import { create } from 'zustand'
import { getModel } from '@/data/deviceCatalog'
import { uid } from '@/lib/id'
import { buildPorts, nextPortName } from '@/lib/ports'
import type { LinkMedia, Port, Speed } from '@/types/topology'
import {
  type AppEdge,
  type AppNode,
  type DeviceNode,
  type DeviceNodeData,
  isDeviceNode,
} from './types'

export interface Toast {
  id: string
  text: string
  tone: 'info' | 'warn' | 'error' | 'ok'
}

interface Snapshot {
  nodes: AppNode[]
  edges: AppEdge[]
}

interface TopologyState {
  projectId: string
  projectName: string
  site: string
  nodes: AppNode[]
  edges: AppEdge[]
  past: Snapshot[]
  future: Snapshot[]
  toasts: Toast[]
  dirty: boolean

  onNodesChange: (changes: NodeChange<AppNode>[]) => void
  onEdgesChange: (changes: EdgeChange<AppEdge>[]) => void
  onConnect: (connection: Connection) => void

  addDevice: (modelId: string, position: XYPosition) => void
  updateDevice: (id: string, patch: Partial<DeviceNodeData>) => void
  updatePort: (deviceId: string, portId: string, patch: Partial<Port>) => void
  addPort: (deviceId: string) => void
  removePort: (deviceId: string, portId: string) => void
  toggleExpanded: (deviceId: string) => void

  updateLink: (edgeId: string, patch: Partial<AppEdge['data']>) => void
  flipLink: (edgeId: string) => void
  setLinkEndpoint: (edgeId: string, side: 'a' | 'b', portId: string) => boolean
  changeModel: (deviceId: string, modelId: string) => void

  addGroup: (position: XYPosition) => void
  addNote: (position: XYPosition) => void
  updateNodeData: (id: string, patch: Record<string, unknown>) => void

  deleteSelected: () => void
  duplicateSelected: () => void
  selectOnly: (id: string) => void
  clearSelection: () => void

  setProjectMeta: (patch: { projectName?: string; site?: string }) => void
  replaceAll: (s: Snapshot & { projectId?: string; projectName?: string; site?: string }) => void
  setNodesEdges: (nodes: AppNode[], edges: AppEdge[]) => void

  undo: () => void
  redo: () => void
  commit: () => void

  pushToast: (text: string, tone?: Toast['tone']) => void
  dismissToast: (id: string) => void
  markClean: () => void
}

const HISTORY_LIMIT = 60

/** Nama host otomatis: MX204-01, CCR2004-02, … berdasarkan model. */
function autoHostname(modelId: string, nodes: AppNode[]): string {
  const model = getModel(modelId)
  const raw = model?.model ?? 'DEVICE'
  const base = raw.split(/[\s(/]/)[0].split('-')[0].toUpperCase()
  const re = new RegExp(`^${base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}-(\\d+)$`)
  let max = 0
  for (const n of nodes) {
    if (!isDeviceNode(n)) continue
    const m = re.exec(n.data.hostname)
    if (m) max = Math.max(max, Number(m[1]))
  }
  return `${base}-${String(max + 1).padStart(2, '0')}`
}

function mediaForPort(port: Port | undefined): LinkMedia {
  if (!port) return 'fiber'
  return port.media === 'rj45' ? 'copper' : 'fiber'
}

/** Kecepatan link = yang paling rendah di antara dua port (leher botol nyata). */
const SPEED_ORDER: Speed[] = ['100M', '1G', '2.5G', '10G', '25G', '40G', '100G', '400G']
function slowerOf(a: Speed | undefined, b: Speed | undefined): Speed {
  if (!a) return b ?? '1G'
  if (!b) return a
  return SPEED_ORDER.indexOf(a) <= SPEED_ORDER.indexOf(b) ? a : b
}

export const useTopologyStore = create<TopologyState>()((set, get) => {
  /** Simpan snapshot sebelum perubahan, lalu jalankan mutasi. */
  const withHistory = (fn: () => void) => {
    const { nodes, edges, past } = get()
    set({
      past: [...past, { nodes, edges }].slice(-HISTORY_LIMIT),
      future: [],
      dirty: true,
    })
    fn()
  }

  const patchNode = (id: string, fn: (n: AppNode) => AppNode) =>
    set((s) => ({ nodes: s.nodes.map((n) => (n.id === id ? fn(n) : n)), dirty: true }))

  return {
    projectId: uid('prj'),
    projectName: 'Topologi Baru',
    site: '',
    nodes: [],
    edges: [],
    past: [],
    future: [],
    toasts: [],
    dirty: false,

    /* ── React Flow ─────────────────────────────────────────────────────── */

    onNodesChange: (changes) => {
      // Simpan history sekali saja: saat drag selesai atau ukuran berubah selesai.
      const endsDrag = changes.some((c) => c.type === 'position' && c.dragging === false)
      if (endsDrag) {
        const { nodes, edges, past } = get()
        set({ past: [...past, { nodes, edges }].slice(-HISTORY_LIMIT), future: [] })
      }
      const structural = changes.some((c) => c.type !== 'select' && c.type !== 'dimensions')
      set((s) => ({
        nodes: applyNodeChanges<AppNode>(changes, s.nodes),
        dirty: s.dirty || structural,
      }))
    },

    onEdgesChange: (changes) =>
      set((s) => ({
        edges: applyEdgeChanges<AppEdge>(changes, s.edges),
        dirty: s.dirty || changes.some((c) => c.type !== 'select'),
      })),

    onConnect: (connection) => {
      const { nodes, edges, pushToast } = get()
      const { source, target, sourceHandle, targetHandle } = connection
      if (!source || !target || !sourceHandle || !targetHandle) return

      if (source === target) {
        pushToast('Tidak bisa menyambung port ke perangkat yang sama.', 'warn')
        return
      }

      const used = (deviceId: string, portId: string) =>
        edges.some(
          (e) =>
            (e.source === deviceId && e.sourceHandle === portId) ||
            (e.target === deviceId && e.targetHandle === portId),
        )

      const deviceOf = (id: string) => nodes.find((n): n is DeviceNode => n.id === id && isDeviceNode(n))
      const srcDev = deviceOf(source)
      const dstDev = deviceOf(target)
      const srcPort = srcDev?.data.ports.find((p) => p.id === sourceHandle)
      const dstPort = dstDev?.data.ports.find((p) => p.id === targetHandle)

      if (used(source, sourceHandle)) {
        pushToast(`Port ${srcPort?.name ?? ''} di ${srcDev?.data.hostname ?? ''} sudah terpakai.`, 'warn')
        return
      }
      if (used(target, targetHandle)) {
        pushToast(`Port ${dstPort?.name ?? ''} di ${dstDev?.data.hostname ?? ''} sudah terpakai.`, 'warn')
        return
      }

      const speed = slowerOf(srcPort?.speed, dstPort?.speed)
      if (srcPort && dstPort && srcPort.speed !== dstPort.speed) {
        pushToast(
          `Kecepatan port berbeda (${srcPort.speed} ↔ ${dstPort.speed}); link dipakai ${speed}.`,
          'warn',
        )
      }

      withHistory(() =>
        set((s) => ({
          edges: addEdge<AppEdge>(
            {
              ...connection,
              id: uid('lnk'),
              type: 'link',
              data: {
                speed,
                media: mediaForPort(srcPort),
                kind: 'single',
                label: '',
                vlans: '',
                color: null,
              },
            },
            s.edges,
          ),
        })),
      )
    },

    /* ── Perangkat ──────────────────────────────────────────────────────── */

    addDevice: (modelId, position) => {
      const model = getModel(modelId)
      if (!model) {
        get().pushToast(`Model "${modelId}" tidak ada di katalog.`, 'error')
        return
      }
      const ports = buildPorts(model)
      const node: DeviceNode = {
        id: uid('dev'),
        type: 'device',
        position,
        data: {
          modelId,
          hostname: autoHostname(modelId, get().nodes),
          role: model.role,
          mgmtIp: '',
          loopback: '',
          site: get().site,
          notes: '',
          ports,
          expanded: ports.length <= 16,
        },
      }
      withHistory(() => set((s) => ({ nodes: [...s.nodes, node] })))
    },

    updateDevice: (id, patch) =>
      withHistory(() =>
        patchNode(id, (n) => (isDeviceNode(n) ? { ...n, data: { ...n.data, ...patch } } : n)),
      ),

    updatePort: (deviceId, portId, patch) =>
      withHistory(() =>
        patchNode(deviceId, (n) =>
          isDeviceNode(n)
            ? {
                ...n,
                data: {
                  ...n.data,
                  ports: n.data.ports.map((p) => (p.id === portId ? { ...p, ...patch } : p)),
                },
              }
            : n,
        ),
      ),

    addPort: (deviceId) =>
      withHistory(() =>
        patchNode(deviceId, (n) => {
          if (!isDeviceNode(n)) return n
          const port: Port = {
            id: uid('p'),
            name: nextPortName(n.data.ports),
            speed: '1G',
            media: 'rj45',
            description: '',
            side: n.data.ports.length % 2 === 0 ? 'left' : 'right',
          }
          return { ...n, data: { ...n.data, ports: [...n.data.ports, port] } }
        }),
      ),

    removePort: (deviceId, portId) => {
      const { edges } = get()
      const attached = edges.some(
        (e) =>
          (e.source === deviceId && e.sourceHandle === portId) ||
          (e.target === deviceId && e.targetHandle === portId),
      )
      if (attached) {
        get().pushToast('Port masih terpakai oleh sebuah link — hapus link-nya dulu.', 'warn')
        return
      }
      withHistory(() =>
        patchNode(deviceId, (n) =>
          isDeviceNode(n)
            ? { ...n, data: { ...n.data, ports: n.data.ports.filter((p) => p.id !== portId) } }
            : n,
        ),
      )
    },

    toggleExpanded: (deviceId) =>
      patchNode(deviceId, (n) =>
        isDeviceNode(n) ? { ...n, data: { ...n.data, expanded: !n.data.expanded } } : n,
      ),

    /* ── Link ───────────────────────────────────────────────────────────── */

    updateLink: (edgeId, patch) =>
      withHistory(() =>
        set((s) => ({
          edges: s.edges.map((e) =>
            e.id === edgeId && e.data ? { ...e, data: { ...e.data, ...patch } } : e,
          ),
        })),
      ),

    setLinkEndpoint: (edgeId, side, portId) => {
      const { edges } = get()
      const edge = edges.find((e) => e.id === edgeId)
      if (!edge) return false
      const deviceId = side === 'a' ? edge.source : edge.target
      const clash = edges.some(
        (e) =>
          e.id !== edgeId &&
          ((e.source === deviceId && e.sourceHandle === portId) ||
            (e.target === deviceId && e.targetHandle === portId)),
      )
      if (clash) {
        get().pushToast('Port itu sudah dipakai link lain.', 'warn')
        return false
      }
      withHistory(() =>
        set((s) => ({
          edges: s.edges.map((e) =>
            e.id === edgeId
              ? side === 'a'
                ? { ...e, sourceHandle: portId }
                : { ...e, targetHandle: portId }
              : e,
          ),
        })),
      )
      return true
    },

    changeModel: (deviceId, modelId) => {
      const model = getModel(modelId)
      if (!model) return
      const { edges } = get()
      if (edges.some((e) => e.source === deviceId || e.target === deviceId)) {
        get().pushToast('Lepas dulu semua link perangkat ini sebelum mengganti model.', 'warn')
        return
      }
      const ports = buildPorts(model)
      withHistory(() =>
        patchNode(deviceId, (n) =>
          isDeviceNode(n)
            ? {
                ...n,
                data: { ...n.data, modelId, role: model.role, ports, expanded: ports.length <= 16 },
              }
            : n,
        ),
      )
    },

    flipLink: (edgeId) =>
      withHistory(() =>
        set((s) => ({
          edges: s.edges.map((e) =>
            e.id === edgeId
              ? {
                  ...e,
                  source: e.target,
                  target: e.source,
                  sourceHandle: e.targetHandle,
                  targetHandle: e.sourceHandle,
                }
              : e,
          ),
        })),
      ),

    /* ── Group & catatan ────────────────────────────────────────────────── */

    addGroup: (position) =>
      withHistory(() =>
        set((s) => ({
          nodes: [
            {
              id: uid('grp'),
              type: 'group' as const,
              position,
              width: 460,
              height: 320,
              zIndex: -1,
              data: { label: 'Area / POP', color: '#6366f1' },
            },
            ...s.nodes,
          ],
        })),
      ),

    addNote: (position) =>
      withHistory(() =>
        set((s) => ({
          nodes: [
            ...s.nodes,
            {
              id: uid('note'),
              type: 'note' as const,
              position,
              width: 220,
              height: 130,
              data: { text: 'Catatan…', color: '#fde68a' },
            },
          ],
        })),
      ),

    updateNodeData: (id, patch) =>
      withHistory(() =>
        patchNode(id, (n) => ({ ...n, data: { ...n.data, ...patch } }) as AppNode),
      ),

    /* ── Seleksi ────────────────────────────────────────────────────────── */

    deleteSelected: () => {
      const { nodes, edges } = get()
      const selNodes = new Set(nodes.filter((n) => n.selected).map((n) => n.id))
      const selEdges = new Set(edges.filter((e) => e.selected).map((e) => e.id))
      if (selNodes.size === 0 && selEdges.size === 0) return
      withHistory(() =>
        set({
          nodes: nodes.filter((n) => !selNodes.has(n.id)),
          edges: edges.filter(
            (e) => !selEdges.has(e.id) && !selNodes.has(e.source) && !selNodes.has(e.target),
          ),
        }),
      )
    },

    duplicateSelected: () => {
      const { nodes } = get()
      const selected = nodes.filter((n) => n.selected)
      if (selected.length === 0) return
      const copies: AppNode[] = selected.map((n) => {
        const position = { x: n.position.x + 48, y: n.position.y + 48 }
        if (isDeviceNode(n)) {
          return {
            ...n,
            id: uid('dev'),
            position,
            selected: false,
            data: {
              ...n.data,
              hostname: autoHostname(n.data.modelId, nodes),
              ports: n.data.ports.map((p) => ({ ...p, id: uid('p') })),
            },
          } satisfies AppNode
        }
        return { ...n, id: uid(n.type ?? 'node'), position, selected: false } as AppNode
      })
      withHistory(() =>
        set((s) => ({ nodes: [...s.nodes.map((n) => ({ ...n, selected: false })), ...copies] })),
      )
    },

    selectOnly: (id) =>
      set((s) => ({
        nodes: s.nodes.map((n) => ({ ...n, selected: n.id === id })),
        edges: s.edges.map((e) => ({ ...e, selected: e.id === id })),
      })),

    clearSelection: () =>
      set((s) => ({
        nodes: s.nodes.map((n) => ({ ...n, selected: false })),
        edges: s.edges.map((e) => ({ ...e, selected: false })),
      })),

    /* ── Project ────────────────────────────────────────────────────────── */

    setProjectMeta: (patch) => set({ ...patch, dirty: true }),

    replaceAll: ({ nodes, edges, projectId, projectName, site }) =>
      set((s) => ({
        nodes,
        edges,
        projectId: projectId ?? s.projectId,
        projectName: projectName ?? s.projectName,
        site: site ?? s.site,
        past: [],
        future: [],
        dirty: false,
      })),

    setNodesEdges: (nodes, edges) => withHistory(() => set({ nodes, edges })),

    /* ── History ────────────────────────────────────────────────────────── */

    undo: () => {
      const { past, future, nodes, edges } = get()
      const prev = past.at(-1)
      if (!prev) return
      set({
        nodes: prev.nodes,
        edges: prev.edges,
        past: past.slice(0, -1),
        future: [...future, { nodes, edges }].slice(-HISTORY_LIMIT),
        dirty: true,
      })
    },

    redo: () => {
      const { past, future, nodes, edges } = get()
      const next = future.at(-1)
      if (!next) return
      set({
        nodes: next.nodes,
        edges: next.edges,
        future: future.slice(0, -1),
        past: [...past, { nodes, edges }].slice(-HISTORY_LIMIT),
        dirty: true,
      })
    },

    commit: () => {
      const { nodes, edges, past } = get()
      set({ past: [...past, { nodes, edges }].slice(-HISTORY_LIMIT), future: [] })
    },

    /* ── Toast ──────────────────────────────────────────────────────────── */

    pushToast: (text, tone = 'info') => {
      const id = uid('t')
      set((s) => ({ toasts: [...s.toasts, { id, text, tone }] }))
      setTimeout(() => get().dismissToast(id), 4200)
    },

    dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),

    markClean: () => set({ dirty: false }),
  }
})
