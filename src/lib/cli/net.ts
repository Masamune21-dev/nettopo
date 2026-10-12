import { getModel, type DeviceModel } from '@/data/deviceCatalog'
import type { IfaceConfig } from '@/lib/iface'
import { contains, type Cidr, networkOf, parseCidr, parseIp } from '@/lib/ip'
import { parseVlanList } from '@/lib/vlans'
import type { AppEdge, AppNode, DeviceNodeData } from '@/store/types'
import { isDeviceNode } from '@/store/types'
import type { Speed } from '@/types/topology'

/**
 * Simulasi jaringan untuk CLI: status interface, tetangga, tabel routing,
 * serta perjalanan paket ping/traceroute.
 *
 * Model yang disimulasikan sengaja jujur terhadap data topologi — tidak ada
 * protokol routing dinamis. Router hanya tahu jaringan yang tersambung
 * langsung dan rute statis yang dikonfigurasi, persis seperti router sungguhan
 * yang belum diberi OSPF/IS-IS/BGP. Di lapisan 2, frame mengikuti VLAN
 * access/trunk/hybrid tiap port, sehingga VLAN yang tidak cocok benar-benar
 * memutus ping.
 */

export interface NetIface {
  deviceId: string
  /** Id port/trunk, atau 'lo' untuk loopback. */
  id: string
  name: string
  kind: 'port' | 'trunk' | 'loopback'
  cfg: IfaceConfig & { shutdown: boolean }
  description: string
  speed: Speed | null
  /** Trunk induk bila port ini anggota bonding. */
  memberOf: string | null
  peer: { deviceId: string; id: string } | null
  linkId: string | null
  /** Status fisik (PHY): ada kabel, kedua ujung tidak shutdown, trunk punya anggota. */
  up: boolean
  /** Alamat L3 yang benar-benar terpasang (routed + IP sah). */
  addr: Cidr | null
}

export interface NetDevice {
  id: string
  data: DeviceNodeData
  model: DeviceModel | undefined
  ifaces: NetIface[]
  byId: Map<string, NetIface>
  /** Perangkat pasif (ODC/ODP/splitter) dan media converter meneruskan apa saja tanpa melihat VLAN. */
  transparent: boolean
}

export interface Net {
  devices: Map<string, NetDevice>
}

export type RouteProto = 'direct' | 'local' | 'static'

export interface Route {
  dest: Cidr
  proto: RouteProto
  nextHop: number | null
  iface: NetIface
}

const L3_ROLES = new Set(['core-router', 'bng', 'router', 'firewall', 'server', 'cpe', 'internet'])

/** Port fisik di router secara bawaan berperilaku L3; di switch bawaannya L2. */
export function isL3Device(data: DeviceNodeData): boolean {
  return L3_ROLES.has(data.role)
}

/** "10.255.0.1" atau "10.255.0.1/32" → Cidr /32 */
export function loopbackCidr(text: string): Cidr | null {
  const t = text.trim()
  if (!t) return null
  const c = parseCidr(t.includes('/') ? t : `${t}/32`)
  return c
}

