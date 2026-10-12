import { formatCidr, isUsableHost, parseCidr, parseIp } from '@/lib/ip'
import { uid } from '@/lib/id'
import { comparePortName, DEFAULT_SWITCHING } from '@/lib/ports'
import { formatVlanList, MAX_VLAN, MIN_VLAN, parseVlanList } from '@/lib/vlans'
import type { DeviceNodeData } from '@/store/types'
import type { Port, TrunkMode } from '@/types/topology'
import { CliError, type DeviceEnv } from './types'

/**
 * Operasi konfigurasi yang dipakai bersama oleh semua dialek. Setiap fungsi
 * murni: menerima data perangkat, mengembalikan salinan baru, dan melempar
 * CliError bila perubahan tidak mungkin di topologi ini.
 */

export type IfaceFields = Pick<
  Port,
  'linkType' | 'pvid' | 'allowedVlans' | 'untaggedVlans' | 'ipAddress' | 'shutdown' | 'description'
>

export interface IfaceView extends IfaceFields {
  id: string
  name: string
  kind: 'port' | 'trunk'
  /** Trunk: id port anggota. */
  memberIds: string[]
  /** Trunk: lacp / static. */
  mode: TrunkMode | null
  /** Port: id trunk yang memilikinya. */
  memberOf: string | null
}

/** Trunk dulu, lalu port fisik dalam urutan alami — urutan yang dipakai keluaran CLI. */
export function ifaceList(d: DeviceNodeData): IfaceView[] {
  const owner = new Map<string, string>()
  for (const t of d.trunks) for (const m of t.memberIds) owner.set(m, t.id)
  return [
    ...[...d.trunks]
      .sort((a, b) => comparePortName(a.name, b.name))
      .map((t): IfaceView => ({ ...t, kind: 'trunk', memberIds: t.memberIds, mode: t.mode, memberOf: null })),
    ...[...d.ports]
      .sort((a, b) => comparePortName(a.name, b.name))
      .map((p): IfaceView => ({ ...p, kind: 'port', memberIds: [], mode: null, memberOf: owner.get(p.id) ?? null })),
  ]
}

export function findIface(d: DeviceNodeData, name: string): IfaceView | null {
  const n = name.toLowerCase()
  return ifaceList(d).find((i) => i.name.toLowerCase() === n) ?? null
}

export function mustIface(d: DeviceNodeData, name: string): IfaceView {
  const i = findIface(d, name)
  if (!i) throw new CliError(`The interface ${name} does not exist.`)
  return i
}

/** Ubah field interface (port atau trunk) berdasarkan namanya. */
export function patchIface(
  d: DeviceNodeData,
  name: string,
  fn: (cur: IfaceView) => Partial<IfaceFields>,
): DeviceNodeData {
  const cur = mustIface(d, name)
  const patch = fn(cur)
  if (cur.kind === 'trunk') {
    return { ...d, trunks: d.trunks.map((t) => (t.id === cur.id ? { ...t, ...patch } : t)) }
  }
  return { ...d, ports: d.ports.map((p) => (p.id === cur.id ? { ...p, ...patch } : p)) }
}

/** Kembalikan konfigurasi L2/L3 interface ke bawaan (deskripsi & shutdown dibiarkan). */
export const CLEAR_L2L3: Partial<IfaceFields> = {
  linkType: 'none',
  pvid: null,
  allowedVlans: '',
  untaggedVlans: '',
  ipAddress: '',
}

export function setHostname(d: DeviceNodeData, name: string): DeviceNodeData {
  const host = name.trim()
  if (!host) throw new CliError('The host name cannot be empty.')
  return { ...d, hostname: host }
}

export function setLoopback(d: DeviceNodeData, ip: string): DeviceNodeData {
  return { ...d, loopback: ip }
}

/* ── Alamat ───────────────────────────────────────────────────────────────── */

/** Validasi alamat host + prefix; mengembalikan bentuk "a.b.c.d/nn". */
export function hostAddress(ip: string, prefix: number): string {
  const c = parseCidr(`${ip}/${prefix}`)
  if (!c) throw new CliError(`The IP address ${ip} is invalid.`)
  if (!isUsableHost(c)) {
    throw new CliError(
      'The specified IP address is invalid.',
      `${ip}/${prefix} adalah alamat jaringan atau broadcast — pakai alamat host di dalam subnet itu.`,
    )
  }
  return formatCidr(c)
}

