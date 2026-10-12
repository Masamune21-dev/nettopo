import { formatIp, parseCidr } from '@/lib/ip'
import { l2Neighbors, isL3Device, routesOf } from '../net'
import {
  applyPipes,
  ms,
  pingHint,
  runSpecs,
  simulatePing,
  simulateTrace,
  type Spec,
  specComplete,
  specHelp,
  type SpecStyle,
  splitPipe,
  stats,
  tokenize,
  TRACE_STOP,
} from '../engine'
import {
  addRoute,
  CLEAR_L2L3,
  checkOverlap,
  deleteTrunk,
  deviceVlans,
  ensureTrunk,
  hostAddress,
  ifaceList,
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
  vlanMinus,
  vlanNums,
  vlanRuns,
  vlanUnion,
} from '../ops'
import { arpEntries, modelName, neighbors, netIface, uptime } from '../render'
import { col, hash, macOf, maskToPrefix, prefixToMask, resolveIfaceName, row, splitIfName, stamp } from '../text'
import { type Change, CliError, type Ctx, type Dialect, type ExecResult, hint, lines, type OutLine, out } from '../types'

/**
 * Huawei VRP. Seri S (S5700/S6730) langsung menerapkan perintah; NE dan
 * CloudEngine memakai VRP8 yang dua tahap — perubahan menunggu `commit`,
 * dan prompt berubah dari `[~HOST]` ke `[*HOST]` selama ada yang tertunda.
 */

const ALIASES: Record<string, string> = {
  gigabitethernet: 'ge',
  xgigabitethernet: 'xge',
  'eth-trunk': 'eth-trunk',
}

const LOOPBACK = 'LoopBack0'

/** Nama pendek di data → nama lengkap seperti di konfigurasi Huawei. */
export function vrpFull(name: string): string {
  return name.replace(/^GE(?=\d)/, 'GigabitEthernet').replace(/^XGE(?=\d)/, 'XGigabitEthernet')
}

const isVrp8 = (ctx: Ctx) => /^(NE|CloudEngine|CE)/i.test(ctx.env.model?.series ?? '')

/** "100 200 300 to 310" */
function vrpVlans(vlans: number[]): string {
  return vlanRuns(vlans)
    .map(([a, b]) => (a === b ? `${a}` : b === a + 1 ? `${a} ${b}` : `${a} to ${b}`))
    .join(' ')
}

const vrpMac = (deviceId: string, i = 0) => {
  const m = macOf(deviceId, i).replace(/:/g, '')
  return `${m.slice(0, 4)}-${m.slice(4, 8)}-${m.slice(8, 12)}`
}

/* ── Konfigurasi ─────────────────────────────────────────────────────────── */

function ifaceBlock(ctx: Ctx, i: IfaceView): string[] {
  const l3dev = isL3Device(ctx.device)
  const b: string[] = [`interface ${vrpFull(i.name)}`]
  if (i.description) b.push(` description ${i.description}`)
  if (i.shutdown) b.push(' shutdown')
  if (i.memberOf) {
    const t = ctx.device.trunks.find((x) => x.id === i.memberOf)
    if (t) b.push(` eth-trunk ${t.name.replace(/\D/g, '')}`)
    return b
  }
  const l2 = i.linkType === 'access' || i.linkType === 'trunk' || i.linkType === 'hybrid'
  if (l2 && l3dev && i.kind === 'port') b.push(' portswitch')
  if (i.linkType === 'routed' && !l3dev) b.push(' undo portswitch')
  if (i.linkType === 'access') {
    b.push(' port link-type access')
    if (i.pvid && i.pvid !== 1) b.push(` port default vlan ${i.pvid}`)
  }
  if (i.linkType === 'trunk') {
    b.push(' port link-type trunk')
    if (i.pvid && i.pvid !== 1) b.push(` port trunk pvid vlan ${i.pvid}`)
    const v = vlanNums(i.allowedVlans)
    if (v.length) b.push(` port trunk allow-pass vlan ${vrpVlans(v)}`)
  }
  if (i.linkType === 'hybrid') {
    b.push(' port link-type hybrid')
    if (i.pvid && i.pvid !== 1) b.push(` port hybrid pvid vlan ${i.pvid}`)
    const t = vlanNums(i.allowedVlans)
    const u = vlanNums(i.untaggedVlans)
    if (t.length) b.push(` port hybrid tagged vlan ${vrpVlans(t)}`)
    if (u.length) b.push(` port hybrid untagged vlan ${vrpVlans(u)}`)
  }
  if (i.linkType === 'routed' && i.ipAddress) {
    const c = parseCidr(i.ipAddress)
    if (c) b.push(` ip address ${formatIp(c.addr)} ${prefixToMask(c.prefix)}`)
  }
  if (i.kind === 'trunk' && i.mode === 'lacp') b.push(' mode lacp')
  return b
}

function loopbackBlock(ctx: Ctx): string[] {
  if (!ctx.device.loopback) return []
  const c = parseCidr(ctx.device.loopback.includes('/') ? ctx.device.loopback : `${ctx.device.loopback}/32`)
  return [`interface ${LOOPBACK}`, ...(c ? [` ip address ${formatIp(c.addr)} ${prefixToMask(c.prefix)}`] : [])]
}

function currentConfig(ctx: Ctx): string[] {
  const d = ctx.device
  const ver = isVrp8(ctx) ? 'V800R022C00SPC600' : 'V200R021C10SPC600'
  const cfg: string[] = [`!Software Version ${ver}`, `!Last configuration was updated at ${stamp(ctx.now)}+07:00`, '#', `sysname ${d.hostname}`]
  const vlans = deviceVlans(d).filter((v) => v !== 1)
  if (vlans.length) cfg.push('#', `vlan batch ${vrpVlans(vlans)}`)
  for (const i of ifaceList(d)) cfg.push('#', ...ifaceBlock(ctx, i))
  if (d.loopback) cfg.push('#', ...loopbackBlock(ctx))
  cfg.push('#', 'interface NULL0')
  if (d.staticRoutes.length) {
    cfg.push('#')
    for (const r of d.staticRoutes) {
      const c = parseCidr(r.prefix)
      if (c) cfg.push(`ip route-static ${formatIp(c.addr)} ${prefixToMask(c.prefix)} ${r.nextHop}`)
    }
  }
  cfg.push('#', 'return')
  return cfg
}