export function buildNet(nodes: AppNode[], edges: AppEdge[]): Net {
  const devices = new Map<string, NetDevice>()

  for (const n of nodes) {
    if (!isDeviceNode(n)) continue
    const d = n.data
    const memberOf = new Map<string, string>()
    for (const t of d.trunks) for (const m of t.memberIds) memberOf.set(m, t.id)

    const ifaces: NetIface[] = [
      ...d.trunks.map(
        (t): NetIface => ({
          deviceId: n.id,
          id: t.id,
          name: t.name,
          kind: 'trunk',
          cfg: t,
          description: t.description,
          speed: d.ports.find((p) => p.id === t.memberIds[0])?.speed ?? null,
          memberOf: null,
          peer: null,
          linkId: null,
          up: false,
          addr: null,
        }),
      ),
      ...d.ports.map(
        (p): NetIface => ({
          deviceId: n.id,
          id: p.id,
          name: p.name,
          kind: 'port',
          cfg: p,
          description: p.description,
          speed: p.speed,
          memberOf: memberOf.get(p.id) ?? null,
          peer: null,
          linkId: null,
          up: false,
          addr: null,
        }),
      ),
    ]
    const lo = loopbackCidr(d.loopback)
    if (lo) {
      ifaces.push({
        deviceId: n.id,
        id: 'lo',
        name: 'loopback',
        kind: 'loopback',
        cfg: { linkType: 'routed', pvid: null, allowedVlans: '', untaggedVlans: '', ipAddress: '', shutdown: false },
        description: '',
        speed: null,
        memberOf: null,
        peer: null,
        linkId: null,
        up: true,
        addr: lo,
      })
    }
    const model = getModel(d.modelId)
    devices.set(n.id, {
      id: n.id,
      data: d,
      model,
      ifaces,
      byId: new Map(ifaces.map((i) => [i.id, i])),
      transparent: d.role === 'passive' || d.role === 'converter',
    })
  }

  for (const e of edges) {
    const a = devices.get(e.source)?.byId.get(e.sourceHandle ?? '')
    const b = devices.get(e.target)?.byId.get(e.targetHandle ?? '')
    if (!a || !b) continue
    a.peer = { deviceId: b.deviceId, id: b.id }
    b.peer = { deviceId: a.deviceId, id: a.id }
    a.linkId = e.id
    b.linkId = e.id
  }

  // Bisa meneruskan: tidak shutdown, dan trunk punya minimal satu anggota yang hidup.
  const carries = (i: NetIface): boolean => {
    if (i.cfg.shutdown) return false
    if (i.kind !== 'trunk') return true
    const dev = devices.get(i.deviceId)!
    const t = dev.data.trunks.find((x) => x.id === i.id)
    return (t?.memberIds ?? []).some((m) => !dev.byId.get(m)?.cfg.shutdown)
  }

  for (const dev of devices.values()) {
    for (const i of dev.ifaces) {
      if (i.kind === 'loopback' || !i.peer) continue
      const p = devices.get(i.peer.deviceId)?.byId.get(i.peer.id)
      i.up = Boolean(p) && carries(i) && carries(p!)
    }
    // Anggota trunk ikut status trunk-nya; kabelnya digambar di trunk, bukan di port.
    for (const i of dev.ifaces) {
      if (i.memberOf) i.up = Boolean(dev.byId.get(i.memberOf)?.up) && !i.cfg.shutdown
    }
    for (const i of dev.ifaces) {
      if (i.kind === 'loopback' || i.memberOf || i.cfg.linkType !== 'routed') continue
      i.addr = parseCidr(i.cfg.ipAddress)
    }
  }

  return { devices }
}

export function peerOf(net: Net, i: NetIface): NetIface | null {
  if (!i.peer) return null
  return net.devices.get(i.peer.deviceId)?.byId.get(i.peer.id) ?? null
}

/* ── Lapisan 2 ─────────────────────────────────────────────────────────────── */

function vlanSets(cfg: IfaceConfig) {
  const tagged = parseVlanList(cfg.allowedVlans)
  const untagged = parseVlanList(cfg.untaggedVlans)
  return {
    tagged: new Set(tagged.ok ? tagged.vlans : []),
    untagged: new Set(untagged.ok ? untagged.vlans : []),
    pvid: cfg.pvid ?? 1,
  }
}

/** VLAN yang dipakai frame tanpa tag saat masuk port ini; null = dibuang. */
function ingressUntagged(cfg: IfaceConfig): number | null {
  const s = vlanSets(cfg)
  if (cfg.linkType === 'access') return cfg.pvid ?? 1
  if (cfg.linkType === 'trunk') return s.tagged.has(s.pvid) || cfg.pvid !== null ? s.pvid : null
  if (cfg.linkType === 'hybrid') return s.pvid
  return null
}

/** Apakah frame bertag `vlan` diterima port ini. */
function ingressTagged(cfg: IfaceConfig, vlan: number): boolean {
  const s = vlanSets(cfg)
  if (cfg.linkType === 'trunk') return s.tagged.has(vlan) || vlan === s.pvid
  if (cfg.linkType === 'hybrid') return s.tagged.has(vlan) || s.untagged.has(vlan) || vlan === s.pvid
  return false
}

