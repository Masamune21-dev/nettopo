import { summarizeTrunk } from '@/lib/trunks'
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

  // Trunk: anggota kurang, atau kecepatan anggotanya campur
  for (const d of devices) {
    for (const t of d.data.trunks) {
      const summary = summarizeTrunk(t, d.data.ports)
      if (summary.count < 2) {
        issues.push({
          id: `trunk-thin-${t.id}`,
          level: 'warn',
          nodeId: d.id,
          text: `${d.data.hostname} ${t.name} cuma punya ${summary.count} anggota — agregasi butuh minimal 2`,
        })
      }
      if (summary.memberSpeed === null && summary.count > 0) {
        issues.push({
          id: `trunk-mixed-${t.id}`,
          level: 'warn',
          nodeId: d.id,
          text: `${d.data.hostname} ${t.name} mencampur port dengan kecepatan berbeda`,
        })
      }
    }
  }

  // Beda kecepatan atau beda jumlah anggota di dua ujung link
  for (const e of edges) {
    const a = byId.get(e.source)
    const b = byId.get(e.target)
    const sideOf = (dev: typeof a, handle: string | null | undefined) => {
      if (!dev || !handle) return null
      const trunk = dev.data.trunks.find((t) => t.id === handle)
      if (trunk) {
        const s = summarizeTrunk(trunk, dev.data.ports)
        return { name: trunk.name, speed: s.memberSpeed, members: s.count, isTrunk: true }
      }
      const port = dev.data.ports.find((p) => p.id === handle)
      return port ? { name: port.name, speed: port.speed, members: 1, isTrunk: false } : null
    }
    const sa = sideOf(a, e.sourceHandle)
    const sb = sideOf(b, e.targetHandle)
    if (!sa || !sb) continue

    if (sa.speed && sb.speed && sa.speed !== sb.speed) {
      issues.push({
        id: `speed-${e.id}`,
        level: 'warn',
        edgeId: e.id,
        text: `${a?.data.hostname} ${sa.name} (${sa.speed}) ↔ ${b?.data.hostname} ${sb.name} (${sb.speed}) beda kecepatan`,
      })
    }
    if (sa.isTrunk && sb.isTrunk && sa.members !== sb.members) {
      issues.push({
        id: `trunk-members-${e.id}`,
        level: 'warn',
        edgeId: e.id,
        text: `${a?.data.hostname} ${sa.name} ${sa.members} anggota ↔ ${b?.data.hostname} ${sb.name} ${sb.members} anggota`,
      })
    }
    if (sa.isTrunk !== sb.isTrunk) {
      const trunkSide = sa.isTrunk ? { host: a?.data.hostname, n: sa.name } : { host: b?.data.hostname, n: sb.name }
      issues.push({
        id: `trunk-single-${e.id}`,
        level: 'info',
        edgeId: e.id,
        text: `${trunkSide.host} ${trunkSide.n} tersambung ke port tunggal di sisi lawan`,
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