/* ── Tampilan status ─────────────────────────────────────────────────────── */

function phyOf(ctx: Ctx, i: IfaceView): string {
  if (i.shutdown) return '*down'
  return netIface(ctx, i.id)?.up ? 'up' : 'down'
}

function interfaceBrief(ctx: Ctx): string[] {
  const o = [
    'PHY: Physical',
    '*down: administratively down',
    '^down: standby',
    '(l): loopback',
    '(s): spoofing',
    '(b): BFD down',
    '(e): ETHOAM down',
    '(d): Dampening Suppressed',
    'InUti/OutUti: input utility/output utility',
    row([['Interface', 28], ['PHY', 6], ['Protocol', 10], ['InUti', 6], ['OutUti', 9], ['inErrors', 11], ['outErrors', 0]]),
  ]
  const list = ifaceList(ctx.device)
  const line = (name: string, phy: string, proto: string) =>
    row([[name, 28], [phy, 6], [proto, 10], ['0%', 6], ['0%', 9], ['0', 11], ['0', 0]])
  for (const i of list) {
    if (i.memberOf) continue
    const phy = phyOf(ctx, i)
    const proto = phy === 'up' && (i.linkType !== 'routed' || i.ipAddress) ? 'up' : 'down'
    o.push(line(vrpFull(i.name), phy, proto))
    if (i.kind === 'trunk') {
      for (const m of list.filter((x) => x.memberOf === i.id)) o.push(line(`  ${vrpFull(m.name)}`, phyOf(ctx, m), phyOf(ctx, m)))
    }
  }
  if (ctx.device.loopback) o.push(line(LOOPBACK, 'up', 'up(s)'))
  o.push(line('NULL0', 'up', 'up(s)'))
  return o
}

function ipInterfaceBrief(ctx: Ctx): string[] {
  const rows: [string, string, string, string][] = []
  for (const i of ifaceList(ctx.device)) {
    if (i.linkType !== 'routed' || i.memberOf) continue
    const phy = phyOf(ctx, i)
    rows.push([vrpFull(i.name), i.ipAddress || 'unassigned', phy, phy === 'up' && i.ipAddress ? 'up' : 'down'])
  }
  if (ctx.device.loopback) {
    const lo = ctx.device.loopback.includes('/') ? ctx.device.loopback : `${ctx.device.loopback}/32`
    rows.push([LOOPBACK, lo, 'up', 'up(s)'])
  }
  rows.push(['NULL0', 'unassigned', 'up', 'up(s)'])
  const up = rows.filter((r) => r[2] === 'up').length
  const proto = rows.filter((r) => r[3].startsWith('up')).length
  return [
    '*down: administratively down',
    '^down: standby',
    '(l): loopback',
    '(s): spoofing',
    '(E): E-Trunk down',
    `The number of interface that is UP in Physical is ${up}`,
    `The number of interface that is DOWN in Physical is ${rows.length - up}`,
    `The number of interface that is UP in Protocol is ${proto}`,
    `The number of interface that is DOWN in Protocol is ${rows.length - proto}`,
    '',
    row([['Interface', 34], ['IP Address/Mask', 21], ['Physical', 11], ['Protocol', 0]]),
    ...rows.map(([a, b, c, d]) => row([[a, 34], [b, 21], [c, 11], [d, 0]])),
  ]
}

function portVlan(ctx: Ctx): string[] {
  const o = [row([['Port', 24], ['Link Type', 13], ['PVID', 6], ['Trunk VLAN List', 0]]), '-'.repeat(79)]
  for (const i of ifaceList(ctx.device)) {
    if (i.memberOf || i.linkType === 'routed' || i.linkType === 'none') continue
    const list =
      i.linkType === 'access' ? '-' : vrpVlans([...vlanNums(i.allowedVlans), ...vlanNums(i.untaggedVlans)]) || '-'
    o.push(row([[vrpFull(i.name), 24], [i.linkType, 13], [String(i.pvid ?? 1), 6], [list, 0]]))
  }
  return o
}

function vlanTable(ctx: Ctx): string[] {
  const list = ifaceList(ctx.device).filter((i) => !i.memberOf)
  const vlans = [...new Set([1, ...deviceVlans(ctx.device)])].sort((a, b) => a - b)
  const o = [
    `The total number of VLANs is : ${vlans.length}`,
    '-'.repeat(80),
    'U: Up;         D: Down;         TG: Tagged;         UT: Untagged;',
    'MP: Vlan-mapping;               ST: Vlan-stacking;',
    '#: ProtocolTransparent-vlan;    *: Management-vlan;',
    '-'.repeat(80),
    '',
    row([['VID', 5], ['Type', 8], ['Ports', 0]]),
    '-'.repeat(80),
  ]
  const tag = (i: IfaceView) => `${i.name}(${phyOf(ctx, i) === 'up' ? 'U' : 'D'})`
  for (const v of vlans) {
    const ut: string[] = []
    const tg: string[] = []
    for (const i of list) {
      const pvid = i.pvid ?? 1
      if (i.linkType === 'access' && pvid === v) ut.push(tag(i))
      if (i.linkType === 'trunk') {
        if (pvid === v) ut.push(tag(i))
        else if (vlanNums(i.allowedVlans).includes(v)) tg.push(tag(i))
      }
      if (i.linkType === 'hybrid') {
        if (pvid === v || vlanNums(i.untaggedVlans).includes(v)) ut.push(tag(i))
        else if (vlanNums(i.allowedVlans).includes(v)) tg.push(tag(i))
      }
    }
    const groups: [string, string[]][] = [['UT:', ut], ['TG:', tg]]
    let first = true
    for (const [label, ports] of groups) {
      if (ports.length === 0) continue
      for (let k = 0; k < ports.length; k += 3) {
        const head = first ? row([[String(v), 5], ['common', 8]]).padEnd(13) : ' '.repeat(13)
        const lab = k === 0 ? label : '   '
        o.push(`${head}${lab}${ports.slice(k, k + 3).map((p) => col(p, 20)).join('')}`.trimEnd())
        first = false
      }
    }
    if (first) o.push(row([[String(v), 5], ['common', 8]]))
  }
  return o
}

