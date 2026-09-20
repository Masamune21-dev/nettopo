import type { AppEdge, AppNode, DeviceNode } from '@/store/types'
import { isDeviceNode } from '@/store/types'
import type { Issue } from '@/lib/validate'
import {
  type Cidr,
  broadcastOf,
  formatCidr,
  formatIp,
  isUsableHost,
  networkOf,
  overlaps,
  parseCidr,
  sameSubnet,
  usableCount,
} from './ip'

export interface AddressedIface {
  deviceId: string
  hostname: string
  /** Id port fisik atau trunk. */
  ifaceId: string
  ifaceName: string
  cidr: Cidr
  raw: string
}

export interface SubnetUse {
  /** Alamat jaringannya, bukan alamat host. */
  network: Cidr
  members: AddressedIface[]
  /** Berapa alamat host yang muat di blok ini. */
  capacity: number
}

export interface UnaddressedLink {
  edgeId: string
  aHost: string
  aIface: string
  bHost: string
  bIface: string
}

export interface IpamReport {
  interfaces: AddressedIface[]
  subnets: SubnetUse[]
  /** Link L3 yang kedua ujungnya belum beralamat. */
  unaddressed: UnaddressedLink[]
  issues: Issue[]
}

interface IfaceRef {
  id: string
  name: string
  linkType: string
  ipAddress: string
}

const ifacesOf = (d: DeviceNode): IfaceRef[] => [
  ...d.data.ports.map((p) => ({ id: p.id, name: p.name, linkType: p.linkType, ipAddress: p.ipAddress })),
  ...d.data.trunks.map((t) => ({ id: t.id, name: t.name, linkType: t.linkType, ipAddress: t.ipAddress })),
]

/**
 * Telaah seluruh pengalamatan di topologi: daftar interface beralamat,
 * kelompok subnet, link L3 yang belum diberi alamat, dan masalah yang
 * ditemukan.
 */