/** Pastikan alamat ini belum dipakai interface lain di perangkat yang sama (subnet tumpang tindih). */
export function checkOverlap(d: DeviceNodeData, ifaceName: string, cidr: string): void {
  const c = parseCidr(cidr)
  if (!c) return
  for (const i of ifaceList(d)) {
    if (i.name === ifaceName || i.linkType !== 'routed') continue
    const o = parseCidr(i.ipAddress)
    if (!o) continue
    const lo = Math.max(o.prefix, c.prefix)
    const mask = lo === 0 ? 0 : (0xffffffff << (32 - lo)) >>> 0
    if (((o.addr & mask) >>> 0) === ((c.addr & mask) >>> 0)) {
      throw new CliError(
        `The address overlaps with ${i.name} (${i.ipAddress}).`,
        `Subnet ${cidr} bertumpuk dengan alamat di ${i.name}.`,
      )
    }
  }
}

/* ── Trunk / bonding ───────────────────────────────────────────────────────── */

export function ensureTrunk(d: DeviceNodeData, name: string, mode: TrunkMode = 'lacp'): DeviceNodeData {
  if (d.trunks.some((t) => t.name.toLowerCase() === name.toLowerCase())) return d
  if (d.ports.some((p) => p.name.toLowerCase() === name.toLowerCase())) {
    throw new CliError(`${name} is a physical interface.`)
  }
  return {
    ...d,
    trunks: [
      ...d.trunks,
      {
        id: uid('trk'),
        name,
        mode,
        memberIds: [],
        description: '',
        side: d.trunks.length % 2 === 0 ? 'left' : 'right',
        ...DEFAULT_SWITCHING,
      },
    ],
  }
}

export function deleteTrunk(
  d: DeviceNodeData,
  env: DeviceEnv,
  name: string,
  opts: { releaseMembers: boolean },
): DeviceNodeData {
  const t = d.trunks.find((x) => x.name.toLowerCase() === name.toLowerCase())
  if (!t) throw new CliError(`The interface ${name} does not exist.`)
  if (env.linked.has(t.id)) {
    throw new CliError(`${t.name} is cabled in the topology.`, `Hapus dulu kabel yang menempel di ${t.name} di kanvas.`)
  }
  if (t.memberIds.length > 0 && !opts.releaseMembers) {
    throw new CliError(
      `${t.name} still has member ports.`,
      `Keluarkan dulu port anggotanya dari ${t.name}, baru hapus trunk-nya.`,
    )
  }
  return { ...d, trunks: d.trunks.filter((x) => x.id !== t.id) }
}

export function joinTrunk(d: DeviceNodeData, env: DeviceEnv, trunkName: string, portName: string): DeviceNodeData {
  const t = d.trunks.find((x) => x.name.toLowerCase() === trunkName.toLowerCase())
  if (!t) throw new CliError(`${trunkName} does not exist.`, `Buat dulu interface ${trunkName}.`)
  const p = d.ports.find((x) => x.name.toLowerCase() === portName.toLowerCase())
  if (!p) throw new CliError(`${portName} cannot join an aggregate.`)
  if (t.memberIds.includes(p.id)) return d
  const other = d.trunks.find((x) => x.memberIds.includes(p.id))
  if (other) {
    throw new CliError(`The interface is already a member of ${other.name}.`)
  }
  if (env.linked.has(p.id)) {
    throw new CliError(
      `${p.name} has its own link in the topology.`,
      `Kabel di kanvas menempel langsung di ${p.name}. Pindahkan kabelnya ke ${t.name} dulu, baru masukkan port ini.`,
    )
  }
  return { ...d, trunks: d.trunks.map((x) => (x.id === t.id ? { ...x, memberIds: [...x.memberIds, p.id] } : x)) }
}

export function leaveTrunk(d: DeviceNodeData, portName: string): DeviceNodeData {
  const p = d.ports.find((x) => x.name.toLowerCase() === portName.toLowerCase())
  if (!p) return d
  return { ...d, trunks: d.trunks.map((t) => ({ ...t, memberIds: t.memberIds.filter((m) => m !== p.id) })) }
}