function ethTrunk(ctx: Ctx, only?: number): string[] {
  const o: string[] = []
  const list = ifaceList(ctx.device)
  for (const t of list.filter((i) => i.kind === 'trunk')) {
    const id = Number(t.name.replace(/\D/g, ''))
    if (only !== undefined && id !== only) continue
    const members = list.filter((m) => m.memberOf === t.id)
    const up = members.filter((m) => phyOf(ctx, m) === 'up').length
    if (o.length) o.push('')
    o.push(`${t.name}'s state information is:`)
    if (t.mode === 'lacp') {
      o.push(
        'Local:',
        `${col(`LAG ID: ${id}`, 28)}WorkingMode: LACP`,
        `${col('Preempt Delay: Disabled', 28)}Hash arithmetic: According to SIP-XOR-DIP`,
        `${col('System Priority: 32768', 28)}System ID: ${vrpMac(ctx.env.deviceId)}`,
        `${col('Least Active-linknumber: 1', 28)}Max Active-linknumber: 8`,
        `${col(`Operate status: ${phyOf(ctx, t)}`, 28)}Number Of Up Port In Trunk: ${up}`,
        '-'.repeat(80),
        row([['ActorPortName', 23], ['Status', 9], ['PortType', 9], ['PortPri', 8], ['PortNo', 7], ['PortKey', 8], ['PortState', 10], ['Weight', 0]]),
      )
      members.forEach((m, k) => {
        const sel = phyOf(ctx, m) === 'up' ? 'Selected' : 'Unselect'
        o.push(row([[vrpFull(m.name), 23], [sel, 9], [m.name.replace(/[\d/]+$/, ''), 9], ['32768', 8], [String(k + 1), 7], [String(1000 + id), 8], ['10111100', 10], ['1', 0]]))
      })
    } else {
      o.push(
        `${col('WorkingMode: NORMAL', 28)}Hash arithmetic: According to SIP-XOR-DIP`,
        `${col('Least Active-linknumber: 1', 28)}Max Bandwidth-affected-linknumber: 8`,
        `${col(`Operate status: ${phyOf(ctx, t)}`, 28)}Number Of Up Port In Trunk: ${up}`,
        '-'.repeat(80),
        row([['PortName', 30], ['Status', 12], ['Weight', 0]]),
      )
      for (const m of members) o.push(row([[vrpFull(m.name), 30], [phyOf(ctx, m) === 'up' ? 'Up' : 'Down', 12], ['1', 0]]))
    }
  }
  if (only !== undefined && o.length === 0) throw new CliError('The Eth-Trunk does not exist.')
  return o
}

function lldpBrief(ctx: Ctx): string[] {
  return [
    row([['Local Intf', 17], ['Neighbor Dev', 25], ['Neighbor Intf', 26], ['Exptime(s)', 0]]),
    ...neighbors(ctx).map((n) => row([[n.local, 17], [n.host, 25], [n.remote, 26], [String(90 + (hash(n.local) % 30)), 0]])),
  ]
}

function routingTable(ctx: Ctx): string[] {
  const dev = ctx.net().devices.get(ctx.env.deviceId)
  const all = dev ? routesOf(dev) : []
  const o = [
    'Route Flags: R - relay, D - download to fib',
    '-'.repeat(78),
    'Routing Tables: Public',
    `         Destinations : ${all.length + 2}        Routes : ${all.length + 2}`,
    '',
    'Destination/Mask    Proto   Pre  Cost      Flags NextHop         Interface',
    '',
  ]
  const fmt = (dest: string, proto: string, pre: string, flags: string, nh: string, ifn: string) =>
    `${dest.padStart(18)}  ${col(proto, 8)}${col(pre, 5)}${col('0', 10)}${flags.padStart(4)}   ${col(nh, 16)}${ifn}`
  const sorted = [...all].sort((a, b) => a.dest.addr - b.dest.addr || a.dest.prefix - b.dest.prefix)
  const rows = [
    ...sorted.map((r) => ({
      addr: r.dest.addr,
      text: fmt(
        `${formatIp(r.dest.addr)}/${r.dest.prefix}`,
        r.proto === 'static' ? 'Static' : 'Direct',
        r.proto === 'static' ? '60' : '0',
        r.proto === 'static' ? 'RD' : 'D',
        r.proto === 'static' ? formatIp(r.nextHop!) : r.proto === 'local' || r.iface.kind === 'loopback' ? '127.0.0.1' : formatIp(r.iface.addr!.addr),
        r.iface.kind === 'loopback' ? LOOPBACK : vrpFull(r.iface.name),
      ),
    })),
    { addr: 0x7f000000, text: fmt('127.0.0.0/8', 'Direct', '0', 'D', '127.0.0.1', 'InLoopBack0') },
    { addr: 0x7f000001, text: fmt('127.0.0.1/32', 'Direct', '0', 'D', '127.0.0.1', 'InLoopBack0') },
  ].sort((a, b) => a.addr - b.addr)
  o.push(...rows.map((r) => r.text))
  return o
}

function arpTable(ctx: Ctx): string[] {
  const entries = arpEntries(ctx, l2Neighbors)
  const o = [
    'IP ADDRESS      MAC ADDRESS     EXPIRE(M) TYPE        INTERFACE      VPN-INSTANCE',
    '                                          VLAN',
    '-'.repeat(78),
  ]
  for (const e of entries) {
    const mac = vrpMac(e.local ? ctx.env.deviceId : e.mac)
    o.push(row([[e.ip, 16], [mac, 16], [e.local ? '' : '20', 10], [e.local ? 'I -' : 'D-0', 12], [e.iface, 0]]))
  }
  const dyn = entries.filter((e) => !e.local).length
  o.push('-'.repeat(78), `Total:${col(String(entries.length), 10)}Dynamic:${col(String(dyn), 8)}Static:0     Interface:${entries.length - dyn}`)
  return o
}

function version(ctx: Ctx): string[] {
  const u = uptime()
  const vrp8 = isVrp8(ctx)
  const series = ctx.env.model?.series ?? 'VRP'
  return [
    'Huawei Versatile Routing Platform Software',
    `VRP (R) software, Version ${vrp8 ? '8.220' : '5.170'} (${series} ${vrp8 ? 'V800R022C00SPC600' : 'V200R021C10SPC600'})`,
    'Copyright (C) 2000-2024 HUAWEI TECH CO., LTD',
    `HUAWEI ${modelName(ctx)} uptime is ${u.weeks} week, ${u.days} day, ${u.hours} hour, ${u.minutes} minutes`,
  ]
}

