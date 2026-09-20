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
import { buildPorts, DEFAULT_SWITCHING, nextPortName } from '@/lib/ports'
import { isTrunkMember, nextTrunkName, summarizeTrunk, trunkOfPort } from '@/lib/trunks'
import {
  alignNodes,
  type AlignMode,
  autoLayout,
  autoPortSides,
  clearWaypoints,
  countWaypoints,
  distributeNodes,
  type DistributeMode,
  type LayoutDirection,
  refitGroups,
} from '@/lib/layout'
import type { LinkMedia, Port, Speed, Trunk, Waypoint } from '@/types/topology'
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
  updatePorts: (deviceId: string, portIds: string[], patch: Partial<Port>) => void
  addPort: (deviceId: string) => void
  removePort: (deviceId: string, portId: string) => void
  toggleExpanded: (deviceId: string) => void

  createTrunk: (deviceId: string, memberIds: string[]) => void
  updateTrunk: (deviceId: string, trunkId: string, patch: Partial<Trunk>) => void
  deleteTrunk: (deviceId: string, trunkId: string) => void
  addTrunkMembers: (deviceId: string, trunkId: string, portIds: string[]) => void
  removeTrunkMember: (deviceId: string, trunkId: string, portId: string) => void

  updateLink: (edgeId: string, patch: Partial<AppEdge['data']>) => void
  flipLink: (edgeId: string) => void
  /** Dipakai saat titik belok sedang digeser — sengaja tanpa history. */
  setWaypoints: (edgeId: string, waypoints: Waypoint[]) => void
  addWaypoint: (edgeId: string, index: number, point: Waypoint) => void
  removeWaypoint: (edgeId: string, index: number) => void
  straightenLink: (edgeId: string) => void
  /** Isi alamat IP kedua ujung sebuah link dalam satu langkah riwayat. */
  assignLinkAddresses: (edgeId: string, aIp: string, bIp: string) => void

  /** Geser satu node sejauh dx/dy — dipakai untuk meluruskan kabel. */
  nudgeNode: (nodeId: string, dx: number, dy: number) => void
  alignSelected: (mode: AlignMode) => void
  distributeSelected: (mode: DistributeMode) => void
  tidyUp: (direction: LayoutDirection) => void
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

interface ResolvedHandle {
  kind: 'port' | 'trunk'
  name: string
  speed: Speed | undefined
  media: LinkMedia
  memberCount: number
}

