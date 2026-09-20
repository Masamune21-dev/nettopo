import dagre from '@dagrejs/dagre'
import type { AppEdge, AppNode } from '@/store/types'
import { isDeviceNode, isGroupNode } from '@/store/types'
import type { DeviceRole, Waypoint } from '@/types/topology'

/** Tingkat hierarki tiap role — menentukan urutan lapisan saat auto-layout. */
const TIER: Record<DeviceRole, number> = {
  internet: 0,
  'core-router': 1,
  bng: 1,
  firewall: 1,
  ssw: 2,
  'metro-switch': 3,
  router: 3,
  switch: 4,
  'access-switch': 4,
  olt: 4,
  converter: 4,
  server: 5,
  passive: 5,
  cpe: 6,
}

export type LayoutDirection = 'TB' | 'LR'

/**
 * Susun ulang posisi device secara berjenjang (internet → core → SSW → akses).
 * Node group dan catatan dibiarkan di tempatnya.
 */
export function autoLayout(
  nodes: AppNode[],
  edges: AppEdge[],
  direction: LayoutDirection = 'TB',
): AppNode[] {
  const devices = nodes.filter(isDeviceNode)
  if (devices.length === 0) return nodes

  const g = new dagre.graphlib.Graph()
  g.setGraph({
    rankdir: direction,
    nodesep: direction === 'TB' ? 60 : 46,
    ranksep: direction === 'TB' ? 110 : 140,
    marginx: 40,
    marginy: 40,
  })
  g.setDefaultEdgeLabel(() => ({}))

  const size = new Map<string, { w: number; h: number }>()
  for (const n of devices) {
    const w = n.measured?.width ?? 240
    const h = n.measured?.height ?? 140
    size.set(n.id, { w, h })
    g.setNode(n.id, { width: w, height: h })
  }

  const tierOf = new Map(devices.map((d) => [d.id, TIER[d.data.role] ?? 3]))
  for (const e of edges) {
    if (!size.has(e.source) || !size.has(e.target)) continue
    const ts = tierOf.get(e.source) ?? 3
    const tt = tierOf.get(e.target) ?? 3
    // Arahkan dari tingkat lebih tinggi (core) ke lebih rendah (akses)
    if (tt < ts) g.setEdge(e.target, e.source)
    else g.setEdge(e.source, e.target)
  }

  dagre.layout(g)

  const positions = new Map<string, { x: number; y: number }>()
  for (const n of devices) {
    const p = g.node(n.id)
    const s = size.get(n.id)
    if (!p || !s) continue
    positions.set(n.id, { x: Math.round(p.x - s.w / 2), y: Math.round(p.y - s.h / 2) })
  }

  return nodes.map((n) => {
    const p = positions.get(n.id)
    return p ? { ...n, position: p, parentId: undefined } : n
  })
}


/**
 * Taruh tiap port/trunk yang punya link di sisi node yang menghadap lawannya.
 * Ini yang paling banyak mengurangi kabel melingkar: tanpa ini port bernomor
 * ganjil selalu di kiri walaupun perangkat tujuannya ada di kanan.
 */
export function autoPortSides(nodes: AppNode[], edges: AppEdge[]): AppNode[] {
  const centre = new Map<string, number>()
  for (const n of nodes) {
    centre.set(n.id, n.position.x + (n.measured?.width ?? 240) / 2)
  }

  /** handleId → x tengah perangkat lawan */
  const peerX = new Map<string, number>()
  for (const e of edges) {
    const a = centre.get(e.source)
    const b = centre.get(e.target)
    if (a === undefined || b === undefined) continue
    if (e.sourceHandle) peerX.set(`${e.source}:${e.sourceHandle}`, b)
    if (e.targetHandle) peerX.set(`${e.target}:${e.targetHandle}`, a)
  }

  return nodes.map((n) => {
    if (!isDeviceNode(n)) return n
    const own = centre.get(n.id) ?? 0
    const sideFor = (handleId: string, fallback: 'left' | 'right') => {
      const x = peerX.get(`${n.id}:${handleId}`)
      if (x === undefined) return fallback
      return x < own ? ('left' as const) : ('right' as const)
    }
    return {
      ...n,
      data: {
        ...n.data,
        ports: n.data.ports.map((p) => ({ ...p, side: sideFor(p.id, p.side) })),
        trunks: n.data.trunks.map((t) => ({ ...t, side: sideFor(t.id, t.side) })),
      },
    }
  })
}

const widthOf = (n: AppNode) => n.measured?.width ?? n.width ?? 240
const heightOf = (n: AppNode) => n.measured?.height ?? n.height ?? 140

const GROUP_PADDING = 36

/**
 * Setelah tata letak berubah, kotak area (POP) ikut disesuaikan supaya tetap
 * memeluk perangkat yang sama seperti sebelumnya — bukan tertinggal di posisi
 * lamanya. Isi kotak ditentukan dari perangkat yang tadinya berada di dalamnya.
 */