function interfaceDetail(ctx: Ctx, name: string): string[] {
  if (name === LOOPBACK) {
    return [`${LOOPBACK} current state : UP`, 'Line protocol current state : UP (spoofing)', `Internet Address is ${ctx.device.loopback}`]
  }
  const i = mustIface(ctx.device, name)
  const phy = phyOf(ctx, i)
  const state = phy === '*down' ? 'Administratively DOWN' : phy.toUpperCase()
  const o = [`${vrpFull(i.name)} current state : ${state}`, `Line protocol current state : ${phy === 'up' ? 'UP' : 'DOWN'}`]
  if (i.description) o.push(`Description: ${i.description}`)
  if (i.linkType === 'routed') {
    o.push('Route Port,The Maximum Transmit Unit is 1500')
    o.push(i.ipAddress ? `Internet Address is ${i.ipAddress}` : 'Internet protocol processing : disabled')
  } else {
    o.push(`Switch Port, PVID : ${String(i.pvid ?? 1).padStart(4)}, TPID : 8100(Hex), The Maximum Frame Length is 9216`)
  }
  o.push(`IP Sending Frames' Format is PKTFMT_ETHNT_2, Hardware address is ${vrpMac(ctx.env.deviceId, ifaceList(ctx.device).findIndex((x) => x.id === i.id))}`)
  if (i.kind === 'port') {
    const p = ctx.device.ports.find((x) => x.id === i.id)
    o.push(`Port Mode: ${p?.media === 'rj45' ? 'COMMON COPPER' : 'COMMON FIBER'}`, `Speed : ${p?.speed ?? '-'},  Loopback: NONE`, 'Duplex: FULL,  Negotiation: DISABLE')
  }
  o.push('Last 300 seconds input rate 0 bits/sec, 0 packets/sec', 'Last 300 seconds output rate 0 bits/sec, 0 packets/sec')
  return o
}

/* ── Dialek ──────────────────────────────────────────────────────────────── */

const KW: Record<string, string> = {
  display: 'Display information',
  'system-view': 'Enter the system view',
  interface: 'Specify the interface configuration view',
  ip: 'Specify IP configurations',
  port: 'Specify port configurations',
  'link-type': 'Set the link type of the port',
  trunk: 'Trunk port',
  hybrid: 'Hybrid port',
  access: 'Access port',
  default: 'Set the default VLAN of the port',
  'allow-pass': 'Allowed VLANs',
  pvid: 'Specify the PVID of the port',
  tagged: 'Tagged VLANs',
  untagged: 'Untagged VLANs',
  vlan: 'VLAN information',
  undo: 'Negate a command or set its default',
  ping: 'Ping function',
  tracert: 'Trace route function',
  'current-configuration': 'Current configuration',
  brief: 'Brief information of status and configuration',
  'routing-table': 'IP routing table',
  'eth-trunk': 'Ethernet-Trunk interface',
  lldp: 'Link Layer Discovery Protocol',
  neighbor: 'Neighbor information',
  'route-static': 'Establish a static route',
  quit: 'Exit from current mode and enter prior mode',
  return: 'Enter the privileged mode',
  save: 'Save file',
  sysname: 'Set the host name',
  description: 'Describe the interface',
  shutdown: 'Shut down this interface',
  portswitch: 'Switch the port to Layer 2 mode',
  mode: 'Set the working mode',
  commit: 'Commit configuration',
  this: 'Display the current view configuration',
  version: 'Display version information',
  arp: 'Display ARP entries',
}

const STYLE: SpecStyle = {
  abbrev: true,
  kwHelp: KW,
  crLabel: '<cr>',
  paramLabel: (p) => {
    switch (p.type) {
      case 'int':
        return `INTEGER<${p.min ?? 0}-${p.max ?? 4294967295}>`
      case 'ip':
        return 'IP_ADDR<X.X.X.X>'
      case 'mask':
        return 'IP_MASK<X.X.X.X>'
      case 'text':
        return 'TEXT'
      case 'list':
        return 'INTEGER<1-4094>'
      case 'iface':
        return '<interface-type><interface-number>'
      default:
        return 'STRING<1-246>'
    }
  },
  syntaxError: (kind, c, _word, options) => {
    if (kind === 'ambiguous') return [{ text: `${' '.repeat(c)}^`, kind: 'err' }, { text: "Error: Ambiguous command found at '^' position.", kind: 'err' }, out(`  ${options.join('  ')}`)]
    if (kind === 'incomplete') return [{ text: `${' '.repeat(c)}^`, kind: 'err' }, { text: "Error:Incomplete command found at '^' position.", kind: 'err' }]
    return [{ text: `${' '.repeat(c)}^`, kind: 'err' }, { text: "Error: Unrecognized command found at '^' position.", kind: 'err' }]
  },
}

type Res = ExecResult

const done = (o: string[] = []): Res => ({ out: o.map(out) })

/** Perubahan atas satu interface, dengan aturan L2/L3 khas Huawei. */
function onIface(name: string, fn: (cur: IfaceView, l3dev: boolean) => Partial<IfaceView>): Change {
  return (d) => patchIface(d, name, (cur) => fn(cur, isL3Device(d)))
}

const L2 = new Set(['access', 'trunk', 'hybrid'])

function needL2(cur: IfaceView, want: string): void {
  if (cur.memberOf) throw new CliError('The command cannot be configured on an Eth-Trunk member interface.')
  if (cur.linkType === 'routed') {
    throw new CliError(
      'This command is not supported on a Layer 3 interface.',
      `${cur.name} sedang L3 (routed). Jalankan \`portswitch\` dulu untuk menjadikannya port L2.`,
    )
  }
  if (cur.linkType !== want) {
    throw new CliError(
      `The link type of the port is not ${want}.`,
      `Jalankan \`port link-type ${want}\` dulu.`,
    )
  }
}

/** Pindah link-type: VLAN direset ke bawaan Huawei (VLAN 1), alamat IP dibuang. */
function linkTypeChange(name: string, type: 'access' | 'trunk' | 'hybrid'): Change {
  return onIface(name, (cur) => {
    if (cur.memberOf) throw new CliError('The command cannot be configured on an Eth-Trunk member interface.')
    if (cur.linkType === 'routed') {
      throw new CliError(
        'This command is not supported on a Layer 3 interface.',
        `${cur.name} sedang L3 (routed). Jalankan \`portswitch\` dulu untuk menjadikannya port L2.`,
      )
    }
    if (cur.linkType === type) return {}
    if (type === 'access') return { ...CLEAR_L2L3, linkType: 'access', pvid: 1 }
    if (type === 'trunk') return { ...CLEAR_L2L3, linkType: 'trunk', pvid: 1, allowedVlans: '1' }
    return { ...CLEAR_L2L3, linkType: 'hybrid', pvid: 1, untaggedVlans: '1' }
  })
}

