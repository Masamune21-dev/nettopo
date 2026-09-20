import dagre from '@dagrejs/dagre'
import type { AppEdge, AppNode } from '@/store/types'
import { isDeviceNode } from '@/store/types'
import type { DeviceRole } from '@/types/topology'

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
  server: 5,
  cpe: 5,
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