/** Cara frame VLAN `vlan` keluar dari port ini: 'untagged', 'tagged', atau null (tidak keluar). */
function egress(cfg: IfaceConfig, vlan: number): 'untagged' | 'tagged' | null {
  const s = vlanSets(cfg)
  if (cfg.linkType === 'access') return (cfg.pvid ?? 1) === vlan ? 'untagged' : null
  if (cfg.linkType === 'trunk') {
    if (vlan === s.pvid && (cfg.pvid !== null || s.tagged.has(vlan))) return 'untagged'
    return s.tagged.has(vlan) ? 'tagged' : null
  }
  if (cfg.linkType === 'hybrid') {
    if (s.untagged.has(vlan) || vlan === s.pvid) return 'untagged'
    return s.tagged.has(vlan) ? 'tagged' : null
  }
  return null
}

/** Interface "tingkat atas" di perangkat: trunk dan port yang bukan anggota trunk. */
function topIfaces(dev: NetDevice): NetIface[] {
  return dev.ifaces.filter((i) => i.kind !== 'loopback' && !i.memberOf)
}

/**
 * Semua interface L3 yang satu broadcast domain dengan `from` — yaitu yang
 * bisa dijangkau ARP. Frame keluar tanpa tag lewat kabel `from`, lalu
 * mengikuti VLAN di setiap switch yang dilewatinya.
 */
export function l2Neighbors(net: Net, from: NetIface): NetIface[] {
  const found: NetIface[] = []
  const seen = new Set<string>()
  const queue: { iface: NetIface; tag: number | null }[] = []

  const send = (out: NetIface, tag: number | null) => {
    if (!out.up) return
    const p = peerOf(net, out)
    if (p) queue.push({ iface: p, tag })
  }
  send(from, null)

  while (queue.length > 0) {
    const { iface, tag } = queue.shift()!
    const key = `${iface.deviceId}:${iface.id}:${tag ?? '-'}`
    if (seen.has(key) || !iface.up) continue
    seen.add(key)
    const dev = net.devices.get(iface.deviceId)!

    if (dev.transparent) {
      for (const o of topIfaces(dev)) if (o !== iface) send(o, tag)
      continue
    }

    const cfg = iface.cfg
    if (cfg.linkType === 'routed') {
      if (tag === null && iface.addr) found.push(iface)
      continue
    }
    const vlan = tag === null ? ingressUntagged(cfg) : ingressTagged(cfg, tag) ? tag : null
    if (vlan === null) continue

    const vkey = `${dev.id}:vlan${vlan}`
    if (seen.has(vkey)) continue
    seen.add(vkey)
    for (const o of topIfaces(dev)) {
      if (o === iface) continue
      const how = egress(o.cfg, vlan)
      if (how) send(o, how === 'tagged' ? vlan : null)
    }
  }
  return found
}

/* ── Lapisan 3 ─────────────────────────────────────────────────────────────── */

export function routesOf(dev: NetDevice): Route[] {
  const routes: Route[] = []
  for (const i of dev.ifaces) {
    if (!i.addr || !i.up) continue
    if (i.addr.prefix < 32) routes.push({ dest: { addr: networkOf(i.addr), prefix: i.addr.prefix }, proto: 'direct', nextHop: null, iface: i })
    routes.push({ dest: { addr: i.addr.addr, prefix: 32 }, proto: i.kind === 'loopback' ? 'direct' : 'local', nextHop: null, iface: i })
  }
  const direct = routes.filter((r) => r.proto === 'direct' && r.dest.prefix < 32)
  for (const s of dev.data.staticRoutes) {
    const dest = parseCidr(s.prefix)
    const nh = parseIp(s.nextHop)
    if (!dest || nh === null) continue
    // Next-hop harus berada di jaringan yang tersambung langsung (rekursi satu tingkat).
    const via = longest(direct, nh)
    if (!via) continue
    routes.push({ dest: { addr: networkOf(dest), prefix: dest.prefix }, proto: 'static', nextHop: nh, iface: via.iface })
  }
  return routes
}