function setIp(name: string, ip: string, mask: string): Change {
  return (d) => {
    const prefix = maskToPrefix(mask)
    if (prefix === null) throw new CliError('Wrong parameter found.')
    if (name === LOOPBACK) {
      const addr = hostAddress(ip, prefix)
      return setLoopback(d, prefix === 32 ? ip : addr)
    }
    const cidr = hostAddress(ip, prefix)
    checkOverlap(d, name, cidr)
    return patchIface(d, name, (cur) => {
      if (cur.memberOf) throw new CliError('The command cannot be configured on an Eth-Trunk member interface.')
      if (L2.has(cur.linkType) || (cur.linkType === 'none' && !isL3Device(d))) {
        throw new CliError(
          'The interface is a Layer 2 port and cannot be assigned an IP address.',
          `${cur.name} masih port L2. Jalankan \`undo portswitch\` dulu (konfigurasi VLAN-nya ikut terhapus).`,
        )
      }
      return { linkType: 'routed', ipAddress: cidr }
    })
  }
}

function vrpPing(ctx: Ctx, a: Record<string, string>): Res {
  const count = a.count ? Number(a.count) : 5
  const run = simulatePing(ctx, a.dst!, count, a.src)
  const head = `  PING ${a.dst}: 56  data bytes, press CTRL_C to break`
  const replies = run.replies.map((r, k) =>
    r === null ? out('    Request time out') : out(`    Reply from ${a.dst}: bytes=56 Sequence=${k + 1} ttl=${run.ttl} time=${ms(r)} ms`),
  )
  const s = stats(run.replies)
  const tail = [
    '',
    `  --- ${a.dst} ping statistics ---`,
    `    ${s.sent} packet(s) transmitted`,
    `    ${s.got} packet(s) received`,
    `    ${s.loss.toFixed(2)}% packet loss`,
    ...(s.got ? [`    round-trip min/avg/max = ${ms(s.min)}/${ms(s.avg)}/${ms(s.max)} ms`] : []),
    '',
  ].map(out)
  const extra = s.got === 0 ? pingHint(run) : []
  return { out: [out(head)], stream: { lines: [...replies, ...tail, ...extra], interval: s.got ? 260 : 700 } }
}

function vrpTrace(ctx: Ctx, dst: string): Res {
  const t = simulateTrace(ctx, dst)
  const head = ` traceroute to  ${dst}(${dst}), max hops: 30 ,packet length: 40,press CTRL_C to break `
  const rows: OutLine[] = t.hops.map((h, k) => {
    if (h.ip === null) return out(` ${k + 1} * * *`)
    const base = (k + 1) * 0.7
    return out(` ${k + 1} ${formatIp(h.ip)} ${ms(base)} ms  ${ms(base + 0.3)} ms  ${ms(base)} ms `)
  })
  if (!t.reached) {
    for (let k = t.hops.length; k < t.hops.length + 3; k += 1) rows.push(out(` ${k + 1} * * *`))
    rows.push(hint(TRACE_STOP))
  }
  return { out: [out(head)], stream: { lines: rows, interval: 400 } }
}

function displaySpecs(ctx: Ctx): Spec[] {
  const d = () => ctx.device
  const names = ifaceList(d()).map((i) => i.name)
  const ifaceHelp = `Interface: ${summarizeNames(names)}`
  const resolve = (typed: string) => {
    if (/^lo/i.test(typed) && splitIfName(typed).num === '0') return LOOPBACK
    const n = resolveIfaceName(typed, names, ALIASES)
    if (!n) throw new CliError('Wrong parameter found.')
    return n
  }
  return [
    { syntax: 'display current-configuration', help: 'Current configuration', run: () => done(currentConfig(ctx)) },
    {
      syntax: 'display current-configuration interface <if:iface>',
      help: ifaceHelp,
      run: (a) => {
        const n = resolve(a.if!)
        return done(n === LOOPBACK ? ['#', ...loopbackBlock(ctx), '#', 'return'] : ['#', ...ifaceBlock(ctx, mustIface(d(), n)), '#', 'return'])
      },
    },
    { syntax: 'display saved-configuration', help: 'Saved configuration', run: () => done(currentConfig(ctx)) },
    { syntax: 'display interface brief', help: 'Brief information of status and configuration', run: () => done(interfaceBrief(ctx)) },
    { syntax: 'display interface <if:iface>', help: ifaceHelp, run: (a) => done(interfaceDetail(ctx, resolve(a.if!))) },
    { syntax: 'display ip interface brief', help: 'Brief information of status and configuration', run: () => done(ipInterfaceBrief(ctx)) },
    { syntax: 'display ip routing-table', help: 'IP routing table', run: () => done(routingTable(ctx)) },
    { syntax: 'display port vlan', help: 'VLAN information of ports', run: () => done(portVlan(ctx)) },
    { syntax: 'display vlan', help: 'VLAN information', run: () => done(vlanTable(ctx)) },
    { syntax: 'display eth-trunk', help: 'Ethernet-Trunk information', run: () => done(ethTrunk(ctx)) },
    { syntax: 'display eth-trunk <id:int:0-511>', help: 'Ethernet-Trunk ID', run: (a) => done(ethTrunk(ctx, Number(a.id))) },
    { syntax: 'display lldp neighbor brief', help: 'Brief information', run: () => done(lldpBrief(ctx)) },
    { syntax: 'display arp', help: 'ARP entries', run: () => done(arpTable(ctx)) },
    { syntax: 'display version', help: 'Version information', run: () => done(version(ctx)) },
    { syntax: 'display clock', help: 'System clock', run: () => done([`${stamp(ctx.now)}+07:00`, `${ctx.now.toLocaleDateString('en-US', { weekday: 'long' })}`, 'Time Zone(DefaultZoneName) : UTC+07:00']) },
    {
      syntax: 'display this',
      help: 'Current view configuration',
      run: () => {
        const n = ctx.state.iface
        if (ctx.state.mode === 'iface' && n) {
          return done(['#', ...(n === LOOPBACK ? loopbackBlock(ctx) : ifaceBlock(ctx, mustIface(d(), n))), '#', 'return'])
        }
        return done(currentConfig(ctx))
      },
    },
    ...(isVrp8(ctx)
      ? [
          {
            syntax: 'display configuration candidate',
            help: 'Candidate configuration',
            run: () => done(currentConfig(ctx)),
          },
        ]
      : []),
    { syntax: 'ping <dst:ip>', help: 'IP address of the destination', run: (a) => vrpPing(ctx, a) },
    { syntax: 'ping -c <count:int:1-100> <dst:ip>', help: 'Number of echo requests', run: (a) => vrpPing(ctx, a) },
    { syntax: 'ping -a <src:ip> <dst:ip>', help: 'Source IP address', run: (a) => vrpPing(ctx, a) },
    { syntax: 'ping -a <src:ip> -c <count:int:1-100> <dst:ip>', hidden: true, run: (a) => vrpPing(ctx, a) },
    { syntax: 'ping -c <count:int:1-100> -a <src:ip> <dst:ip>', hidden: true, run: (a) => vrpPing(ctx, a) },
    { syntax: 'tracert <dst:ip>', help: 'IP address of the destination', run: (a) => vrpTrace(ctx, a.dst!) },
  ]
}