/** Sebuah handle di node bisa port fisik atau trunk; keduanya diperlakukan seragam. */
function resolveHandle(device: DeviceNode, handleId: string): ResolvedHandle | undefined {
  const trunk = device.data.trunks.find((t) => t.id === handleId)
  if (trunk) {
    const summary = summarizeTrunk(trunk, device.data.ports)
    const first = device.data.ports.find((p) => p.id === trunk.memberIds[0])
    return {
      kind: 'trunk',
      name: trunk.name,
      speed: summary.memberSpeed ?? first?.speed,
      media: mediaForPort(first),
      memberCount: summary.count,
    }
  }
  const port = device.data.ports.find((p) => p.id === handleId)
  if (!port) return undefined
  return { kind: 'port', name: port.name, speed: port.speed, media: mediaForPort(port), memberCount: 1 }
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

      const busy = (deviceId: string, handleId: string) =>
        edges.some(
          (e) =>
            (e.source === deviceId && e.sourceHandle === handleId) ||
            (e.target === deviceId && e.targetHandle === handleId),
        )

      const deviceOf = (id: string) => nodes.find((n): n is DeviceNode => n.id === id && isDeviceNode(n))
      const srcDev = deviceOf(source)
      const dstDev = deviceOf(target)
      const src = srcDev ? resolveHandle(srcDev, sourceHandle) : undefined
      const dst = dstDev ? resolveHandle(dstDev, targetHandle) : undefined

      if (busy(source, sourceHandle)) {
        pushToast(`${src?.name ?? 'Port'} di ${srcDev?.data.hostname ?? ''} sudah terpakai.`, 'warn')
        return
      }
      if (busy(target, targetHandle)) {
        pushToast(`${dst?.name ?? 'Port'} di ${dstDev?.data.hostname ?? ''} sudah terpakai.`, 'warn')
        return
      }

      const speed = slowerOf(src?.speed, dst?.speed)
      const isBundle = src?.kind === 'trunk' || dst?.kind === 'trunk'

      if (src && dst && src.speed && dst.speed && src.speed !== dst.speed) {
        pushToast(
          `Kecepatan berbeda (${src.speed} ↔ ${dst.speed}); link dipakai ${speed}.`,
          'warn',
        )
      }
      if (src?.kind === 'trunk' && dst?.kind === 'trunk' && src.memberCount !== dst.memberCount) {
        pushToast(
          `Jumlah anggota trunk berbeda: ${src.name} ${src.memberCount} port ↔ ${dst.name} ${dst.memberCount} port.`,
          'warn',
        )
      }
      if (src && dst && src.kind !== dst.kind) {
        const trunkSide = src.kind === 'trunk' ? src : dst
        pushToast(`${trunkSide.name} disambung ke port tunggal — pastikan ini memang disengaja.`, 'warn')
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
                media: src?.media ?? 'fiber',
                kind: isBundle ? 'lacp' : 'single',
                label: '',
                vlans: '',
                color: null,
                routing: 'bezier',
                waypoints: [],
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
          trunks: [],
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

    /** Terapkan satu perubahan ke banyak port sekaligus (mis. set VLAN massal). */
    updatePorts: (deviceId, portIds, patch) => {
      if (portIds.length === 0) return
      const target = new Set(portIds)
      withHistory(() =>
        patchNode(deviceId, (n) =>
          isDeviceNode(n)
            ? {
                ...n,
                data: {
                  ...n.data,
                  ports: n.data.ports.map((p) => (target.has(p.id) ? { ...p, ...patch } : p)),
                },
              }
            : n,
        ),
      )
    },

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
            ...DEFAULT_SWITCHING,
          }
          return { ...n, data: { ...n.data, ports: [...n.data.ports, port] } }
        }),
      ),

    removePort: (deviceId, portId) => {
      const { edges, nodes } = get()
      const device = nodes.find((n): n is DeviceNode => n.id === deviceId && isDeviceNode(n))
      const owner = device ? trunkOfPort(device.data.trunks, portId) : undefined
      if (owner) {
        get().pushToast(`Port ini anggota ${owner.name} — keluarkan dari trunk dulu.`, 'warn')
        return
      }
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

    /* ── Trunk / bonding ────────────────────────────────────────────────── */

    createTrunk: (deviceId, memberIds) => {
      const { nodes, edges } = get()
      const device = nodes.find((n): n is DeviceNode => n.id === deviceId && isDeviceNode(n))
      if (!device) return
      if (memberIds.length < 2) {
        get().pushToast('Trunk butuh minimal 2 port anggota.', 'warn')
        return
      }

      const taken = memberIds.find((id) => isTrunkMember(device.data.trunks, id))
      if (taken) {
        const name = device.data.ports.find((p) => p.id === taken)?.name ?? ''
        get().pushToast(`Port ${name} sudah menjadi anggota trunk lain.`, 'warn')
        return
      }

      const linked = memberIds.find((id) =>
        edges.some(
          (e) =>
            (e.source === deviceId && e.sourceHandle === id) ||
            (e.target === deviceId && e.targetHandle === id),
        ),
      )
      if (linked) {
        const name = device.data.ports.find((p) => p.id === linked)?.name ?? ''
        get().pushToast(`Port ${name} masih punya link sendiri — hapus link itu dulu.`, 'warn')
        return
      }

      const os = getModel(device.data.modelId)?.os
      const trunk: Trunk = {
        id: uid('trk'),
        name: nextTrunkName(os, device.data.trunks),
        mode: 'lacp',
        memberIds: [...memberIds],
        description: '',
        side: device.data.trunks.length % 2 === 0 ? 'left' : 'right',
        ...DEFAULT_SWITCHING,
      }

      withHistory(() =>
        patchNode(deviceId, (n) =>
          isDeviceNode(n) ? { ...n, data: { ...n.data, trunks: [...n.data.trunks, trunk] } } : n,
        ),
      )
      get().pushToast(`${trunk.name} dibuat dengan ${memberIds.length} port anggota.`, 'ok')
    },

    updateTrunk: (deviceId, trunkId, patch) =>
      withHistory(() =>
        patchNode(deviceId, (n) =>
          isDeviceNode(n)
            ? {
                ...n,
                data: {
                  ...n.data,
                  trunks: n.data.trunks.map((t) => (t.id === trunkId ? { ...t, ...patch } : t)),
                },
              }
            : n,
        ),
      ),

    deleteTrunk: (deviceId, trunkId) =>
      withHistory(() =>
        set((s) => ({
          nodes: s.nodes.map((n) =>
            n.id === deviceId && isDeviceNode(n)
              ? { ...n, data: { ...n.data, trunks: n.data.trunks.filter((t) => t.id !== trunkId) } }
              : n,
          ),
          // Link yang menempel pada trunk ikut dilepas — port anggotanya kembali bebas.
          edges: s.edges.filter(
            (e) =>
              !(e.source === deviceId && e.sourceHandle === trunkId) &&
              !(e.target === deviceId && e.targetHandle === trunkId),
          ),
        })),
      ),

    addTrunkMembers: (deviceId, trunkId, portIds) => {
      const { nodes, edges } = get()
      const device = nodes.find((n): n is DeviceNode => n.id === deviceId && isDeviceNode(n))
      if (!device) return

      const usable = portIds.filter((id) => {
        if (isTrunkMember(device.data.trunks, id)) return false
        return !edges.some(
          (e) =>
            (e.source === deviceId && e.sourceHandle === id) ||
            (e.target === deviceId && e.targetHandle === id),
        )
      })
      if (usable.length === 0) {
        get().pushToast('Port yang dipilih sudah jadi anggota trunk atau sudah punya link.', 'warn')
        return
      }

      withHistory(() =>
        patchNode(deviceId, (n) =>
          isDeviceNode(n)
            ? {
                ...n,
                data: {
                  ...n.data,
                  trunks: n.data.trunks.map((t) =>
                    t.id === trunkId ? { ...t, memberIds: [...t.memberIds, ...usable] } : t,
                  ),
                },
              }
            : n,
        ),
      )
    },

    removeTrunkMember: (deviceId, trunkId, portId) => {
      const { nodes } = get()
      const device = nodes.find((n): n is DeviceNode => n.id === deviceId && isDeviceNode(n))
      const trunk = device?.data.trunks.find((t) => t.id === trunkId)
      if (trunk && trunk.memberIds.length <= 2) {
        get().pushToast(
          `${trunk.name} tinggal 2 anggota — hapus trunk-nya kalau memang tidak dipakai lagi.`,
          'warn',
        )
        return
      }
      withHistory(() =>
        patchNode(deviceId, (n) =>
          isDeviceNode(n)
            ? {
                ...n,
                data: {
                  ...n.data,
                  trunks: n.data.trunks.map((t) =>
                    t.id === trunkId
                      ? { ...t, memberIds: t.memberIds.filter((m) => m !== portId) }
                      : t,
                  ),
                },
              }
            : n,
        ),
      )
    },

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
                data: {
                  ...n.data,
                  modelId,
                  role: model.role,
                  ports,
                  trunks: [],
                  expanded: ports.length <= 16,
                },
              }
            : n,
        ),
      )
    },

    setWaypoints: (edgeId, waypoints) =>
      set((s) => ({
        edges: s.edges.map((e) => (e.id === edgeId && e.data ? { ...e, data: { ...e.data, waypoints } } : e)),
        dirty: true,
      })),

    addWaypoint: (edgeId, index, point) =>
      withHistory(() =>
        set((s) => ({
          edges: s.edges.map((e) => {
            if (e.id !== edgeId || !e.data) return e
            const next = [...e.data.waypoints]
            next.splice(index, 0, point)
            return { ...e, data: { ...e.data, waypoints: next } }
          }),
        })),
      ),

    removeWaypoint: (edgeId, index) =>
      withHistory(() =>
        set((s) => ({
          edges: s.edges.map((e) =>
            e.id === edgeId && e.data
              ? { ...e, data: { ...e.data, waypoints: e.data.waypoints.filter((_, i) => i !== index) } }
              : e,
          ),
        })),
      ),

    straightenLink: (edgeId) =>
      withHistory(() =>
        set((s) => ({
          edges: s.edges.map((e) =>
            e.id === edgeId && e.data ? { ...e, data: { ...e.data, waypoints: [] } } : e,
          ),
        })),
      ),

    assignLinkAddresses: (edgeId, aIp, bIp) => {
      const { edges } = get()
      const edge = edges.find((e) => e.id === edgeId)
      if (!edge) return

      const apply = (n: AppNode, handleId: string | null | undefined, ip: string): AppNode => {
        if (!isDeviceNode(n) || !handleId) return n
        return {
          ...n,
          data: {
            ...n.data,
            ports: n.data.ports.map((p) =>
              p.id === handleId ? { ...p, linkType: 'routed' as const, ipAddress: ip } : p,
            ),
            trunks: n.data.trunks.map((t) =>
              t.id === handleId ? { ...t, linkType: 'routed' as const, ipAddress: ip } : t,
            ),
          },
        }
      }

      withHistory(() =>
        set((s) => ({
          nodes: s.nodes.map((n) => {
            if (n.id === edge.source) return apply(n, edge.sourceHandle, aIp)
            if (n.id === edge.target) return apply(n, edge.targetHandle, bIp)
            return n
          }),
        })),
      )
    },

    /* ── Merapikan tata letak ───────────────────────────────────────────── */

    nudgeNode: (nodeId, dx, dy) => {
      if (dx === 0 && dy === 0) return
      withHistory(() =>
        set((s) => ({
          nodes: s.nodes.map((n) =>
            n.id === nodeId
              ? { ...n, position: { x: Math.round(n.position.x + dx), y: Math.round(n.position.y + dy) } }
              : n,
          ),
        })),
      )
    },

    alignSelected: (mode) => {
      const { nodes } = get()
      const ids = new Set(nodes.filter((n) => n.selected).map((n) => n.id))
      if (ids.size < 2) {
        get().pushToast('Pilih minimal 2 objek untuk disejajarkan.', 'info')
        return
      }
      withHistory(() => set({ nodes: alignNodes(nodes, ids, mode) }))
    },

    distributeSelected: (mode) => {
      const { nodes } = get()
      const ids = new Set(nodes.filter((n) => n.selected).map((n) => n.id))
      if (ids.size < 3) {
        get().pushToast('Pilih minimal 3 objek untuk disebar merata.', 'info')
        return
      }
      withHistory(() => set({ nodes: distributeNodes(nodes, ids, mode) }))
    },

    /**
     * Rapikan menyeluruh: susun berjenjang, pindahkan port ke sisi yang
     * menghadap lawannya, lalu buang titik belok yang jadi tidak relevan.
     */
    tidyUp: (direction) => {
      const { nodes, edges } = get()
      const bent = countWaypoints(edges)
      const laidOut = refitGroups(nodes, autoLayout(nodes, edges, direction))
      withHistory(() =>
        set({ nodes: autoPortSides(laidOut, edges), edges: clearWaypoints(edges) }),
      )
      get().pushToast(
        bent > 0
          ? `Tata letak dirapikan; ${bent} titik belok kabel ikut dibuang.`
          : 'Tata letak dan sisi port dirapikan.',
        'ok',
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
          const portIdMap = new Map(n.data.ports.map((p) => [p.id, uid('p')]))
          const portCopies = n.data.ports.map((p) => ({ ...p, id: portIdMap.get(p.id) as string }))
          return {
            ...n,
            id: uid('dev'),
            position,
            selected: false,
            data: {
              ...n.data,
              hostname: autoHostname(n.data.modelId, nodes),
              ports: portCopies,
              trunks: n.data.trunks.map((t) => ({
                ...t,
                id: uid('trk'),
                memberIds: t.memberIds.map((m) => portIdMap.get(m) ?? m),
              })),
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