export function refitGroups(before: AppNode[], after: AppNode[]): AppNode[] {
  const groups = before.filter(isGroupNode)
  if (groups.length === 0) return after

  const posAfter = new Map(after.map((n) => [n.id, n]))

  /** groupId → id perangkat yang titik tengahnya ada di dalam kotak itu */
  const contained = new Map<string, string[]>()
  for (const g of groups) {
    const gw = g.width ?? g.measured?.width ?? 0
    const gh = g.height ?? g.measured?.height ?? 0
    const inside = before
      .filter(isDeviceNode)
      .filter((d) => {
        const cx = d.position.x + (d.measured?.width ?? 240) / 2
        const cy = d.position.y + (d.measured?.height ?? 140) / 2
        return cx >= g.position.x && cx <= g.position.x + gw && cy >= g.position.y && cy <= g.position.y + gh
      })
      .map((d) => d.id)
    contained.set(g.id, inside)
  }

  return after.map((n) => {
    if (!isGroupNode(n)) return n
    const ids = contained.get(n.id) ?? []
    if (ids.length === 0) return n

    const members = ids.map((id) => posAfter.get(id)).filter((d): d is AppNode => Boolean(d))
    if (members.length === 0) return n

    const minX = Math.min(...members.map((d) => d.position.x)) - GROUP_PADDING
    const minY = Math.min(...members.map((d) => d.position.y)) - GROUP_PADDING
    const maxX = Math.max(...members.map((d) => d.position.x + widthOf(d))) + GROUP_PADDING
    const maxY = Math.max(...members.map((d) => d.position.y + heightOf(d))) + GROUP_PADDING

    return {
      ...n,
      position: { x: Math.round(minX), y: Math.round(minY) },
      width: Math.round(maxX - minX),
      height: Math.round(maxY - minY),
    }
  })
}

export type AlignMode = 'left' | 'hcenter' | 'right' | 'top' | 'vcenter' | 'bottom'
export type DistributeMode = 'horizontal' | 'vertical'

/** Ratakan node terpilih pada satu garis — seperti tool diagram pada umumnya. */
export function alignNodes(nodes: AppNode[], ids: Set<string>, mode: AlignMode): AppNode[] {
  const picked = nodes.filter((n) => ids.has(n.id))
  if (picked.length < 2) return nodes

  const lefts = picked.map((n) => n.position.x)
  const rights = picked.map((n) => n.position.x + widthOf(n))
  const tops = picked.map((n) => n.position.y)
  const bottoms = picked.map((n) => n.position.y + heightOf(n))

  const minX = Math.min(...lefts)
  const maxX = Math.max(...rights)
  const minY = Math.min(...tops)
  const maxY = Math.max(...bottoms)
  const midX = (minX + maxX) / 2
  const midY = (minY + maxY) / 2

  return nodes.map((n) => {
    if (!ids.has(n.id)) return n
    const { x, y } = n.position
    switch (mode) {
      case 'left':
        return { ...n, position: { x: minX, y } }
      case 'right':
        return { ...n, position: { x: maxX - widthOf(n), y } }
      case 'hcenter':
        return { ...n, position: { x: Math.round(midX - widthOf(n) / 2), y } }
      case 'top':
        return { ...n, position: { x, y: minY } }
      case 'bottom':
        return { ...n, position: { x, y: maxY - heightOf(n) } }
      case 'vcenter':
        return { ...n, position: { x, y: Math.round(midY - heightOf(n) / 2) } }
      default:
        return n
    }
  })
}

/** Beri jarak yang sama antar node terpilih. */
export function distributeNodes(
  nodes: AppNode[],
  ids: Set<string>,
  mode: DistributeMode,
): AppNode[] {
  const picked = nodes.filter((n) => ids.has(n.id))
  if (picked.length < 3) return nodes

  const horizontal = mode === 'horizontal'
  const sorted = [...picked].sort((a, b) =>
    horizontal ? a.position.x - b.position.x : a.position.y - b.position.y,
  )
  const size = (n: AppNode) => (horizontal ? widthOf(n) : heightOf(n))
  const start = horizontal ? sorted[0]!.position.x : sorted[0]!.position.y
  const last = sorted.at(-1)!
  const end = (horizontal ? last.position.x : last.position.y) + size(last)
  const totalSize = sorted.reduce((sum, n) => sum + size(n), 0)
  const gap = (end - start - totalSize) / (sorted.length - 1)

  const moved = new Map<string, number>()
  let cursor = start
  for (const n of sorted) {
    moved.set(n.id, Math.round(cursor))
    cursor += size(n) + gap
  }

  return nodes.map((n) => {
    const v = moved.get(n.id)
    if (v === undefined) return n
    return { ...n, position: horizontal ? { x: v, y: n.position.y } : { x: n.position.x, y: v } }
  })
}

/** Buang titik belok yang sudah tidak relevan setelah node dipindah. */
export function clearWaypoints(edges: AppEdge[]): AppEdge[] {
  return edges.map((e) =>
    e.data && e.data.waypoints.length > 0 ? { ...e, data: { ...e.data, waypoints: [] } } : e,
  )
}

export const countWaypoints = (edges: AppEdge[]): number =>
  edges.reduce((sum, e) => sum + (e.data?.waypoints.length ?? 0), 0)

export type { Waypoint }