function summarizeNames(names: string[]): string {
  const stems = [...new Set(names.map((n) => splitIfName(n).stem))]
  return [...stems.map(vrpFull), LOOPBACK].join(', ')
}

function leaveSystem(ctx: Ctx, to: 'user'): Res {
  if (!isVrp8(ctx) || ctx.state.pending.length === 0) return { state: { mode: to, iface: undefined } }
  return {
    out: [],
    state: {
      confirm: {
        prompt: 'Warning: Uncommitted configurations found. Are you sure to commit them before exiting? [Y(yes)/N(no)/C(cancel)]:',
        answer: (input) => {
          const a = input.toLowerCase()
          if (a.startsWith('y')) return { commit: true, state: { mode: to, iface: undefined } }
          if (a.startsWith('n')) return { state: { mode: to, iface: undefined, pending: [] } }
          return {}
        },
      },
    },
  }
}

function enterIface(ctx: Ctx, typed: string): Res {
  const names = ifaceList(ctx.device).map((i) => i.name)
  const { stem, num } = splitIfName(typed)
  const s = stem.toLowerCase()
  if (s.length >= 2 && 'loopback'.startsWith(s)) {
    if (num !== '0') throw new CliError('Wrong parameter found.', 'Simulasi hanya memodelkan satu loopback: LoopBack0.')
    return { state: { mode: 'iface', iface: LOOPBACK } }
  }
  if (/^(vlanif|meth|null|tunnel)/i.test(s)) {
    throw new CliError('Wrong parameter found.', `Interface ${typed} belum dimodelkan di simulasi; yang tersedia adalah port fisik, Eth-Trunk, dan LoopBack0.`)
  }
  const hit = resolveIfaceName(typed, names, ALIASES)
  if (hit) return { state: { mode: 'iface', iface: hit } }
  if (s.length >= 3 && 'eth-trunk'.startsWith(s) && /^\d+$/.test(num)) {
    const name = `Eth-Trunk${Number(num)}`
    return { state: { mode: 'iface', iface: name }, change: (d) => ensureTrunk(d, name), changeText: `interface ${name}` }
  }
  throw new CliError('Wrong parameter found.')
}

function systemSpecs(ctx: Ctx): Spec[] {
  const names = ifaceList(ctx.device).map((i) => i.name)
  return [
    { syntax: 'sysname <name:word>', help: 'Host name', run: (a) => ({ change: (d) => setHostname(d, a.name!) }) },
    { syntax: 'interface <if:iface>', help: `Interface: ${summarizeNames(names)}`, run: (a) => enterIface(ctx, a.if!) },
    {
      syntax: 'undo interface <if:iface>',
      help: 'Interface',
      run: (a) => {
        const { stem } = splitIfName(a.if!)
        if (/^lo/i.test(stem)) return { change: (d) => setLoopback(d, '') }
        const hit = resolveIfaceName(a.if!, names, ALIASES)
        if (!hit || !/^eth-trunk/i.test(hit)) throw new CliError('Wrong parameter found.', 'Hanya Eth-Trunk dan LoopBack0 yang bisa dihapus.')
        return { change: (d, env) => deleteTrunk(d, env, hit, { releaseMembers: false }) }
      },
    },
    { syntax: 'vlan <vlan:int:1-4094>', help: 'VLAN ID', run: (a) => ({ state: { mode: 'vlan', iface: a.vlan } }) },
    { syntax: 'vlan batch <v:list>', help: 'VLAN list', run: (a) => (parseVlanWords(a.v!), done()) },
    {
      syntax: 'undo vlan <vlan:int:1-4094>',
      help: 'VLAN ID',
      run: () => ({ out: [hint('VLAN di simulasi mengikuti konfigurasi port — hapus VLAN-nya dari port yang memakainya.')] }),
    },
    {
      syntax: 'ip route-static <ip:ip> <mask:mask> <nh:ip>',
      help: 'Next-hop address',
      run: (a) => ({ change: (d) => addRoute(d, a.ip!, maskToPrefix(a.mask!)!, a.nh!) }),
    },
    {
      syntax: 'ip route-static <ip:ip> <mask:mask> <if:iface> <nh:ip>',
      help: 'Next-hop address',
      run: (a) => ({ change: (d) => addRoute(d, a.ip!, maskToPrefix(a.mask!)!, a.nh!) }),
    },
    {
      syntax: 'undo ip route-static <ip:ip> <mask:mask>',
      help: 'Destination mask',
      run: (a) => ({ change: (d) => removeRoute(d, a.ip!, maskToPrefix(a.mask!)!) }),
    },
    {
      syntax: 'undo ip route-static <ip:ip> <mask:mask> <nh:ip>',
      help: 'Next-hop address',
      run: (a) => ({ change: (d) => removeRoute(d, a.ip!, maskToPrefix(a.mask!)!, a.nh!) }),
    },
    { syntax: 'lldp enable', help: 'Enable LLDP', run: () => done() },
    { syntax: 'quit', help: KW.quit, run: () => leaveSystem(ctx, 'user') },
    { syntax: 'return', help: KW.return, run: () => leaveSystem(ctx, 'user') },
  ]
}

