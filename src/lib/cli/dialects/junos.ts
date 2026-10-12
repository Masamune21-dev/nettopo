import { formatIp, parseCidr } from '@/lib/ip'
import { formatVlanList } from '@/lib/vlans'
import type { DeviceNodeData } from '@/store/types'
import {
  applyPipes,
  type Args,
  errorLines,
  ms,
  pingHint,
  simulatePing,
  simulateTrace,
  type Spec,
  type SpecStyle,
  specComplete,
  specHelp,
  splitPipe,
  stats,
  tokenize,
  TRACE_STOP,
} from '../engine'
import { match, walk } from '../match'
import { isL3Device, l2Neighbors, routesOf } from '../net'
import {
  addRoute,
  CLEAR_L2L3,
  checkOverlap,
  deleteTrunk,
  deviceVlans,
  ensureTrunk,
  hostAddress,
  ifaceList,
  type IfaceFields,
  type IfaceView,
  joinTrunk,
  leaveTrunk,
  mustIface,
  parseVlanWords,
  patchIface,
  removeRoute,
  setHostname,
  setLoopback,
  setTrunkMode,
  vlanNums,
} from '../ops'
import { arpEntries, modelName, neighbors, netIface, uptime } from '../render'
import { col, macOf, row, type Token } from '../text'
import { type Change, CliError, type Ctx, type Dialect, type ExecResult, hint, type OutLine, out } from '../types'

/**
 * Juniper Junos. Semua perubahan konfigurasi masuk kandidat dulu dan baru
 * berlaku setelah `commit` — persis seperti perangkat aslinya. `show | compare`
 * memperlihatkan selisih kandidat terhadap konfigurasi yang berjalan.
 */

const USER = 'admin'

/* ── Pohon konfigurasi ───────────────────────────────────────────────────── */

interface JNode {
  key: string
  children?: JNode[]
}

const leaf = (key: string): JNode => ({ key })
const node = (key: string, children: JNode[]): JNode | null => (children.length ? { key, children } : null)
const nn = (xs: (JNode | null)[]): JNode[] => xs.filter((x): x is JNode => x !== null)

