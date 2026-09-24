import { getModel } from '@/data/deviceCatalog'
import { uid } from '@/lib/id'
import { autoLayout, autoPortSides, clearWaypoints } from '@/lib/layout'
import { buildPorts } from '@/lib/ports'
import type { AppEdge, AppNode, DeviceNodeData } from '@/store/types'
import { isDeviceNode, isGroupNode } from '@/store/types'
import type { BuildPlan, TidyPlan } from '@/lib/aiTasks'

export interface ApplyResult {
  nodes: AppNode[]
  edges: AppEdge[]
  /** Hal yang tidak bisa diterapkan — ditampilkan apa adanya ke pengguna. */
  warnings: string[]
}

const GROUP_PADDING = 40
const GROUP_COLORS = ['#6366f1', '#0ea5e9', '#10b981', '#f59e0b', '#a855f7', '#ef4444']

/**
 * Terapkan rencana pengelompokan dari AI: susun ulang dengan algoritma, lalu
 * gambar kotak area mengelilingi anggota tiap kelompok. AI hanya menentukan
 * siapa masuk kelompok mana; koordinatnya tetap dihitung dagre.
 */
export function applyTidyPlan(plan: TidyPlan, nodes: AppNode[], edges: AppEdge[]): ApplyResult {
  const warnings: string[] = []
  const devices = nodes.filter(isDeviceNode)
  const byHost = new Map(devices.map((d) => [d.data.hostname.toLowerCase(), d.id]))

  const claimed = new Set<string>()
  const resolved = plan.groups.map((g) => {
    const ids: string[] = []
    for (const host of g.devices) {
      const id = byHost.get(host.trim().toLowerCase())
      if (!id) {
        warnings.push(`Perangkat "${host}" disebut AI tapi tidak ada di topologi — dilewati.`)
        continue
      }
      if (claimed.has(id)) {
        warnings.push(`"${host}" disebut di lebih dari satu kelompok — dipakai yang pertama.`)
        continue
      }
      claimed.add(id)
      ids.push(id)
    }
    return { label: g.label, ids }
  })

  // Kotak area lama dibuang; yang baru dibuat mengikuti rencana.
  const withoutGroups = nodes.filter((n) => !isGroupNode(n))
  const laidOut = autoPortSides(autoLayout(withoutGroups, edges, plan.direction), edges)
  const placed = new Map(laidOut.map((n) => [n.id, n]))

  const groupNodes: AppNode[] = resolved
    .filter((g) => g.ids.length > 0)
    .map((g, i) => {
      const members = g.ids.map((id) => placed.get(id)).filter((n): n is AppNode => Boolean(n))
      const minX = Math.min(...members.map((n) => n.position.x)) - GROUP_PADDING
      const minY = Math.min(...members.map((n) => n.position.y)) - GROUP_PADDING
      const maxX =
        Math.max(...members.map((n) => n.position.x + (n.measured?.width ?? 240))) + GROUP_PADDING
      const maxY =
        Math.max(...members.map((n) => n.position.y + (n.measured?.height ?? 140))) + GROUP_PADDING
      return {
        id: uid('grp'),
        type: 'group' as const,
        position: { x: Math.round(minX), y: Math.round(minY) },
        width: Math.round(maxX - minX),
        height: Math.round(maxY - minY),
        zIndex: -1,
        data: { label: g.label, color: GROUP_COLORS[i % GROUP_COLORS.length] as string },
      }
    })

  return { nodes: [...groupNodes, ...laidOut], edges: clearWaypoints(edges), warnings }
}

/** Bangun topologi baru dari rancangan AI, sambil memeriksa tiap rujukannya. */
export function applyBuildPlan(plan: BuildPlan): ApplyResult {
  const warnings: string[] = []
  const nodes: AppNode[] = []
  const byHost = new Map<string, { id: string; data: DeviceNodeData }>()

  for (const d of plan.devices) {
    // Kunci pencarian link memakai hostname yang di-trim; simpan dengan bentuk sama.
    const hostname = d.hostname.trim()
    const model = getModel(d.modelId)
    if (!model) {
      warnings.push(`Model "${d.modelId}" untuk ${hostname} tidak ada di katalog — perangkat dilewati.`)
      continue
    }
    if (byHost.has(hostname.toLowerCase())) {
      warnings.push(`Hostname "${hostname}" muncul dua kali — yang kedua dilewati.`)
      continue
    }
    const ports = buildPorts(model)
    const data: DeviceNodeData = {
      modelId: d.modelId,
      hostname,
      role: model.role,
      mgmtIp: d.mgmtIp,
      loopback: '',
      site: d.site || plan.site,
      notes: '',
      ports,
      trunks: [],
      expanded: ports.length <= 16,
    }
    const id = uid('dev')
    byHost.set(hostname.toLowerCase(), { id, data })
    nodes.push({ id, type: 'device', position: { x: 0, y: 0 }, data })
  }

  const used = new Set<string>()
  const edges: AppEdge[] = []

  for (const l of plan.links) {
    const a = byHost.get(l.aHost.trim().toLowerCase())
    const b = byHost.get(l.bHost.trim().toLowerCase())
    if (!a || !b) {
      warnings.push(`Link ${l.aHost} ↔ ${l.bHost} menyebut perangkat yang tidak dibuat — dilewati.`)
      continue
    }
    const pa = a.data.ports.find((p) => p.name === l.aPort)
    const pb = b.data.ports.find((p) => p.name === l.bPort)
    if (!pa) {
      warnings.push(`${l.aHost} tidak punya port "${l.aPort}" — link dilewati.`)
      continue
    }
    if (!pb) {
      warnings.push(`${l.bHost} tidak punya port "${l.bPort}" — link dilewati.`)
      continue
    }
    if (used.has(pa.id) || used.has(pb.id)) {
      warnings.push(`Port ${l.aPort} atau ${l.bPort} dipakai lebih dari sekali — link dilewati.`)
      continue
    }
    used.add(pa.id)
    used.add(pb.id)

    edges.push({
      id: uid('lnk'),
      type: 'link',
      source: a.id,
      target: b.id,
      sourceHandle: pa.id,
      targetHandle: pb.id,
      data: {
        speed: l.speed,
        media: pa.media === 'rj45' ? 'copper' : 'fiber',
        kind: 'single',
        label: '',
        vlans: '',
        color: null,
        routing: 'bezier',
        waypoints: [],
      },
    })
  }

  // Posisi awal diserahkan ke algoritma, bukan ke AI.
  return { nodes: autoLayout(nodes, edges, 'TB'), edges, warnings }
}