function ifaceSpecs(ctx: Ctx): Spec[] {
  const name = ctx.state.iface ?? ''
  const isLo = name === LOOPBACK
  const cur = isLo ? null : ifaceList(ctx.device).find((i) => i.name === name) ?? null
  const isTrunk = cur?.kind === 'trunk'
  const common: Spec[] = [
    { syntax: 'interface <if:iface>', help: 'Interface', run: (a) => enterIface(ctx, a.if!) },
    { syntax: 'quit', help: KW.quit, run: () => ({ state: { mode: 'system', iface: undefined } }) },
    { syntax: 'return', help: KW.return, run: () => leaveSystem(ctx, 'user') },
    { syntax: 'ip address <ip:ip> <mask:mask>', help: 'IP mask', run: (a) => ({ change: setIp(name, a.ip!, a.mask!) }) },
    {
      syntax: 'undo ip address',
      help: 'IP address',
      run: () => ({ change: isLo ? (d) => setLoopback(d, '') : onIface(name, () => ({ ipAddress: '' })) }),
    },
    {
      syntax: 'undo ip address <ip:ip> <mask:mask>',
      hidden: true,
      run: () => ({ change: isLo ? (d) => setLoopback(d, '') : onIface(name, () => ({ ipAddress: '' })) }),
    },
  ]
  if (isLo) return common

  const vlanChange = (want: 'trunk' | 'hybrid', field: 'allowedVlans' | 'untaggedVlans', list: string, add: boolean): Change =>
    onIface(name, (c) => {
      needL2(c, want)
      const v = parseVlanWords(list)
      return { [field]: add ? vlanUnion(c[field], v) : vlanMinus(c[field], v) }
    })

  const specs: Spec[] = [
    ...common,
    { syntax: 'description <text:text>', help: 'Description of the interface', run: (a) => ({ change: onIface(name, () => ({ description: a.text! })) }) },
    { syntax: 'undo description', help: KW.description, run: () => ({ change: onIface(name, () => ({ description: '' })) }) },
    { syntax: 'shutdown', help: KW.shutdown, run: () => ({ change: onIface(name, () => ({ shutdown: true })) }) },
    { syntax: 'undo shutdown', help: KW.shutdown, run: () => ({ change: onIface(name, () => ({ shutdown: false })) }) },
    { syntax: 'port link-type access', help: 'Access port', run: () => ({ change: linkTypeChange(name, 'access') }) },
    { syntax: 'port link-type trunk', help: 'Trunk port', run: () => ({ change: linkTypeChange(name, 'trunk') }) },
    { syntax: 'port link-type hybrid', help: 'Hybrid port', run: () => ({ change: linkTypeChange(name, 'hybrid') }) },
    {
      syntax: 'undo port link-type',
      help: 'Link type',
      run: () => ({ change: onIface(name, (c) => (L2.has(c.linkType) ? { ...CLEAR_L2L3 } : {})) }),
    },
    {
      syntax: 'port default vlan <vlan:int:1-4094>',
      help: 'VLAN ID',
      run: (a) => ({
        change: onIface(name, (c) => {
          if (c.linkType === 'none' && !c.memberOf) return { ...CLEAR_L2L3, linkType: 'access', pvid: Number(a.vlan) }
          needL2(c, 'access')
          return { pvid: Number(a.vlan) }
        }),
      }),
    },
    {
      syntax: 'undo port default vlan',
      help: 'Default VLAN',
      run: () => ({ change: onIface(name, (c) => (needL2(c, 'access'), { pvid: 1 })) }),
    },
    { syntax: 'port trunk allow-pass vlan <v:list>', help: 'VLAN ID, e.g. 10 20 30 to 40 / all', run: (a) => ({ change: vlanChange('trunk', 'allowedVlans', a.v!, true) }) },
    { syntax: 'undo port trunk allow-pass vlan <v:list>', help: 'VLAN ID', run: (a) => ({ change: vlanChange('trunk', 'allowedVlans', a.v!, false) }) },
    {
      syntax: 'port trunk pvid vlan <vlan:int:1-4094>',
      help: 'VLAN ID',
      run: (a) => ({ change: onIface(name, (c) => (needL2(c, 'trunk'), { pvid: Number(a.vlan) })) }),
    },
    { syntax: 'undo port trunk pvid vlan', help: 'PVID', run: () => ({ change: onIface(name, (c) => (needL2(c, 'trunk'), { pvid: 1 })) }) },
    {
      syntax: 'port hybrid pvid vlan <vlan:int:1-4094>',
      help: 'VLAN ID',
      run: (a) => ({ change: onIface(name, (c) => (needL2(c, 'hybrid'), { pvid: Number(a.vlan) })) }),
    },
    { syntax: 'undo port hybrid pvid vlan', help: 'PVID', run: () => ({ change: onIface(name, (c) => (needL2(c, 'hybrid'), { pvid: 1 })) }) },
    { syntax: 'port hybrid tagged vlan <v:list>', help: 'VLAN ID', run: (a) => ({ change: vlanChange('hybrid', 'allowedVlans', a.v!, true) }) },
    { syntax: 'undo port hybrid tagged vlan <v:list>', help: 'VLAN ID', run: (a) => ({ change: vlanChange('hybrid', 'allowedVlans', a.v!, false) }) },
    { syntax: 'port hybrid untagged vlan <v:list>', help: 'VLAN ID', run: (a) => ({ change: vlanChange('hybrid', 'untaggedVlans', a.v!, true) }) },
    { syntax: 'undo port hybrid untagged vlan <v:list>', help: 'VLAN ID', run: (a) => ({ change: vlanChange('hybrid', 'untaggedVlans', a.v!, false) }) },
    {
      syntax: 'portswitch',
      help: KW.portswitch,
      run: () => ({ change: onIface(name, (c) => (c.linkType === 'routed' ? { ...CLEAR_L2L3 } : {})) }),
    },
    {
      syntax: 'undo portswitch',
      help: 'Switch the port to Layer 3 mode',
      run: () => ({
        change: onIface(name, (c) => {
          if (c.memberOf) throw new CliError('The command cannot be configured on an Eth-Trunk member interface.')
          return c.linkType === 'routed' ? {} : { ...CLEAR_L2L3, linkType: 'routed' }
        }),
      }),
    },
  ]

  if (isTrunk) {
    specs.push(
      { syntax: 'mode lacp', help: 'LACP mode', run: () => ({ change: (d) => setTrunkMode(d, name, 'lacp') }) },
      { syntax: 'mode lacp-static', help: 'Static LACP mode', run: () => ({ change: (d) => setTrunkMode(d, name, 'lacp') }) },
      { syntax: 'mode manual load-balance', help: 'Manual load balance mode', run: () => ({ change: (d) => setTrunkMode(d, name, 'static') }) },
      { syntax: 'undo mode', help: 'Working mode', run: () => ({ change: (d) => setTrunkMode(d, name, 'static') }) },
    )
  } else {
    specs.push(
      {
        syntax: 'eth-trunk <id:int:0-511>',
        help: 'Eth-Trunk ID',
        run: (a) => ({ change: (d, env) => joinTrunk(d, env, `Eth-Trunk${Number(a.id)}`, name) }),
      },
      { syntax: 'undo eth-trunk', help: 'Eth-Trunk', run: () => ({ change: (d) => leaveTrunk(d, name) }) },
    )
  }
  return specs
}