export function setTrunkMode(d: DeviceNodeData, name: string, mode: TrunkMode): DeviceNodeData {
  return { ...d, trunks: d.trunks.map((t) => (t.name.toLowerCase() === name.toLowerCase() ? { ...t, mode } : t)) }
}

/* ── Rute statis ──────────────────────────────────────────────────────────── */

export function addRoute(d: DeviceNodeData, ip: string, prefix: number, nextHop: string): DeviceNodeData {
  const dest = parseCidr(`${ip}/${prefix}`)
  if (!dest || parseIp(nextHop) === null) throw new CliError('Wrong parameter found.')
  const net = (dest.addr & (prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0)) >>> 0
  const text = formatCidr({ addr: net, prefix })
  if (d.staticRoutes.some((r) => r.prefix === text && r.nextHop === nextHop)) return d
  return { ...d, staticRoutes: [...d.staticRoutes, { prefix: text, nextHop }] }
}

export function removeRoute(d: DeviceNodeData, ip: string, prefix: number, nextHop?: string): DeviceNodeData {
  const dest = parseCidr(`${ip}/${prefix}`)
  if (!dest) throw new CliError('Wrong parameter found.')
  const net = (dest.addr & (prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0)) >>> 0
  const text = formatCidr({ addr: net, prefix })
  const keep = d.staticRoutes.filter((r) => !(r.prefix === text && (!nextHop || r.nextHop === nextHop)))
  if (keep.length === d.staticRoutes.length) throw new CliError('The route does not exist.')
  return { ...d, staticRoutes: keep }
}

/* ── Daftar VLAN ──────────────────────────────────────────────────────────── */

/**
 * Baca daftar VLAN ketikan CLI. Menerima gaya Huawei (`10 20 30 to 40`),
 * Cisco/MikroTik (`10,20,30-40`), dan Junos (`[ 10 20 ]`).
 */
export function parseVlanWords(text: string): number[] {
  const cleaned = text
    .replace(/[[\]]/g, ' ')
    .replace(/\s+to\s+/gi, '-')
    .trim()
  if (/^all$/i.test(cleaned)) return range(MIN_VLAN, MAX_VLAN)
  const parsed = parseVlanList(cleaned)
  if (!parsed.ok || parsed.vlans.length === 0) {
    throw new CliError('Wrong parameter found.', parsed.ok ? 'Daftar VLAN kosong.' : parsed.error)
  }
  return parsed.vlans
}

function range(a: number, b: number): number[] {
  return Array.from({ length: b - a + 1 }, (_, i) => a + i)
}

export function vlanUnion(list: string, add: number[]): string {
  const cur = parseVlanList(list)
  return formatVlanList([...(cur.ok ? cur.vlans : []), ...add])
}

export function vlanMinus(list: string, remove: number[]): string {
  const cur = parseVlanList(list)
  const drop = new Set(remove)
  return formatVlanList((cur.ok ? cur.vlans : []).filter((v) => !drop.has(v)))
}

export function vlanNums(list: string): number[] {
  const p = parseVlanList(list)
  return p.ok ? p.vlans : []
}

/** Semua VLAN yang muncul di perangkat ini — bahan `vlan batch` dan `show vlan`. */
export function deviceVlans(d: DeviceNodeData): number[] {
  const out = new Set<number>()
  for (const i of ifaceList(d)) {
    if (i.linkType === 'access' && i.pvid) out.add(i.pvid)
    if (i.linkType === 'trunk' || i.linkType === 'hybrid') {
      for (const v of vlanNums(i.allowedVlans)) out.add(v)
      for (const v of vlanNums(i.untaggedVlans)) out.add(v)
      if (i.pvid) out.add(i.pvid)
    }
  }
  return [...out].sort((a, b) => a - b)
}

/** Kelompokkan VLAN berurutan: [1,2,3,7] → [[1,3],[7,7]] */
export function vlanRuns(vlans: number[]): [number, number][] {
  const runs: [number, number][] = []
  for (const v of [...vlans].sort((a, b) => a - b)) {
    const last = runs.at(-1)
    if (last && v === last[1] + 1) last[1] = v
    else runs.push([v, v])
  }
  return runs
}