function longest(routes: Route[], ip: number): Route | null {
  let best: Route | null = null
  for (const r of routes) {
    if (!contains(r.dest, { addr: ip, prefix: 32 })) continue
    if (!best || r.dest.prefix > best.dest.prefix) best = r
  }
  return best
}

export function lookup(dev: NetDevice, ip: number): Route | null {
  return longest(
    routesOf(dev).filter((r) => r.proto !== 'local'),
    ip,
  )
}

export function ownsAddress(dev: NetDevice, ip: number): NetIface | null {
  return dev.ifaces.find((i) => i.addr && i.addr.addr === ip && (i.up || i.kind === 'loopback')) ?? null
}

export interface Hop {
  deviceId: string
  /** Alamat interface penerima di hop ini. */
  ip: number
}

export type PathResult =
  | { ok: true; hops: Hop[]; src: number | null }
  | { ok: false; hops: Hop[]; src: number | null; reason: 'no-route' | 'unresolved' | 'ttl'; at: string }

/** Telusuri paket dari `fromId` ke `dst`, hop demi hop. */
export function trace(net: Net, fromId: string, dst: number, maxHops = 30): PathResult {
  const hops: Hop[] = []
  let cur = net.devices.get(fromId)
  let src: number | null = null
  for (let ttl = 0; cur && ttl < maxHops; ttl += 1) {
    if (ownsAddress(cur, dst)) return { ok: true, hops, src: src ?? dst }
    const route = lookup(cur, dst)
    if (!route) return { ok: false, hops, src, reason: 'no-route', at: cur.id }
    if (src === null) src = route.iface.addr?.addr ?? null
    const nh = route.nextHop ?? dst
    const next = l2Neighbors(net, route.iface).find(
      (n) => n.addr?.addr === nh && contains({ addr: networkOf(route.iface.addr!), prefix: route.iface.addr!.prefix }, { addr: nh, prefix: 32 }),
    )
    if (!next) return { ok: false, hops, src, reason: 'unresolved', at: cur.id }
    hops.push({ deviceId: next.deviceId, ip: next.addr!.addr })
    cur = net.devices.get(next.deviceId)
  }
  return { ok: false, hops, src, reason: 'ttl', at: cur?.id ?? fromId }
}

export interface PingResult {
  /** Balasan diterima. */
  ok: boolean
  /** Tidak ada rute sama sekali di perangkat asal. */
  noRoute: boolean
  src: number | null
  hops: number
  /** Perangkat pemilik alamat tujuan, bila paket sampai. */
  target: string | null
}

/** Ping dianggap berhasil bila paket sampai DAN balasannya bisa pulang. */
export function ping(net: Net, fromId: string, dst: number, source?: number): PingResult {
  const there = trace(net, fromId, dst)
  const src = source ?? there.src
  if (!there.ok) {
    return { ok: false, noRoute: there.reason === 'no-route' && there.at === fromId, src, hops: there.hops.length, target: null }
  }
  const target = there.hops.at(-1)?.deviceId ?? fromId
  if (target === fromId || src === null) return { ok: true, noRoute: false, src, hops: 0, target }
  const back = trace(net, target, src)
  return { ok: back.ok, noRoute: false, src, hops: there.hops.length, target }
}

export interface TraceHop {
  ip: number | null
  deviceId: string | null
}

/** Baris-baris traceroute: tiap hop membalas dari interface penerimanya bila balasannya bisa pulang. */
export function traceroute(net: Net, fromId: string, dst: number): { hops: TraceHop[]; reached: boolean } {
  const path = trace(net, fromId, dst)
  const src = path.src
  const hops: TraceHop[] = path.hops.map((h) => {
    const back = src === null ? null : trace(net, h.deviceId, src)
    return back?.ok ? { ip: h.ip, deviceId: h.deviceId } : { ip: null, deviceId: null }
  })
  return { hops, reached: path.ok && hops.at(-1)?.ip === dst }
}

/** Waktu tempuh tiruan yang stabil: makin banyak hop makin lama, sedikit acak per urutan. */
export function rtt(hops: number, seq: number, seed: number): number {
  const jitter = ((seed >>> (seq % 16)) & 7) / 10
  return Math.max(1, hops) * 0.6 + jitter
}
