import type { AppEdge, AppNode } from '@/store/types'
import { isDeviceNode } from '@/store/types'

export interface Issue {
  id: string
  level: 'warn' | 'info'
  text: string
  nodeId?: string
  edgeId?: string
}

/**
 * Pemeriksaan ringan yang tidak menghalangi menggambar — hasilnya tampil
 * sebagai daftar peringatan yang bisa diklik untuk melompat ke objeknya.
 */
export function validateTopology(nodes: AppNode[], edges: AppEdge[]): Issue[] {
  const issues: Issue[] = []
  const devices = nodes.filter(isDeviceNode)
  const byId = new Map(devices.map((d) => [d.id, d]))

  // IP manajemen ganda
  const byIp = new Map<string, string[]>()
  for (const d of devices) {
    const ip = d.data.mgmtIp.trim()
    if (!ip) continue
    byIp.set(ip, [...(byIp.get(ip) ?? []), d.data.hostname])
  }
  for (const [ip, hosts] of byIp) {
    if (hosts.length > 1) {
      issues.push({
        id: `ip-${ip}`,
        level: 'warn',
        text: `IP manajemen ${ip} dipakai ${hosts.length} perangkat: ${hosts.join(', ')}`,
      })
    }
  }

  // Hostname ganda
  const byHost = new Map<string, number>()
  for (const d of devices) byHost.set(d.data.hostname, (byHost.get(d.data.hostname) ?? 0) + 1)
  for (const [host, count] of byHost) {
    if (count > 1) {
      issues.push({ id: `host-${host}`, level: 'warn', text: `Hostname "${host}" dipakai ${count} kali` })
    }
  }

  // Beda kecepatan antar port di satu link
  for (const e of edges) {
    const a = byId.get(e.source)
    const b = byId.get(e.target)
    const pa = a?.data.ports.find((p) => p.id === e.sourceHandle)
    const pb = b?.data.ports.find((p) => p.id === e.targetHandle)
    if (pa && pb && pa.speed !== pb.speed) {
      issues.push({
        id: `speed-${e.id}`,
        level: 'warn',
        edgeId: e.id,
        text: `${a?.data.hostname} ${pa.name} (${pa.speed}) ↔ ${b?.data.hostname} ${pb.name} (${pb.speed}) beda kecepatan`,
      })
    }
  }

  // Perangkat tanpa link
  const connected = new Set(edges.flatMap((e) => [e.source, e.target]))
  for (const d of devices) {
    if (!connected.has(d.id)) {
      issues.push({
        id: `orphan-${d.id}`,
        level: 'info',
        nodeId: d.id,
        text: `${d.data.hostname} belum tersambung ke perangkat mana pun`,
      })
    }
  }

  return issues
}