function userSpecs(): Spec[] {
  return [
    { syntax: 'system-view', help: KW['system-view'], run: () => ({ state: { mode: 'system' }, out: [out('Enter system view, return user view with return command.')] }) },
    {
      syntax: 'save',
      help: KW.save,
      run: () => ({
        out: [out('The current configuration will be written to the device.')],
        state: {
          confirm: {
            prompt: 'Are you sure to continue? (y/n)[n]:',
            answer: (input) =>
              input.toLowerCase().startsWith('y')
                ? {
                    save: true,
                    out: lines(
                      'It will take several minutes to save configuration file, please wait.....\nConfiguration file had been saved successfully\nNote: The configuration file will take effect after being activated',
                    ),
                  }
                : {},
          },
        },
      }),
    },
    { syntax: 'save force', hidden: true, run: () => ({ save: true, out: [out('Info: Save the configuration successfully.')] }) },
    { syntax: 'quit', help: 'Exit from the current terminal', run: () => ({ logout: true, out: [out('  Configuration console exit, please retry to log on')] }) },
    { syntax: 'screen-length 0 temporary', help: 'Screen length', run: () => done(['Info: The configuration takes effect on the current user terminal interface only.']) },
    { syntax: 'return', hidden: true, run: () => done() },
  ]
}

function specsFor(ctx: Ctx): Spec[] {
  const commit: Spec[] = isVrp8(ctx)
    ? [
        { syntax: 'commit', help: KW.commit, run: () => ({ commit: true }) },
        { syntax: 'abort', help: 'Abort the uncommitted configuration and exit', run: () => ({ state: { mode: 'user', iface: undefined, pending: [] } }) },
        { syntax: 'clear configuration candidate', help: 'Discard uncommitted configuration', run: () => ({ state: { pending: [] } }) },
      ]
    : []
  switch (ctx.state.mode) {
    case 'system':
      return [...displaySpecs(ctx), ...systemSpecs(ctx), ...commit]
    case 'iface':
      return [...displaySpecs(ctx), ...ifaceSpecs(ctx), ...commit]
    case 'vlan':
      return [
        ...displaySpecs(ctx),
        { syntax: 'description <text:text>', help: 'VLAN description', run: () => done() },
        { syntax: 'name <text:text>', help: 'VLAN name', run: () => done() },
        { syntax: 'quit', help: KW.quit, run: () => ({ state: { mode: 'system', iface: undefined } }) },
        { syntax: 'return', help: KW.return, run: () => leaveSystem(ctx, 'user') },
        ...commit,
      ]
    default:
      return [...displaySpecs(ctx), ...userSpecs()]
  }
}

function prompt(ctx: Ctx): string {
  // Hostname baru di VRP8 baru tampil di prompt setelah commit.
  const host = ctx.active.hostname
  if (ctx.state.mode === 'user') return `<${host}>`
  const mark = isVrp8(ctx) ? (ctx.state.pending.length ? '*' : '~') : ''
  if (ctx.state.mode === 'iface') return `[${mark}${host}-${vrpFull(ctx.state.iface ?? '')}]`
  if (ctx.state.mode === 'vlan') return `[${mark}${host}-vlan${ctx.state.iface}]`
  return `[${mark}${host}]`
}

export const vrp: Dialect = {
  id: 'vrp',
  errorPrefix: 'Error: ',
  ctrlZ: 'return',
  init: () => ({ mode: 'user', path: [], pending: [], vars: {} }),
  banner: (ctx) => {
    const olt = ctx.env.model?.role === 'olt'
    return [
      out(''),
      out('Info: The max number of VTY users is 10, and the number'),
      out('      of current VTY users on line is 1.'),
      out(`      The current login time is ${stamp(ctx.now)}+07:00.`),
      hint(
        `Simulasi CLI Huawei ${isVrp8(ctx) ? 'VRP8 (perubahan berlaku setelah `commit`)' : 'VRP'} — ketik ? untuk bantuan, Tab untuk melengkapi. Perubahan langsung tampil di kanvas dan bisa di-undo.`,
      ),
      ...(olt ? [hint('OLT MA5800 aslinya memakai CLI SmartAX; di sini dipakai sintaks VRP untuk port uplink dan VLAN.')] : []),
    ]
  },
  prompt,
  twoStage: (ctx) => isVrp8(ctx),
  exec: (ctx, line) => {
    const { cmd, pipes } = splitPipe(line)
    const res = runSpecs(specsFor(ctx), tokenize(cmd), STYLE, prompt(ctx).length)
    if (pipes.length === 0 || !res.out) return res
    const piped = applyPipes(res.out, pipes, { include: 'include', exclude: 'exclude', begin: 'begin', count: 'count', 'no-more': 'no-more' })
    if (!piped.ok) return { out: [{ text: "Error: Unrecognized command found at '^' position.", kind: 'err' }] }
    return { ...res, out: piped.lines }
  },
  help: (ctx, line) => specHelp(specsFor(ctx), line, STYLE),
  complete: (ctx, line) => specComplete(specsFor(ctx), line, STYLE, [...ifaceList(ctx.device).map((i) => vrpFull(i.name)), LOOPBACK]),
}