const quote = (s: string) => (/[\s;{}"]/.test(s) ? `"${s.replace(/"/g, '\\"')}"` : s)

function members(vlans: number[]): string {
  const items = formatVlanList(vlans).split(',').filter(Boolean)
  return items.length === 1 ? items[0]! : `[ ${items.join(' ')} ]`
}

function vlanName(ctx: Ctx, id: number): string {
  const hit = Object.entries(ctx.state.vars).find(([k, v]) => k.startsWith('vlan:') && Number(v) === id)
  return hit ? hit[0].slice(5) : `vlan${id}`
}

function ifaceNode(d: DeviceNodeData, i: IfaceView): JNode | null {
  const kids: (JNode | null)[] = []
  if (i.description) kids.push(leaf(`description ${quote(i.description)}`))
  if (i.shutdown) kids.push(leaf('disable'))
  if (i.memberOf) {
    const t = d.trunks.find((x) => x.id === i.memberOf)
    if (t) kids.push(node(isL3Device(d) ? 'gigether-options' : 'ether-options', [leaf(`802.3ad ${t.name}`)]))
    return node(i.name, nn(kids))
  }
  if (i.kind === 'trunk' && i.mode === 'lacp') kids.push(node('aggregated-ether-options', [node('lacp', [leaf('active')])!]))
  if ((i.linkType === 'trunk' || i.linkType === 'hybrid') && i.pvid && i.pvid !== 1) kids.push(leaf(`native-vlan-id ${i.pvid}`))
  let fam: JNode | null = null
  if (i.linkType === 'routed') {
    fam = { key: 'family inet', children: i.ipAddress ? [leaf(`address ${i.ipAddress}`)] : [] }
  } else if (i.linkType === 'access') {
    fam = node('family ethernet-switching', nn([leaf('interface-mode access'), i.pvid ? node('vlan', [leaf(`members ${i.pvid}`)]) : null]))
  } else if (i.linkType === 'trunk' || i.linkType === 'hybrid') {
    const v = [...vlanNums(i.allowedVlans), ...vlanNums(i.untaggedVlans)]
    fam = node('family ethernet-switching', nn([leaf('interface-mode trunk'), v.length ? node('vlan', [leaf(`members ${members(v)}`)]) : null]))
  }
  if (fam) kids.push({ key: 'unit 0', children: [fam] })
  return node(i.name, nn(kids))
}

function configTree(ctx: Ctx, d: DeviceNodeData): JNode[] {
  const ifaces = nn(ifaceList(d).map((i) => ifaceNode(d, i)))
  if (d.loopback) {
    const lo = d.loopback.includes('/') ? d.loopback : `${d.loopback}/32`
    ifaces.push({ key: 'lo0', children: [{ key: 'unit 0', children: [{ key: 'family inet', children: [leaf(`address ${lo}`)] }] }] })
  }
  const routes = new Map<string, string[]>()
  for (const r of d.staticRoutes) routes.set(r.prefix, [...(routes.get(r.prefix) ?? []), r.nextHop])
  const vlans = deviceVlans(d).filter((v) => v !== 1)
  return nn([
    node('system', [leaf(`host-name ${d.hostname}`)]),
    d.trunks.length ? node('chassis', [node('aggregated-devices', [node('ethernet', [leaf(`device-count ${d.trunks.length}`)])!])!]) : null,
    node('interfaces', ifaces),
    node('routing-options', nn([node('static', [...routes].map(([p, nhs]) => leaf(`route ${p} next-hop ${nhs.length > 1 ? `[ ${nhs.join(' ')} ]` : nhs[0]}`)))])),
    node('vlans', vlans.map((v) => ({ key: vlanName(ctx, v), children: [leaf(`vlan-id ${v}`)] }))),
  ])
}

function renderTree(nodes: JNode[], depth = 0): string[] {
  const pad = '    '.repeat(depth)
  const o: string[] = []
  for (const n of nodes) {
    if (n.children) {
      o.push(`${pad}${n.key} {`, ...renderTree(n.children, depth + 1), `${pad}}`)
    } else {
      o.push(`${pad}${n.key};`)
    }
  }
  return o
}

interface SetLine {
  path: string[]
  leaf: string
}

function flatten(nodes: JNode[], path: string[] = []): SetLine[] {
  const o: SetLine[] = []
  for (const n of nodes) {
    if (n.children) {
      if (n.children.length === 0) o.push({ path, leaf: n.key })
      o.push(...flatten(n.children, [...path, n.key]))
      continue
    }
    const m = /^(.*?)\[ (.*) \]$/.exec(n.key)
    if (m) for (const item of m[2]!.split(' ')) o.push({ path, leaf: `${m[1]}${item}` })
    else o.push({ path, leaf: n.key })
  }
  return o
}

const setText = (l: SetLine) => `set ${[...l.path, l.leaf].join(' ')}`

/** Cari sub-pohon pada hierarki `path` (kata per kata). */
function subtree(nodes: JNode[], path: string[]): JNode[] | null {
  let cur = nodes
  let i = 0
  while (i < path.length) {
    let found: JNode | undefined
    let used = 0
    for (const n of cur) {
      const words = n.key.split(' ')
      if (words.every((w, k) => w === path[i + k])) {
        found = n
        used = words.length
        break
      }
    }
    if (!found) return null
    i += used
    cur = found.children ?? []
  }
  return cur
}

function compare(ctx: Ctx): string[] {
  const a = flatten(configTree(ctx, ctx.active))
  const b = flatten(configTree(ctx, ctx.device))
  const as = new Set(a.map(setText))
  const bs = new Set(b.map(setText))
  const o: string[] = []
  let last = ''
  const emit = (l: SetLine, sign: '+' | '-') => {
    const head = `[edit${l.path.length ? ` ${l.path.join(' ')}` : ''}]`
    if (head !== last) o.push(head)
    last = head
    o.push(`${sign}   ${l.leaf};`)
  }
  for (const l of a) if (!bs.has(setText(l))) emit(l, '-')
  for (const l of b) if (!as.has(setText(l))) emit(l, '+')
  return o
}

/* ── Status operasional ──────────────────────────────────────────────────── */

function linkUp(ctx: Ctx, i: IfaceView): boolean {
  return Boolean(netIface(ctx, i.id)?.up)
}

function terse(ctx: Ctx, only?: string): string[] {
  const d = ctx.active
  const o = [row([['Interface', 24], ['Admin', 6], ['Link', 5], ['Proto', 9], ['Local', 22], ['Remote', 0]])]
  for (const i of ifaceList(d)) {
    if (only && i.name !== only) continue
    const admin = i.shutdown ? 'down' : 'up'
    const link = linkUp(ctx, i) ? 'up' : 'down'
    o.push(row([[i.name, 24], [admin, 6], [link, 0]]))
    if (i.memberOf) {
      const t = d.trunks.find((x) => x.id === i.memberOf)
      o.push(row([[`${i.name}.0`, 24], [admin, 6], [link, 5], ['aenet', 9], [`--> ${t?.name ?? ''}.0`, 0]]))
    } else if (i.linkType === 'routed') {
      o.push(row([[`${i.name}.0`, 24], [admin, 6], [link, 5], ['inet', 9], [i.ipAddress, 0]]))
    } else if (i.linkType !== 'none') {
      o.push(row([[`${i.name}.0`, 24], [admin, 6], [link, 5], ['eth-switch', 0]]))
    }
  }
  if (d.loopback && (!only || only === 'lo0')) {
    o.push(row([['lo0', 24], ['up', 6], ['up', 0]]))
    o.push(row([['lo0.0', 24], ['up', 6], ['up', 5], ['inet', 9], [d.loopback.split('/')[0]!, 22], ['--> 0/0', 0]]))
  }
  return o
}

function descriptions(ctx: Ctx): string[] {
  return [
    row([['Interface', 16], ['Admin', 6], ['Link', 5], ['Description', 0]]),
    ...ifaceList(ctx.active)
      .filter((i) => i.description)
      .map((i) => row([[i.name, 16], [i.shutdown ? 'down' : 'up', 6], [linkUp(ctx, i) ? 'up' : 'down', 5], [i.description, 0]])),
  ]
}

function lldp(ctx: Ctx): string[] {
  const owner = new Map(ifaceList(ctx.active).filter((i) => i.memberOf).map((i) => [i.name, ctx.active.trunks.find((t) => t.id === i.memberOf)?.name ?? '-']))
  return [
    row([['Local Interface', 19], ['Parent Interface', 20], ['Chassis Id', 20], ['Port info', 19], ['System Name', 0]]),
    ...neighbors(ctx).map((n) => row([[n.local, 19], [owner.get(n.local) ?? '-', 20], [macOf(n.host, 0), 20], [n.remote, 19], [n.host, 0]])),
  ]
}

function since(): string {
  const u = uptime()
  const p = (n: number) => String(n).padStart(2, '0')
  return u.days || u.weeks ? `${u.weeks}w${u.days}d ${p(u.hours)}:${p(u.minutes)}:${p(u.seconds)}` : `${p(u.hours)}:${p(u.minutes)}:${p(u.seconds)}`
}

function showRoute(ctx: Ctx): string[] {
  const dev = ctx.net().devices.get(ctx.env.deviceId)
  const routes = dev ? routesOf(dev) : []
  const unit = (n: string) => (n === 'loopback' ? 'lo0.0' : `${n}.0`)
  const o = [
    '',
    `inet.0: ${routes.length} destinations, ${routes.length} routes (${routes.length} active, 0 holddown, 0 hidden)`,
    '+ = Active Route, - = Last Active, * = Both',
    '',
  ]
  for (const r of [...routes].sort((a, b) => a.dest.addr - b.dest.addr || a.dest.prefix - b.dest.prefix)) {
    const dest = `${formatIp(r.dest.addr)}/${r.dest.prefix}`
    if (r.proto === 'static') o.push(`${col(dest, 19)}*[Static/5] ${since()}`, `                    >  to ${formatIp(r.nextHop!)} via ${unit(r.iface.name)}`)
    else if (r.proto === 'local') o.push(`${col(dest, 19)}*[Local/0] ${since()}`, `                       Local via ${unit(r.iface.name)}`)
    else o.push(`${col(dest, 19)}*[Direct/0] ${since()}`, `                    >  via ${unit(r.iface.name)}`)
  }
  return o
}

function lacp(ctx: Ctx): string[] {
  const list = ifaceList(ctx.active)
  const o: string[] = []
  for (const t of list.filter((i) => i.kind === 'trunk' && i.mode === 'lacp')) {
    const m = list.filter((x) => x.memberOf === t.id)
    o.push(
      `Aggregated interface: ${t.name}`,
      '    LACP state:       Role   Exp   Def  Dist  Col  Syn  Aggr  Timeout  Activity',
      ...m.flatMap((x) => {
        const ok = linkUp(ctx, x) ? 'Yes' : ' No'
        return [`      ${x.name.padEnd(13)}  Actor    No    No   ${ok}  ${ok}  ${ok}   Yes     Fast    Active`, `      ${x.name.padEnd(13)}Partner    No    No   ${ok}  ${ok}  ${ok}   Yes     Fast    Active`]
      }),
      '    LACP protocol:        Receive State  Transmit State          Mux State',
      ...m.map((x) => `      ${x.name.padEnd(22)}${linkUp(ctx, x) ? 'Current   Fast periodic Collecting distributing' : 'Port disabled     No periodic           Detached'}`),
      '',
    )
  }
  return o
}

function showVlans(ctx: Ctx): string[] {
  const list = ifaceList(ctx.active).filter((i) => !i.memberOf)
  const o = [row([['Routing instance', 24], ['VLAN name', 22], ['Tag', 13], ['Interfaces', 0]])]
  for (const v of deviceVlans(ctx.active)) {
    o.push(row([['default-switch', 24], [vlanName(ctx, v), 22], [String(v), 0]]))
    for (const i of list) {
      const has = i.linkType === 'access' ? i.pvid === v : (i.linkType === 'trunk' || i.linkType === 'hybrid') && [...vlanNums(i.allowedVlans), ...vlanNums(i.untaggedVlans), i.pvid].includes(v)
      if (has) o.push(`${' '.repeat(59)}${i.name}.0${linkUp(ctx, i) ? '*' : ''}`)
    }
  }
  return o
}

function arp(ctx: Ctx): string[] {
  const e = arpEntries(ctx, l2Neighbors).filter((x) => !x.local)
  return [
    row([['MAC Address', 18], ['Address', 16], ['Name', 26], ['Interface', 24], ['Flags', 0]]),
    ...e.map((x) => row([[macOf(x.mac, 0, '2c:6b:f5'), 18], [x.ip, 16], [x.ip, 26], [`${x.iface}.0`, 24], ['none', 0]])),
    `Total entries: ${e.length}`,
  ]
}

function version(ctx: Ctx): string[] {
  return [
    `Hostname: ${ctx.active.hostname}`,
    `Model: ${modelName(ctx).toLowerCase()}`,
    'Junos: 23.4R1.10',
    'JUNOS OS Kernel 64-bit  [20231201.0a6d4b2_builder_stable_13]',
    'JUNOS OS runtime [20231201.0a6d4b2_builder_stable_13]',
    'JUNOS Packet Forwarding Engine Support [23.4R1.10]',
  ]
}

/* ── Pernyataan konfigurasi (set / delete) ───────────────────────────────── */

/** Cara pandang Junos atas satu interface: mode L2, anggota VLAN, native VLAN, dan family inet. */
interface JView {
  mode: 'access' | 'trunk' | null
  members: number[]
  native: number | null
  /** null = tidak ada family inet; '' = family inet tanpa alamat. */
  inet: string | null
}

function toJ(i: IfaceView): JView {
  if (i.linkType === 'access') return { mode: 'access', members: i.pvid ? [i.pvid] : [], native: null, inet: null }
  if (i.linkType === 'trunk' || i.linkType === 'hybrid') {
    return { mode: 'trunk', members: [...vlanNums(i.allowedVlans), ...vlanNums(i.untaggedVlans)], native: i.pvid, inet: null }
  }
  if (i.linkType === 'routed') return { mode: null, members: [], native: null, inet: i.ipAddress }
  return { mode: null, members: [], native: null, inet: null }
}

function fromJ(name: string, j: JView): Partial<IfaceFields> {
  if (j.inet !== null && (j.mode || j.members.length)) {
    throw new CliError(
      `${name}.0: family ethernet-switching and family inet cannot be configured together`,
      'Satu unit hanya boleh L2 (ethernet-switching) atau L3 (inet). Hapus salah satunya dulu.',
    )
  }
  if (j.inet !== null) return { ...CLEAR_L2L3, linkType: 'routed', ipAddress: j.inet }
  if (j.mode === 'trunk') return { ...CLEAR_L2L3, linkType: 'trunk', pvid: j.native ?? 1, allowedVlans: formatVlanList(j.members) }
  if (j.mode === 'access' || j.members.length) {
    if (j.members.length > 1) {
      throw new CliError(`Access interface <${name}.0> has more than one vlan member`, 'Mode access hanya boleh satu VLAN; pakai `interface-mode trunk` untuk banyak VLAN.')
    }
    return { ...CLEAR_L2L3, linkType: 'access', pvid: j.members[0] ?? null }
  }
  return { ...CLEAR_L2L3 }
}

function onJ(name: string, fn: (j: JView, cur: IfaceView) => JView): Change {
  return (d) =>
    patchIface(d, name, (cur) => {
      if (cur.memberOf) {
        throw new CliError(`${name}: interface is a member of an aggregated ethernet bundle`, 'Atur VLAN/IP di interface ae-nya, bukan di port anggota.')
      }
      return fromJ(name, fn(toJ(cur), cur))
    })
}

function unit0(u: string): void {
  if (Number(u) !== 0) throw new CliError('unit not supported in this simulation', 'Simulasi hanya memodelkan unit 0 per interface.')
}

function vlanIds(ctx: Ctx, text: string): number[] {
  const words = text.replace(/[[\]]/g, ' ').trim().split(/\s+/)
  const out: number[] = []
  for (const w of words) {
    const named = ctx.state.vars[`vlan:${w}`]
    if (named) out.push(Number(named))
    else if (/^\d/.test(w)) out.push(...parseVlanWords(w))
    else throw new CliError(`vlan ${w} is not defined`, `Definisikan dulu: set vlans ${w} vlan-id <angka>, atau tulis nomor VLAN-nya langsung.`)
  }
  return out
}

const isLo = (n: string) => n === 'lo0'

/** Nama interface di pernyataan: harus ada di perangkat, kecuali aeN (dibuat otomatis) dan lo0. */
function ifName(ctx: Ctx, typed: string): string {
  if (isLo(typed) || /^ae\d+$/.test(typed)) return typed
  const hit = ifaceList(ctx.device).find((i) => i.name === typed)
  if (!hit) throw new CliError(`interface ${typed} not present`, `Interface ${typed} tidak ada di ${modelName(ctx)} ini.`)
  return hit.name
}

type StmtRun = (a: Args) => { change?: Change; vars?: Record<string, string | undefined> }

function stmt(syntax: string, help: string, run: StmtRun, hidden = false): Spec {
  return { syntax, help, hidden, run: (a) => ({ ...(run(a) as object) }) as ExecResult }
}

function setSpecs(ctx: Ctx): Spec[] {
  const withIf = (a: Args, fn: (n: string) => Change): { change: Change } => {
    const n = ifName(ctx, a.if!)
    return { change: (d, env) => fn(n)(/^ae\d+$/.test(n) ? ensureTrunk(d, n) : d, env) }
  }
  const mode = (m: 'access' | 'trunk'): StmtRun => (a) => {
    unit0(a.u!)
    return withIf(a, (n) => onJ(n, (j) => ({ ...j, mode: m, members: m === 'access' ? j.members.slice(0, 1) : j.members })))
  }
  const join = (a: Args) =>
    withIf(a, (n) => (d, env) => {
      if (!/^ae\d+$/.test(a.ae!)) throw new CliError(`${a.ae} is not an aggregated ethernet interface`)
      return joinTrunk(ensureTrunk(d, a.ae!), env, a.ae!, n)
    })
  return [
    stmt('system host-name <name:word>', 'Hostname for this router', (a) => ({ change: (d) => setHostname(d, a.name!) })),
    stmt('interfaces <if:iface> description <text:text>', 'Text description of interface', (a) =>
      withIf(a, (n) => (d) => (isLo(n) ? d : patchIface(d, n, () => ({ description: a.text! })))),
    ),
    stmt('interfaces <if:iface> disable', 'Disable this interface', (a) => withIf(a, (n) => (d) => patchIface(d, n, () => ({ shutdown: true })))),
    stmt('interfaces <if:iface> unit <u:int:0-16385> family inet address <addr:cidr>', 'Interface address/destination prefix', (a) => {
      unit0(a.u!)
      const c = parseCidr(a.addr!)!
      const cidr = hostAddress(formatIp(c.addr), c.prefix)
      if (isLo(a.if!)) return { change: (d) => setLoopback(d, c.prefix === 32 ? formatIp(c.addr) : cidr) }
      return withIf(a, (n) => (d, env) => {
        checkOverlap(d, n, cidr)
        return onJ(n, (j) => ({ ...j, inet: cidr }))(d, env)
      })
    }),
    stmt('interfaces <if:iface> unit <u:int:0-16385> family inet', 'IPv4 parameters', (a) => {
      unit0(a.u!)
      if (isLo(a.if!)) return {}
      return withIf(a, (n) => onJ(n, (j) => ({ ...j, inet: j.inet ?? '' })))
    }),
    stmt('interfaces <if:iface> unit <u:int:0-16385> family ethernet-switching', 'Ethernet switching parameters', (a) => {
      unit0(a.u!)
      return withIf(a, (n) => onJ(n, (j) => ({ ...j, mode: j.mode ?? 'access', members: j.mode ? j.members : [1] })))
    }),
    stmt('interfaces <if:iface> unit <u:int:0-16385> family ethernet-switching interface-mode access', 'Access mode', mode('access')),
    stmt('interfaces <if:iface> unit <u:int:0-16385> family ethernet-switching interface-mode trunk', 'Trunk mode', mode('trunk')),
    stmt('interfaces <if:iface> unit <u:int:0-16385> family ethernet-switching port-mode access', 'Access mode', mode('access'), true),
    stmt('interfaces <if:iface> unit <u:int:0-16385> family ethernet-switching port-mode trunk', 'Trunk mode', mode('trunk'), true),
    stmt('interfaces <if:iface> unit <u:int:0-16385> family ethernet-switching vlan members <v:list>', 'VLAN tags or names', (a) => {
      unit0(a.u!)
      const ids = vlanIds(ctx, a.v!)
      return withIf(a, (n) => onJ(n, (j) => ({ ...j, mode: j.mode ?? 'access', members: j.mode === 'trunk' ? [...new Set([...j.members, ...ids])] : ids })))
    }),
    stmt('interfaces <if:iface> native-vlan-id <n:int:1-4094>', 'Virtual LAN identifier for untagged frames', (a) =>
      withIf(a, (n) => onJ(n, (j) => ({ ...j, native: Number(a.n) }))),
    ),
    stmt('interfaces <if:iface> ether-options 802.3ad <ae:word>', 'Aggregated Ethernet bundle', join),
    stmt('interfaces <if:iface> gigether-options 802.3ad <ae:word>', 'Aggregated Ethernet bundle', join),
    stmt('interfaces <if:iface> aggregated-ether-options lacp active', 'Transmit packets', (a) => withIf(a, (n) => (d) => setTrunkMode(d, n, 'lacp'))),
    stmt('interfaces <if:iface> aggregated-ether-options lacp passive', 'Do not transmit packets', (a) => withIf(a, (n) => (d) => setTrunkMode(d, n, 'lacp'))),
    stmt('routing-options static route <dest:cidr> next-hop <nh:ip>', 'Next hop to destination', (a) => {
      const c = parseCidr(a.dest!)!
      return { change: (d) => addRoute(d, formatIp(c.addr), c.prefix, a.nh!) }
    }),
    stmt('chassis aggregated-devices ethernet device-count <n:int:1-1024>', 'Number of aggregated Ethernet devices', () => ({})),
    stmt('protocols lldp interface all', 'All interfaces', () => ({})),
    stmt('vlans <name:word> vlan-id <id:int:1-4094>', '802.1q tag', (a) => ({ vars: { [`vlan:${a.name}`]: a.id } })),
  ]
}

function deleteSpecs(ctx: Ctx): Spec[] {
  const withIf = (a: Args, fn: (n: string) => Change) => ({ change: fn(ifName(ctx, a.if!)) })
  const leave: StmtRun = (a) => withIf(a, (n) => (d) => leaveTrunk(d, n))
  return [
    stmt('system host-name', 'Hostname for this router', () => {
      throw new CliError('host-name is required', 'Hostname tidak bisa dikosongkan; ganti dengan `set system host-name`.')
    }),
    stmt('interfaces <if:iface>', 'Interface name', (a) =>
      withIf(a, (n) => (d, env) => {
        if (isLo(n)) return setLoopback(d, '')
        if (d.trunks.some((t) => t.name === n)) return deleteTrunk(d, env, n, { releaseMembers: true })
        return patchIface(leaveTrunk(d, n), n, () => ({ ...CLEAR_L2L3, description: '', shutdown: false }))
      }),
    ),
    stmt('interfaces <if:iface> description', 'Text description of interface', (a) => withIf(a, (n) => (d) => patchIface(d, n, () => ({ description: '' })))),
    stmt('interfaces <if:iface> disable', 'Disable this interface', (a) => withIf(a, (n) => (d) => patchIface(d, n, () => ({ shutdown: false })))),
    stmt('interfaces <if:iface> unit <u:int:0-16385>', 'Logical interface', (a) =>
      withIf(a, (n) => (d) => (isLo(n) ? setLoopback(d, '') : patchIface(d, n, () => ({ ...CLEAR_L2L3 })))),
    ),
    stmt('interfaces <if:iface> unit <u:int:0-16385> family inet', 'IPv4 parameters', (a) =>
      withIf(a, (n) => (d, env) => (isLo(n) ? setLoopback(d, '') : onJ(n, (j) => ({ ...j, inet: null }))(d, env))),
    ),
    stmt('interfaces <if:iface> unit <u:int:0-16385> family inet address <addr:cidr>', 'Interface address', (a) =>
      withIf(a, (n) => (d, env) => (isLo(n) ? setLoopback(d, '') : onJ(n, (j) => ({ ...j, inet: j.inet === null ? null : '' }))(d, env))),
    ),
    stmt('interfaces <if:iface> unit <u:int:0-16385> family ethernet-switching', 'Ethernet switching parameters', (a) =>
      withIf(a, (n) => onJ(n, (j) => ({ ...j, mode: null, members: [], native: null }))),
    ),
    stmt('interfaces <if:iface> unit <u:int:0-16385> family ethernet-switching interface-mode', 'Interface mode', (a) =>
      withIf(a, (n) => onJ(n, (j) => ({ ...j, mode: 'access', members: j.members.slice(0, 1) }))),
    ),
    stmt('interfaces <if:iface> unit <u:int:0-16385> family ethernet-switching vlan members', 'VLAN members', (a) =>
      withIf(a, (n) => onJ(n, (j) => ({ ...j, members: [] }))),
    ),
    stmt('interfaces <if:iface> unit <u:int:0-16385> family ethernet-switching vlan members <v:list>', 'VLAN members', (a) => {
      const ids = new Set(vlanIds(ctx, a.v!))
      return withIf(a, (n) => onJ(n, (j) => ({ ...j, members: j.members.filter((v) => !ids.has(v)) })))
    }),
    stmt('interfaces <if:iface> native-vlan-id', 'Native VLAN', (a) => withIf(a, (n) => onJ(n, (j) => ({ ...j, native: null })))),
    stmt('interfaces <if:iface> ether-options 802.3ad', 'Aggregated Ethernet bundle', leave),
    stmt('interfaces <if:iface> gigether-options 802.3ad', 'Aggregated Ethernet bundle', leave),
    stmt('interfaces <if:iface> aggregated-ether-options lacp', 'LACP', (a) => withIf(a, (n) => (d) => setTrunkMode(d, n, 'static'))),
    stmt('routing-options static route <dest:cidr>', 'Static route', (a) => {
      const c = parseCidr(a.dest!)!
      return { change: (d) => removeRoute(d, formatIp(c.addr), c.prefix) }
    }),
    stmt('routing-options static route <dest:cidr> next-hop <nh:ip>', 'Next hop', (a) => {
      const c = parseCidr(a.dest!)!
      return { change: (d) => removeRoute(d, formatIp(c.addr), c.prefix, a.nh!) }
    }),
    stmt('vlans <name:word>', 'VLAN', (a) => ({ vars: { [`vlan:${a.name}`]: undefined } })),
  ]
}

/* ── Gaya ────────────────────────────────────────────────────────────────── */

const KW: Record<string, string> = {
  show: 'Show system information',
  configure: 'Manipulate software configuration information',
  ping: 'Ping remote target',
  traceroute: 'Trace route to remote host',
  interfaces: 'Interface configuration',
  terse: 'Display terse output',
  route: 'Show routing table information',
  lldp: 'Show Link Layer Discovery Protocol information',
  neighbors: 'Show LLDP neighbors information',
  configuration: 'Show current configuration',
  version: 'Show software process revision levels',
  vlans: 'VLAN configuration',
  set: 'Set a parameter',
  delete: 'Delete a data element',
  edit: 'Edit a particular hierarchy level',
  commit: 'Commit current set of changes',
  rollback: 'Roll back to previous committed configuration',
  run: 'Run an operational-mode command',
  up: 'Exit one level of configuration hierarchy',
  top: 'Exit to top level of configuration',
  exit: 'Exit from this level',
  quit: 'Quit from this level',
  system: 'System parameters',
  'routing-options': 'Protocol-independent routing option configuration',
  static: 'Static routes',
  unit: 'Logical interface',
  family: 'Protocol family',
  inet: 'IPv4 parameters',
  'ethernet-switching': 'Ethernet switching parameters',
  'interface-mode': 'Interface mode',
  vlan: 'Virtual LAN',
  members: 'VLAN tags or names',
  'host-name': 'Hostname for this router',
  chassis: 'Chassis configuration',
  protocols: 'Routing protocol configuration',
  arp: 'Show system Address Resolution Protocol table entries',
  'aggregated-ether-options': 'Aggregated Ethernet interface-specific options',
  'ether-options': 'Ethernet interface-specific options',
  'gigether-options': 'Gigabit Ethernet interface-specific options',
  '802.3ad': 'IEEE 802.3ad',
  lacp: 'Link Aggregation Control Protocol configuration',
  description: 'Text description of interface',
  disable: 'Disable this interface',
  'native-vlan-id': 'Virtual LAN identifier for untagged frames',
  address: 'Interface address/destination prefix',
  'next-hop': 'Next hop to destination',
  descriptions: 'Show interface descriptions',
}

const STYLE: SpecStyle = {
  abbrev: true,
  kwHelp: KW,
  helpHeader: ['Possible completions:'],
  crLabel: '<[Enter]>            Execute this command',
  paramLabel: (p) => `<${p.param}>`,
  syntaxError: (kind, c, word, options) => {
    const caret = { text: `${' '.repeat(c)}^`, kind: 'err' as const }
    if (kind === 'ambiguous') return [caret, { text: `'${word}' is ambiguous.`, kind: 'err' }, out('Possible completions:'), ...options.map((o) => out(`  ${o.padEnd(21)}${KW[o] ?? ''}`))]
    if (kind === 'incomplete') return [caret, { text: 'missing argument.', kind: 'err' }]
    return [caret, { text: 'syntax error.', kind: 'err' }]
  },
}

const done = (o: string[] = []): ExecResult => ({ out: o.map(out) })

/* ── Mode operasional ────────────────────────────────────────────────────── */

function junosPing(ctx: Ctx, a: Args): ExecResult {
  const count = a.count ? Number(a.count) : 5
  const run = simulatePing(ctx, a.dst!, count, a.src)
  const s = stats(run.replies)
  const rows: OutLine[] = run.noRoute
    ? run.replies.map(() => out('ping: sendto: No route to host'))
    : run.replies.map((r, k) => (r === null ? out(`Request timeout for icmp_seq ${k}`) : out(`64 bytes from ${a.dst}: icmp_seq=${k} ttl=${run.ttl} time=${r.toFixed(3)} ms`)))
  return {
    out: [out(`PING ${a.dst} (${a.dst}): 56 data bytes`)],
    stream: {
      lines: [
        ...rows,
        out(''),
        out(`--- ${a.dst} ping statistics ---`),
        out(`${s.sent} packets transmitted, ${s.got} packets received, ${Math.round(s.loss)}% packet loss`),
        ...(s.got ? [out(`round-trip min/avg/max/stddev = ${s.min.toFixed(3)}/${s.avg.toFixed(3)}/${s.max.toFixed(3)}/${((s.max - s.min) / 2).toFixed(3)} ms`)] : []),
        ...(s.got ? [] : pingHint(run)),
      ],
      interval: s.got ? 280 : 650,
    },
  }
}

function junosTrace(ctx: Ctx, dst: string): ExecResult {
  const t = simulateTrace(ctx, dst)
  const rows: OutLine[] = t.hops.map((h, k) => {
    if (h.ip === null) return out(`${String(k + 1).padStart(2)}  * * *`)
    const b = (k + 1) * 0.7
    const ip = formatIp(h.ip)
    return out(`${String(k + 1).padStart(2)}  ${ip} (${ip})  ${b.toFixed(3)} ms  ${(b + 0.2).toFixed(3)} ms  ${ms(b)}.${String(k)}01 ms`)
  })
  if (!t.reached) {
    for (let k = t.hops.length; k < t.hops.length + 3; k += 1) rows.push(out(`${String(k + 1).padStart(2)}  * * *`))
    rows.push(hint(TRACE_STOP))
  }
  return { out: [out(`traceroute to ${dst} (${dst}), 30 hops max, 52 byte packets`)], stream: { lines: rows, interval: 400 } }
}

function opSpecs(ctx: Ctx, displaySet: boolean): Spec[] {
  const cfg = (path: string[]): string[] => {
    const tree = subtree(configTree(ctx, ctx.active), path)
    if (!tree) return []
    return displaySet ? flatten(tree, path).map(setText) : renderTree(tree)
  }
  const ping = (a: Args) => junosPing(ctx, a)
  return [
    { syntax: 'show interfaces terse', help: KW.terse, run: () => done(terse(ctx)) },
    { syntax: 'show interfaces <if:iface> terse', help: KW.terse, run: (a) => done(terse(ctx, a.if)) },
    { syntax: 'show interfaces descriptions', help: KW.descriptions, run: () => done(descriptions(ctx)) },
    {
      syntax: 'show interfaces <if:iface>',
      help: 'Name of physical or logical interface',
      run: (a) => {
        const i = mustIface(ctx.active, a.if!)
        const up = linkUp(ctx, i)
        return done([
          `Physical interface: ${i.name}, ${i.shutdown ? 'Administratively down' : 'Enabled'}, Physical link is ${up ? 'Up' : 'Down'}`,
          ...(i.description ? [`  Description: ${i.description}`] : []),
          `  Link-level type: Ethernet, MTU: 1514, Speed: ${ctx.active.ports.find((p) => p.id === i.id)?.speed ?? 'Unspecified'}`,
          `  Current address: ${macOf(ctx.env.deviceId, ifaceList(ctx.active).findIndex((x) => x.id === i.id), '2c:6b:f5')}`,
          ...(i.linkType === 'routed' && i.ipAddress ? ['', `  Logical interface ${i.name}.0`, '    Protocol inet, MTU: 1500', `      Addresses, Flags: Is-Preferred Is-Primary`, `        Local: ${i.ipAddress.split('/')[0]}`] : []),
        ])
      },
    },
    { syntax: 'show lldp neighbors', help: KW.neighbors, run: () => done(lldp(ctx)) },
    { syntax: 'show route', help: KW.route, run: () => done(showRoute(ctx)) },
    { syntax: 'show lacp interfaces', help: 'Show LACP aggregated interface information', run: () => done(lacp(ctx)) },
    { syntax: 'show vlans', help: 'Show VLAN information', run: () => done(showVlans(ctx)) },
    { syntax: 'show arp', help: KW.arp, run: () => done(arp(ctx)) },
    { syntax: 'show version', help: KW.version, run: () => done(version(ctx)) },
    { syntax: 'show configuration', help: KW.configuration, run: () => done(cfg([])) },
    { syntax: 'show configuration <path:text>', help: 'Hierarchy level', run: (a) => done(cfg(a.path!.split(/\s+/))) },
    { syntax: 'show system uptime', help: 'Show time since system and processes started', run: () => done([`Current time: ${ctx.now.toISOString()}`, `System booted: ${since()} ago`]) },
    { syntax: 'ping <dst:ip>', help: 'Hostname or IP address of remote host', run: ping },
    { syntax: 'ping <dst:ip> count <count:int:1-100>', help: 'Number of ping requests to send', run: ping },
    { syntax: 'ping <dst:ip> source <src:ip>', help: 'Source address of echo request', run: ping },
    { syntax: 'ping <dst:ip> rapid', help: 'Send requests rapidly', run: ping },
    { syntax: 'ping <dst:ip> rapid count <count:int:1-100>', help: 'Number of ping requests to send', run: ping },
    { syntax: 'traceroute <dst:ip>', help: 'IP address of remote host', run: (a) => junosTrace(ctx, a.dst!) },
  ]
}

/* ── Mode konfigurasi ────────────────────────────────────────────────────── */

/** Naik satu tingkat hierarki; `unit 0` dan `route x` dihitung satu tingkat. */
function upOne(path: string[]): string[] {
  const p = [...path]
  const last = p.pop()
  if (last !== undefined && p.length && ['unit', 'route'].includes(p.at(-1)!)) p.pop()
  return p
}

function stmtExec(ctx: Ctx, kind: 'set' | 'delete', tokens: Token[], prompt: number): ExecResult {
  const specs = kind === 'set' ? setSpecs(ctx) : deleteSpecs(ctx)
  const full: Token[] = [...ctx.state.path.map((t) => ({ text: t, start: -1 })), ...tokens.slice(1)]
  if (tokens.length === 1) return { out: [{ text: `${' '.repeat(prompt + tokens[0]!.text.length + 1)}^`, kind: 'err' }, { text: 'missing argument.', kind: 'err' }] }
  const m = match(specs, full, true)
  if (!m.ok) {
    const t = full[m.at]
    const c = t && t.start >= 0 ? prompt + t.start : prompt + (tokens.at(-1)!.start + tokens.at(-1)!.text.length + 1)
    return { out: STYLE.syntaxError(m.error, c, t?.text ?? '', m.options, '') }
  }
  const r = m.spec.run(m.args) as ExecResult & { vars?: Record<string, string | undefined> }
  const vars = r.vars ? Object.fromEntries(Object.entries({ ...ctx.state.vars, ...r.vars }).filter(([, v]) => v !== undefined)) as Record<string, string> : undefined
  return { change: r.change, changeText: `${kind} ${full.map((t) => t.text).join(' ')}`, state: vars ? { vars } : undefined }
}

function confSpecs(ctx: Ctx, displaySet: boolean): Spec[] {
  const show = (path: string[]) => {
    const tree = subtree(configTree(ctx, ctx.device), path)
    if (!tree) return []
    return displaySet ? flatten(tree, path).map(setText) : renderTree(tree)
  }
  const leave = (): ExecResult => {
    if (ctx.state.pending.length === 0) return { state: { mode: 'op', path: [] }, out: [out('Exiting configuration mode')] }
    return {
      out: [out('The configuration has been changed but not committed')],
      state: {
        confirm: {
          prompt: 'Exit with uncommitted changes? [yes,no] (yes) ',
          answer: (input) => (/^n/i.test(input) ? {} : { state: { mode: 'op', path: [] }, out: [out('Exiting configuration mode')] }),
        },
      },
    }
  }
  return [
    { syntax: 'set <stmt:text>', help: KW.set, run: () => ({}) },
    { syntax: 'delete <stmt:text>', help: KW.delete, run: () => ({}) },
    { syntax: 'edit <stmt:text>', help: KW.edit, run: () => ({}) },
    { syntax: 'show', help: 'Show a parameter', run: () => done(show(ctx.state.path)) },
    { syntax: 'show <path:text>', help: 'Show a parameter', run: (a) => done(show([...ctx.state.path, ...a.path!.split(/\s+/)])) },
    { syntax: 'commit', help: KW.commit, run: () => ({ commit: true, out: [out('commit complete')] }) },
    { syntax: 'commit check', help: 'Check correctness of syntax; do not apply changes', run: () => done(['configuration check succeeds']) },
    {
      syntax: 'commit and-quit',
      help: 'Quit configuration mode if commit succeeds',
      run: () => ({ commit: true, state: { mode: 'op', path: [] }, out: [out('commit complete'), out('Exiting configuration mode')] }),
    },
    { syntax: 'rollback', help: KW.rollback, run: () => ({ state: { pending: [] }, out: [out('load complete')] }) },
    { syntax: 'rollback <n:int:0-49>', help: 'Numeric index of rollback file', run: () => ({ state: { pending: [] }, out: [out('load complete')] }) },
    { syntax: 'up', help: KW.up, run: () => ({ state: { path: upOne(ctx.state.path) } }) },
    { syntax: 'top', help: KW.top, run: () => ({ state: { path: [] } }) },
    { syntax: 'exit', help: KW.exit, run: () => (ctx.state.path.length ? { state: { path: [] } } : leave()) },
    { syntax: 'exit configuration-mode', help: 'Exit configuration mode', run: leave },
    { syntax: 'quit', help: KW.quit, run: () => (ctx.state.path.length ? { state: { path: [] } } : leave()) },
    { syntax: 'run <cmd:text>', help: KW.run, run: () => ({}) },
  ]
}

function prompt(ctx: Ctx): string {
  return `${USER}@${ctx.active.hostname}${ctx.state.mode === 'conf' ? '#' : '>'} `
}

function opMode(ctx: Ctx, displaySet = false): Spec[] {
  return [
    ...opSpecs(ctx, displaySet),
    {
      syntax: 'configure',
      help: KW.configure,
      run: () => ({
        state: { mode: 'conf', path: [] },
        out: [out('Entering configuration mode'), ...(ctx.state.pending.length ? [out('The configuration has been changed but not committed')] : [])],
      }),
    },
    { syntax: 'configure private', help: 'Work in private database', run: () => ({ state: { mode: 'conf', path: [] }, out: [out('Entering configuration mode')] }) },
    { syntax: 'exit', help: 'Exit the management session', run: () => ({ logout: true }) },
    { syntax: 'quit', help: 'Exit the management session', run: () => ({ logout: true }) },
  ]
}

/** Pisahkan pipa khusus Junos (`display set`, `compare`) dari filter teks biasa. */
function junosPipes(pipes: string[]): { displaySet: boolean; compare: boolean; rest: string[] } {
  let displaySet = false
  let compare = false
  const rest: string[] = []
  for (const p of pipes) {
    if (/^d\w*\s+s\w*$/i.test(p) && 'display'.startsWith(p.split(/\s+/)[0]!.toLowerCase())) displaySet = true
    else if (/^comp/i.test(p)) compare = true
    else rest.push(p)
  }
  return { displaySet, compare, rest }
}

function exec(ctx: Ctx, line: string): ExecResult {
  const { cmd, pipes } = splitPipe(line)
  const pp = junosPipes(pipes)
  const tokens = tokenize(cmd)
  if (tokens.length === 0) return {}
  const plen = prompt(ctx).length
  let res: ExecResult

  if (ctx.state.mode === 'conf') {
    const first = tokens[0]!.text.toLowerCase()
    const w = walk(confSpecs(ctx, false), tokens.slice(0, 1))
    const head = w.ok ? w.alive.map((c) => c.toks[0]).find((t) => t && 'kw' in t) : undefined
    const verb = head && 'kw' in head ? head.kw : first
    if (verb === 'set' || verb === 'delete') return stmtExec(ctx, verb, tokens, plen)
    if (verb === 'edit') {
      const full: Token[] = [...ctx.state.path.map((t) => ({ text: t, start: -1 })), ...tokens.slice(1)]
      const ok = walk(setSpecs(ctx), full)
      if (!ok.ok || !ok.alive.some((c) => c.ii === full.length && c.si < c.toks.length)) return { out: STYLE.syntaxError('unrecognized', plen + (tokens[1]?.start ?? 0), '', [], '') }
      return { state: { path: full.map((t) => t.text) } }
    }
    if (verb === 'show' && pp.compare) return done(compare(ctx))
    if (verb === 'run') {
      const rest = tokens[1] ? cmd.slice(tokens[1].start) : ''
      res = { ...runPattern(opSpecs(ctx, pp.displaySet), tokenize(rest), plen + (tokens[1]?.start ?? 0)), state: undefined }
    } else {
      res = runPattern(confSpecs(ctx, pp.displaySet), tokens, plen)
    }
  } else {
    res = runPattern(opMode(ctx, pp.displaySet), tokens, plen)
  }
  if (pp.rest.length === 0 || !res.out) return res
  const piped = applyPipes(res.out, pp.rest, { match: 'include', except: 'exclude', count: 'count', 'no-more': 'no-more', find: 'begin' })
  if (!piped.ok) return { out: [{ text: 'syntax error, expecting <command>.', kind: 'err' }] }
  return { ...res, out: piped.lines }
}

function runPattern(specs: Spec[], tokens: Token[], plen: number): ExecResult {
  const m = match(specs, tokens, true)
  if (m.ok) return m.spec.run(m.args)
  const t = tokens[m.at]
  const c = plen + (t ? t.start : tokens.at(-1)!.start + tokens.at(-1)!.text.length + 1)
  return { out: STYLE.syntaxError(m.error, c, t?.text ?? '', m.options, '') }
}

/** Bantuan `?`: set/delete/edit dibantu dengan daftar pernyataan pada hierarki saat ini. */
function help(ctx: Ctx, line: string): OutLine[] {
  if (ctx.state.mode === 'conf') {
    const m = /^\s*(\S+)(\s+.*)?$/.exec(line)
    const verb = m ? ['set', 'delete', 'edit'].find((v) => m[1] && m[2] !== undefined && v.startsWith(m[1].toLowerCase())) : undefined
    if (verb) {
      const specs = verb === 'delete' ? deleteSpecs(ctx) : setSpecs(ctx)
      const rest = (m![2] ?? '').replace(/^\s+/, '')
      const synthetic = `${ctx.state.path.join(' ')}${ctx.state.path.length ? ' ' : ''}${rest}`
      return specHelp(specs, synthetic, STYLE)
    }
    return specHelp(confSpecs(ctx, false), line, STYLE)
  }
  return specHelp(opMode(ctx), line, STYLE)
}

function complete(ctx: Ctx, line: string): { line: string; out?: OutLine[] } {
  const names = [...ifaceList(ctx.device).map((i) => i.name), 'lo0']
  if (ctx.state.mode === 'conf') {
    const m = /^(\s*(\S+)\s+)(.*)$/.exec(line)
    const verb = m ? ['set', 'delete', 'edit'].find((v) => v.startsWith(m[2]!.toLowerCase())) : undefined
    if (m && verb) {
      const prefix = `${ctx.state.path.join(' ')}${ctx.state.path.length ? ' ' : ''}`
      const r = specComplete(verb === 'delete' ? deleteSpecs(ctx) : setSpecs(ctx), `${prefix}${m[3]}`, STYLE, names)
      return { line: `${m[1]}${r.line.slice(prefix.length)}`, out: r.out }
    }
    return specComplete(confSpecs(ctx, false), line, STYLE, names)
  }
  return specComplete(opMode(ctx), line, STYLE, names)
}

export const junos: Dialect = {
  id: 'junos',
  errorPrefix: 'error: ',
  init: () => ({ mode: 'op', path: [], pending: [], vars: {} }),
  banner: (ctx) => [
    out(`Last login: ${ctx.now.toUTCString()} from 10.254.0.20`),
    out('--- JUNOS 23.4R1.10 Kernel 64-bit  JNPR-12.1-20231201.0a6d4b2_buil'),
    hint('Simulasi CLI Junos — `configure`, ubah dengan `set`/`delete`, lalu `commit`. Ketik ? untuk bantuan, Tab untuk melengkapi.'),
    out(''),
  ],
  prompt,
  twoStage: () => true,
  epilogue: (ctx) => (ctx.state.mode === 'conf' ? [out(''), out(`[edit${ctx.state.path.length ? ` ${ctx.state.path.join(' ')}` : ''}]`)] : []),
  exec: (ctx, line) => {
    try {
      return exec(ctx, line)
    } catch (e) {
      if (e instanceof CliError) return { out: errorLines(junos, e) }
      throw e
    }
  },
  help,
  complete,
}