export function analyzeIpam(nodes: AppNode[], edges: AppEdge[]): IpamReport {
  const devices = nodes.filter(isDeviceNode)
  const byId = new Map(devices.map((d) => [d.id, d]))
  const interfaces: AddressedIface[] = []
  const issues: Issue[] = []

  for (const d of devices) {
    for (const i of ifacesOf(d)) {
      if (!i.ipAddress.trim()) continue
      const cidr = parseCidr(i.ipAddress)
      if (!cidr) {
        issues.push({
          id: `ip-bad-${d.id}-${i.id}`,
          level: 'warn',
          nodeId: d.id,
          text: `${d.data.hostname} ${i.name}: "${i.ipAddress}" bukan alamat IP yang sah`,
        })
        continue
      }
      if (!isUsableHost(cidr)) {
        const which = networkOf(cidr) === cidr.addr ? 'alamat jaringan' : 'alamat broadcast'
        issues.push({
          id: `ip-edge-${d.id}-${i.id}`,
          level: 'warn',
          nodeId: d.id,
          text: `${d.data.hostname} ${i.name}: ${formatCidr(cidr)} adalah ${which}, tidak bisa dipakai host`,
        })
      }
      interfaces.push({
        deviceId: d.id,
        hostname: d.data.hostname,
        ifaceId: i.id,
        ifaceName: i.name,
        cidr,
        raw: i.ipAddress,
      })
    }
  }

  // Alamat host yang sama dipakai lebih dari satu interface
  const byAddress = new Map<number, AddressedIface[]>()
  for (const a of interfaces) {
    byAddress.set(a.cidr.addr, [...(byAddress.get(a.cidr.addr) ?? []), a])
  }
  for (const [addr, list] of byAddress) {
    if (list.length < 2) continue
    issues.push({
      id: `ip-dup-${addr}`,
      level: 'warn',
      nodeId: list[0]!.deviceId,
      text: `Alamat ${formatIp(addr)} dipakai ${list.length} interface: ${list
        .map((x) => `${x.hostname} ${x.ifaceName}`)
        .join(', ')}`,
    })
  }

  // Kedua ujung link harus satu subnet
  const ifaceAt = (deviceId: string, handleId: string | null | undefined) =>
    interfaces.find((a) => a.deviceId === deviceId && a.ifaceId === handleId)

  const unaddressed: UnaddressedLink[] = []

  for (const e of edges) {
    const a = ifaceAt(e.source, e.sourceHandle)
    const b = ifaceAt(e.target, e.targetHandle)
    const devA = byId.get(e.source)
    const devB = byId.get(e.target)
    if (!devA || !devB) continue

    const nameOf = (dev: DeviceNode, handle: string | null | undefined) =>
      ifacesOf(dev).find((i) => i.id === handle)?.name ?? '?'
    const typeOf = (dev: DeviceNode, handle: string | null | undefined) =>
      ifacesOf(dev).find((i) => i.id === handle)?.linkType ?? 'none'

    const aRouted = typeOf(devA, e.sourceHandle) === 'routed'
    const bRouted = typeOf(devB, e.targetHandle) === 'routed'

    if (aRouted && bRouted && !a && !b) {
      unaddressed.push({
        edgeId: e.id,
        aHost: devA.data.hostname,
        aIface: nameOf(devA, e.sourceHandle),
        bHost: devB.data.hostname,
        bIface: nameOf(devB, e.targetHandle),
      })
      continue
    }

    if (a && b && !sameSubnet(a.cidr, b.cidr)) {
      issues.push({
        id: `ip-subnet-${e.id}`,
        level: 'warn',
        edgeId: e.id,
        text:
          `${a.hostname} ${a.ifaceName} (${formatCidr(a.cidr)}) ↔ ` +
          `${b.hostname} ${b.ifaceName} (${formatCidr(b.cidr)}) tidak berada di subnet yang sama`,
      })
    }

    if ((a && !b && bRouted) || (b && !a && aRouted)) {
      const kosong = a ? `${devB.data.hostname} ${nameOf(devB, e.targetHandle)}` : `${devA.data.hostname} ${nameOf(devA, e.sourceHandle)}`
      issues.push({
        id: `ip-half-${e.id}`,
        level: 'info',
        edgeId: e.id,
        text: `Hanya satu ujung link ini yang beralamat — ${kosong} masih kosong`,
      })
    }
  }

  // Kelompokkan per jaringan
  const grouped = new Map<string, SubnetUse>()
  for (const a of interfaces) {
    const net: Cidr = { addr: networkOf(a.cidr), prefix: a.cidr.prefix }
    const key = formatCidr(net)
    const existing = grouped.get(key)
    if (existing) existing.members.push(a)
    else grouped.set(key, { network: net, members: [a], capacity: usableCount(net.prefix) })
  }
  const subnets = [...grouped.values()].sort((x, y) => networkOf(x.network) - networkOf(y.network))

  // Subnet berbeda yang wilayahnya bertumpang tindih
  for (let i = 0; i < subnets.length; i += 1) {
    for (let j = i + 1; j < subnets.length; j += 1) {
      const x = subnets[i]!
      const y = subnets[j]!
      if (formatCidr(x.network) === formatCidr(y.network)) continue
      if (!overlaps(x.network, y.network)) continue
      issues.push({
        id: `ip-overlap-${formatCidr(x.network)}-${formatCidr(y.network)}`,
        level: 'warn',
        text: `Blok ${formatCidr(x.network)} dan ${formatCidr(y.network)} saling tumpang tindih`,
      })
    }
  }

  // Blok yang anggotanya melebihi kapasitas
  for (const s of subnets) {
    if (s.members.length > s.capacity) {
      issues.push({
        id: `ip-full-${formatCidr(s.network)}`,
        level: 'warn',
        text: `Blok ${formatCidr(s.network)} hanya muat ${s.capacity} host tapi dipakai ${s.members.length} interface`,
      })
    }
  }

  return { interfaces, subnets, unaddressed, issues }
}

/** Semua blok yang sudah terpakai — bahan untuk mencari blok kosong berikutnya. */
export function takenSubnets(report: IpamReport): Cidr[] {
  return report.subnets.map((s) => s.network)
}

export const subnetLabel = (s: SubnetUse): string =>
  `${formatCidr(s.network)} · ${s.members.length}/${s.capacity} terpakai · ` +
  `${formatIp(networkOf(s.network))}–${formatIp(broadcastOf(s.network))}`
