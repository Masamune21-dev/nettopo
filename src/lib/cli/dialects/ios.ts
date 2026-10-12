import { VENDOR_META } from '@/data/deviceCatalog'
import { formatIp, parseCidr } from '@/lib/ip'
import { formatVlanList } from '@/lib/vlans'
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
  vlanUnion,
} from '../ops'
import { arpEntries, modelName, neighbors, netIface, uptime } from '../render'
import { col, macOf, maskToPrefix, prefixToMask, resolveIfaceName, row, splitIfName } from '../text'
import { type Change, CliError, type Ctx, type Dialect, type ExecResult, hint, type OutLine, out } from '../types'

/**
 * Cisco IOS / IOS XE — gaya CLI yang paling dikenal dari Packet Tracer.
 * Dipakai juga untuk vendor lain yang CLI-nya mirip Cisco (ZTE, TP-Link,
 * BDCOM, OLT generik), dengan catatan bahwa sintaks aslinya bisa berbeda.
 */

const LOOPBACK = 'Loopback0'

const SHORT: [RegExp, string, string][] = [
  [/^GigabitEthernet/i, 'Gi', 'Gig '],
  [/^TenGigabitEthernet/i, 'Te', 'Ten '],
  [/^TwentyFiveGigE/i, 'Twe', 'Twe '],
  [/^FortyGigabitEthernet/i, 'Fo', 'For '],
  [/^HundredGigE/i, 'Hu', 'Hun '],
  [/^FastEthernet/i, 'Fa', 'Fas '],
  [/^Port-channel/i, 'Po', 'Po '],
  [/^Loopback/i, 'Lo', 'Lo '],
]

/** GigabitEthernet1/0/1 → Gi1/0/1 */
export const iosShort = (name: string): string => {
  for (const [re, s] of SHORT) if (re.test(name)) return name.replace(re, s)
  return name
}

/** Gaya CDP: "Gig 1/0/1" */
const cdpName = (name: string): string => {
  for (const [re, , s] of SHORT) if (re.test(name)) return name.replace(re, s)
  return name
}

const isCisco = (ctx: Ctx) => ctx.env.model?.vendor === 'cisco'

const trunkName = (n: number) => `Port-channel${n}`

/* ── Konfigurasi ─────────────────────────────────────────────────────────── */

function ifaceBlock(ctx: Ctx, i: IfaceView): string[] {
  const l3dev = isL3Device(ctx.device)
  const b = [`interface ${i.name}`]
  if (i.description) b.push(` description ${i.description}`)
  if (i.linkType === 'access') {
    if (i.pvid && i.pvid !== 1) b.push(` switchport access vlan ${i.pvid}`)
    b.push(' switchport mode access')
  }
  if (i.linkType === 'trunk' || i.linkType === 'hybrid') {
    if (i.pvid && i.pvid !== 1) b.push(` switchport trunk native vlan ${i.pvid}`)
    const v = formatVlanList([...vlanNums(i.allowedVlans), ...vlanNums(i.untaggedVlans)])
    if (v && v !== '1-4094') b.push(` switchport trunk allowed vlan ${v}`)
    b.push(' switchport mode trunk')
  }
  if (i.linkType === 'routed') {
    if (!l3dev) b.push(' no switchport')
    const c = parseCidr(i.ipAddress)
    b.push(c ? ` ip address ${formatIp(c.addr)} ${prefixToMask(c.prefix)}` : ' no ip address')
  } else if (i.linkType === 'none' && l3dev && !i.memberOf) {
    b.push(' no ip address')
  }
  if (i.shutdown) b.push(' shutdown')
  if (i.memberOf) {
    const t = ctx.device.trunks.find((x) => x.id === i.memberOf)
    if (t) b.push(` channel-group ${t.name.replace(/\D/g, '')} mode ${t.mode === 'lacp' ? 'active' : 'on'}`)
  }
  return b
}

function loopbackBlock(ctx: Ctx): string[] {
  const c = parseCidr(ctx.device.loopback.includes('/') ? ctx.device.loopback : `${ctx.device.loopback}/32`)
  return [`interface ${LOOPBACK}`, c ? ` ip address ${formatIp(c.addr)} ${prefixToMask(c.prefix)}` : ' no ip address']
}

function runningConfig(ctx: Ctx): string[] {
  const d = ctx.device
  const body: string[] = ['!', 'version 17.9', 'service timestamps log datetime msec', '!', `hostname ${d.hostname}`, '!']
  for (const v of deviceVlans(d).filter((x) => x !== 1)) body.push(`vlan ${v}`, '!')
  if (d.loopback) body.push(...loopbackBlock(ctx), '!')
  for (const i of ifaceList(d)) body.push(...ifaceBlock(ctx, i), '!')
  for (const r of d.staticRoutes) {
    const c = parseCidr(r.prefix)
    if (c) body.push(`ip route ${formatIp(c.addr)} ${prefixToMask(c.prefix)} ${r.nextHop}`)
  }
  if (d.staticRoutes.length) body.push('!')
  body.push('end')
  const bytes = body.join('\n').length
  return ['Building configuration...', '', `Current configuration : ${bytes} bytes`, ...body]
}

/* ── Status ──────────────────────────────────────────────────────────────── */

function status(ctx: Ctx, i: IfaceView): { status: string; proto: string } {
  if (i.shutdown) return { status: 'administratively down', proto: 'down' }
  const up = Boolean(netIface(ctx, i.id)?.up)
  return { status: up ? 'up' : 'down', proto: up ? 'up' : 'down' }
}

function ipIntBrief(ctx: Ctx): string[] {
  const o = [row([['Interface', 23], ['IP-Address', 16], ['OK?', 4], ['Method', 7], ['Status', 22], ['Protocol', 0]])]
  for (const i of ifaceList(ctx.device)) {
    const s = status(ctx, i)
    const ip = i.linkType === 'routed' && i.ipAddress ? (parseCidr(i.ipAddress) ? formatIp(parseCidr(i.ipAddress)!.addr) : 'unassigned') : 'unassigned'
    o.push(row([[i.name, 23], [ip, 16], ['YES', 4], [ip === 'unassigned' ? 'unset' : 'manual', 7], [s.status, 22], [s.proto, 0]]))
  }
  if (ctx.device.loopback) {
    o.push(row([[LOOPBACK, 23], [ctx.device.loopback.split('/')[0]!, 16], ['YES', 4], ['manual', 7], ['up', 22], ['up', 0]]))
  }
  return o
}

function intStatus(ctx: Ctx): string[] {
  const o = [row([['Port', 13], ['Name', 19], ['Status', 13], ['Vlan', 11], ['Duplex', 8], ['Speed', 7], ['Type', 0]])]
  for (const i of ifaceList(ctx.device)) {
    const s = status(ctx, i)
    const st = i.shutdown ? 'disabled' : s.status === 'up' ? 'connected' : 'notconnect'
    const vlan =
      i.memberOf ? 'trunk' : i.linkType === 'access' ? String(i.pvid ?? 1) : i.linkType === 'trunk' || i.linkType === 'hybrid' ? 'trunk' : i.linkType === 'routed' ? 'routed' : '1'
    const p = ctx.device.ports.find((x) => x.id === i.id)
    const speed = st === 'connected' ? `a-${p?.speed ?? 'auto'}` : 'auto'
    const type = p ? (p.media === 'rj45' ? '10/100/1000BaseTX' : `${p.speed}Base-SR`) : ''
    o.push(row([[iosShort(i.name), 13], [i.description.slice(0, 18), 19], [st, 13], [vlan, 11], [st === 'connected' ? 'a-full' : 'auto', 8], [speed, 7], [type, 0]]))
  }
  return o
}

function vlanBrief(ctx: Ctx): string[] {
  const o = [
    row([['VLAN', 5], ['Name', 33], ['Status', 10], ['Ports', 0]]),
    '---- -------------------------------- --------- -------------------------------',
  ]
  const ports = ifaceList(ctx.device).filter((i) => !i.memberOf)
  const vlans = [...new Set([1, ...deviceVlans(ctx.device)])].sort((a, b) => a - b)
  for (const v of vlans) {
    const members = ports
      .filter((i) => (i.linkType === 'access' && (i.pvid ?? 1) === v) || (i.linkType === 'none' && v === 1 && !isL3Device(ctx.device)))
      .map((i) => iosShort(i.name))
    const name = v === 1 ? 'default' : `VLAN${String(v).padStart(4, '0')}`
    const chunks: string[] = []
    for (let k = 0; k < members.length; k += 4) chunks.push(members.slice(k, k + 4).join(', '))
    o.push(row([[String(v), 5], [name, 33], ['active', 10], [chunks[0] ?? '', 0]]))
    for (const c of chunks.slice(1)) o.push(`${' '.repeat(48)}${c}`)
  }
  return o
}

function intTrunk(ctx: Ctx): string[] {
  const trunks = ifaceList(ctx.device).filter((i) => !i.memberOf && (i.linkType === 'trunk' || i.linkType === 'hybrid'))
  if (!trunks.length) return []
  const allowed = (i: IfaceView) => formatVlanList([...vlanNums(i.allowedVlans), ...vlanNums(i.untaggedVlans), i.pvid ?? 1])
  return [
    '',
    row([['Port', 12], ['Mode', 17], ['Encapsulation', 15], ['Status', 14], ['Native vlan', 0]]),
    ...trunks.map((i) => row([[iosShort(i.name), 12], ['on', 17], ['802.1q', 15], [status(ctx, i).status === 'up' ? 'trunking' : 'not-trunking', 14], [String(i.pvid ?? 1), 0]])),
    '',
    row([['Port', 12], ['Vlans allowed on trunk', 0]]),
    ...trunks.map((i) => row([[iosShort(i.name), 12], [allowed(i), 0]])),
    '',
    row([['Port', 12], ['Vlans allowed and active in management domain', 0]]),
    ...trunks.map((i) => row([[iosShort(i.name), 12], [allowed(i), 0]])),
  ]
}

function etherchannel(ctx: Ctx): string[] {
  const list = ifaceList(ctx.device)
  const trunks = list.filter((i) => i.kind === 'trunk')
  const o = [
    'Flags:  D - down        P - bundled in port-channel',
    '        I - stand-alone s - suspended',
    '        H - Hot-standby (LACP only)',
    '        R - Layer3      S - Layer2',
    '        U - in use      f - failed to allocate aggregator',
    '',
    `Number of channel-groups in use: ${trunks.length}`,
    `Number of aggregators:           ${trunks.length}`,
    '',
    'Group  Port-channel  Protocol    Ports',
    '------+-------------+-----------+-----------------------------------------------',
  ]
  for (const t of trunks) {
    const up = status(ctx, t).status === 'up'
    const flags = `${t.linkType === 'routed' ? 'R' : 'S'}${up ? 'U' : 'D'}`
    const members = list.filter((m) => m.memberOf === t.id).map((m) => `${iosShort(m.name)}(${status(ctx, m).status === 'up' ? 'P' : 'D'})`)
    o.push(`${col(t.name.replace(/\D/g, ''), 7)}${col(`${iosShort(t.name)}(${flags})`, 16)}${col(t.mode === 'lacp' ? 'LACP' : '-', 10)}${members.join('  ')}`)
  }
  return o
}

function cdp(ctx: Ctx): string[] {
  const n = neighbors(ctx)
  return [
    'Capability Codes: R - Router, T - Trans Bridge, B - Source Route Bridge',
    '                  S - Switch, H - Host, I - IGMP, r - Repeater, P - Phone,',
    '                  D - Remote, C - CVTA, M - Two-port Mac Relay',
    '',
    row([['Device ID', 17], ['Local Intrfce', 18], ['Holdtme', 11], ['Capability', 12], ['Platform', 10], ['Port ID', 0]]),
    ...n.map((x) => {
      const cap = isL3Device(x.peerDevice) ? 'R' : 'R S'
      return row([[x.host, 17], [cdpName(x.local), 18], ['163', 11], [cap.padStart(6), 12], [x.model.slice(0, 9), 10], [cdpName(x.remote), 0]])
    }),
    '',
    `Total cdp entries displayed : ${n.length}`,
  ]
}

function lldp(ctx: Ctx): string[] {
  const n = neighbors(ctx)
  return [
    'Capability codes:',
    '    (R) Router, (B) Bridge, (T) Telephone, (C) DOCSIS Cable Device',
    '    (W) WLAN Access Point, (P) Repeater, (S) Station, (O) Other',
    '',
    row([['Device ID', 21], ['Local Intf', 15], ['Hold-time', 11], ['Capability', 15], ['Port ID', 0]]),
    ...n.map((x) => row([[x.host.slice(0, 20), 21], [iosShort(x.local), 15], ['120', 11], [isL3Device(x.peerDevice) ? 'R' : 'B,R', 15], [x.remote, 0]])),
    '',
    `Total entries displayed: ${n.length}`,
  ]
}

function ipRoute(ctx: Ctx): string[] {
  const dev = ctx.net().devices.get(ctx.env.deviceId)
  const routes = dev ? routesOf(dev) : []
  const def = routes.find((r) => r.proto === 'static' && r.dest.prefix === 0)
  const o = [
    'Codes: L - local, C - connected, S - static, R - RIP, M - mobile, B - BGP',
    '       D - EIGRP, EX - EIGRP external, O - OSPF, IA - OSPF inter area',
    '       N1 - OSPF NSSA external type 1, N2 - OSPF NSSA external type 2',
    '       E1 - OSPF external type 1, E2 - OSPF external type 2',
    '       i - IS-IS, su - IS-IS summary, L1 - IS-IS level-1, L2 - IS-IS level-2',
    '       ia - IS-IS inter area, * - candidate default, U - per-user static route',
    '       o - ODR, P - periodic downloaded static route, H - NHRP, l - LISP',
    '       + - replicated route, % - next hop override',
    '',
    def ? `Gateway of last resort is ${formatIp(def.nextHop!)} to network 0.0.0.0` : 'Gateway of last resort is not set',
    '',
  ]
  const ifn = (r: (typeof routes)[number]) => (r.iface.kind === 'loopback' ? LOOPBACK : r.iface.name)
  for (const r of [...routes].sort((a, b) => a.dest.addr - b.dest.addr || a.dest.prefix - b.dest.prefix)) {
    const dest = `${formatIp(r.dest.addr)}/${r.dest.prefix}`
    if (r.proto === 'static') o.push(`${col(r.dest.prefix === 0 ? 'S*' : 'S', 9)}${dest} [1/0] via ${formatIp(r.nextHop!)}`)
    else o.push(`${col(r.proto === 'local' ? 'L' : 'C', 9)}${dest} is directly connected, ${ifn(r)}`)
  }
  return o
}

function arp(ctx: Ctx): string[] {
  const mac = (id: string) => {
    const m = macOf(id, 0, '00:1e:7a').replace(/:/g, '')
    return `${m.slice(0, 4)}.${m.slice(4, 8)}.${m.slice(8, 12)}`
  }
  return [
    row([['Protocol', 10], ['Address', 17], ['Age (min)', 11], ['Hardware Addr', 16], ['Type', 7], ['Interface', 0]]),
    ...arpEntries(ctx, l2Neighbors).map((e) =>
      row([['Internet', 10], [e.ip, 17], [e.local ? '-' : '0', 11], [mac(e.local ? ctx.env.deviceId : e.mac), 16], ['ARPA', 7], [e.iface, 0]]),
    ),
  ]
}

function version(ctx: Ctx): string[] {
  const u = uptime()
  const up = `${ctx.device.hostname} uptime is ${u.weeks} weeks, ${u.days} days, ${u.hours} hours, ${u.minutes} minutes`
  if (!isCisco(ctx)) {
    const v = ctx.env.model ? VENDOR_META[ctx.env.model.vendor].label : ''
    return [`${v} ${modelName(ctx)} — simulasi CLI gaya Cisco IOS`, up]
  }
  return [
    'Cisco IOS XE Software, Version 17.09.04a',
    'Cisco IOS Software [Cupertino], Version 17.9.4a, RELEASE SOFTWARE (fc3)',
    'Technical Support: http://www.cisco.com/techsupport',
    '',
    up,
    'System image file is "bootflash:packages.conf"',
    '',
    `cisco ${modelName(ctx)} processor with 8388608K bytes of memory.`,
    `${ifaceList(ctx.device).filter((i) => i.kind === 'port').length} Ethernet interfaces`,
  ]
}

function intDetail(ctx: Ctx, name: string): string[] {
  if (name === LOOPBACK) return [`${LOOPBACK} is up, line protocol is up`, `  Internet address is ${ctx.device.loopback}`]
  const i = mustIface(ctx.device, name)
  const s = status(ctx, i)
  const p = ctx.device.ports.find((x) => x.id === i.id)
  return [
    `${i.name} is ${s.status}, line protocol is ${s.proto}${s.proto === 'up' ? ' (connected)' : ' (notconnect)'}`,
    `  Hardware is ${p ? `${p.speed} Ethernet` : 'EtherChannel'}, address is ${macOf(ctx.env.deviceId, ifaceList(ctx.device).findIndex((x) => x.id === i.id), '00:1e:7a')}`,
    ...(i.description ? [`  Description: ${i.description}`] : []),
    ...(i.linkType === 'routed' && i.ipAddress ? [`  Internet address is ${i.ipAddress}`] : []),
    '  MTU 1500 bytes, BW 1000000 Kbit/sec, DLY 10 usec,',
    '  Encapsulation ARPA, loopback not set',
    `  Full-duplex, ${p?.speed ?? 'auto'}b/s, media type is ${p?.media === 'rj45' ? '10/100/1000BaseTX' : 'SFP'}`,
    '  5 minute input rate 0 bits/sec, 0 packets/sec',
    '  5 minute output rate 0 bits/sec, 0 packets/sec',
  ]
}

/* ── Gaya dan pesan ──────────────────────────────────────────────────────── */

const KW: Record<string, string> = {
  show: 'Show running system information',
  enable: 'Turn on privileged commands',
  disable: 'Turn off privileged commands',
  configure: 'Enter configuration mode',
  terminal: 'Configure from the terminal',
  interface: 'Select an interface to configure',
  interfaces: 'Interface status and configuration',
  ip: 'Global IP configuration subcommands',
  switchport: 'Set switching mode characteristics',
  mode: 'Set trunking mode of the interface',
  access: 'Set access mode characteristics of the interface',
  trunk: 'Set trunking characteristics of the interface',
  allowed: 'Set allowed VLAN characteristics when interface is in trunking mode',
  native: 'Set trunking native characteristics when interface is in trunking mode',
  vlan: 'VLAN commands',
  'channel-group': 'Etherchannel/port bundling configuration',
  no: 'Negate a command or set its defaults',
  ping: 'Send echo messages',
  traceroute: 'Trace route to destination',
  'running-config': 'Current operating configuration',
  brief: 'Brief summary',
  route: 'IP routing table',
  cdp: 'CDP information',
  lldp: 'LLDP information',
  neighbors: 'Neighbor entries',
  etherchannel: 'EtherChannel information',
  summary: 'One-line summary per channel-group',
  exit: 'Exit from the EXEC',
  end: 'Exit from configure mode',
  hostname: 'Set system\'s network name',
  description: 'Interface specific description',
  shutdown: 'Shutdown the selected interface',
  address: 'Set the IP address of an interface',
  write: 'Write running configuration to memory, network, or terminal',
  copy: 'Copy from one file to another',
  do: 'To run exec commands in config mode',
  version: 'System hardware and software status',
  status: 'Show interface line status',
  arp: 'ARP table',
}

const STYLE: SpecStyle = {
  abbrev: true,
  kwHelp: KW,
  crLabel: '<cr>',
  paramLabel: (p) => {
    switch (p.type) {
      case 'int':
        return `<${p.min ?? 0}-${p.max ?? 4294967295}>`
      case 'ip':
        return 'A.B.C.D'
      case 'mask':
        return 'A.B.C.D'
      case 'text':
        return 'LINE'
      case 'list':
        return 'WORD'
      case 'iface':
        return '<interface>'
      default:
        return 'WORD'
    }
  },
  syntaxError: (kind, c, _word, _options, line) => {
    if (kind === 'ambiguous') return [{ text: `% Ambiguous command:  "${line}"`, kind: 'err' }]
    if (kind === 'incomplete') return [{ text: '% Incomplete command.', kind: 'err' }, out('')]
    return [{ text: `${' '.repeat(c)}^`, kind: 'err' }, { text: "% Invalid input detected at '^' marker.", kind: 'err' }, out('')]
  },
}

type Res = ExecResult
const done = (o: string[] = []): Res => ({ out: o.map(out) })

function onIface(name: string, fn: (cur: IfaceView, l3dev: boolean) => Partial<IfaceView>): Change {
  return (d) => patchIface(d, name, (cur) => fn(cur, isL3Device(d)))
}

const L2 = new Set(['access', 'trunk', 'hybrid'])

function notMember(cur: IfaceView): void {
  if (cur.memberOf) {
    throw new CliError(
      'Command rejected: the interface is part of an EtherChannel.',
      'Port ini anggota Port-channel — atur VLAN/IP di interface Port-channel-nya.',
    )
  }
}

function notRouted(cur: IfaceView): void {
  notMember(cur)
  if (cur.linkType === 'routed') {
    throw new CliError(`Command rejected: ${cur.name} is not a switching port.`, 'Port ini L3 (`no switchport`). Jalankan `switchport` dulu.')
  }
}

function iosPing(ctx: Ctx, a: Record<string, string>): Res {
  const count = a.count ? Number(a.count) : 5
  const run = simulatePing(ctx, a.dst!, count, a.src)
  const s = stats(run.replies)
  const marks: OutLine[] = run.replies.map((r, k) => ({ text: r === null ? '.' : '!', append: k > 0 }))
  return {
    out: [out('Type escape sequence to abort.'), out(`Sending ${count}, 100-byte ICMP Echos to ${a.dst}, timeout is 2 seconds:`)],
    stream: {
      lines: [
        ...marks,
        out(
          `Success rate is ${Math.round(100 - s.loss)} percent (${s.got}/${s.sent})${s.got ? `, round-trip min/avg/max = ${ms(s.min)}/${ms(s.avg)}/${ms(s.max)} ms` : ''}`,
        ),
        ...(s.got ? [] : pingHint(run)),
      ],
      interval: s.got ? 160 : 600,
    },
  }
}

function iosTrace(ctx: Ctx, dst: string): Res {
  const t = simulateTrace(ctx, dst)
  const rows: OutLine[] = t.hops.map((h, k) => {
    if (h.ip === null) return out(`${String(k + 1).padStart(3)} * * * `)
    const b = (k + 1) * 0.7
    return out(`${String(k + 1).padStart(3)} ${formatIp(h.ip)} ${ms(b)} msec ${ms(b + 0.2)} msec ${ms(b)} msec`)
  })
  if (!t.reached) {
    for (let k = t.hops.length; k < t.hops.length + 3; k += 1) rows.push(out(`${String(k + 1).padStart(3)} * * * `))
    rows.push(hint(TRACE_STOP))
  }
  return {
    out: [out('Type escape sequence to abort.'), out(`Tracing the route to ${dst}`), out('VRF info: (vrf in name/id, vrf out name/id)')],
    stream: { lines: rows, interval: 400 },
  }
}

function resolver(ctx: Ctx) {
  const names = ifaceList(ctx.device).map((i) => i.name)
  return (typed: string): string => {
    if (/^lo/i.test(typed) && splitIfName(typed).num === '0') return LOOPBACK
    const n = resolveIfaceName(typed, names)
    if (!n) throw new CliError('Invalid interface.', `Interface ${typed} tidak ada di perangkat ini.`)
    return n
  }
}

function showSpecs(ctx: Ctx, privileged: boolean): Spec[] {
  const resolve = resolver(ctx)
  const specs: Spec[] = [
    { syntax: 'show ip interface brief', help: 'Brief summary of IP status and configuration', run: () => done(ipIntBrief(ctx)) },
    { syntax: 'show interfaces status', help: KW.status, run: () => done(intStatus(ctx)) },
    { syntax: 'show interfaces trunk', help: 'Show interface trunk information', run: () => done(intTrunk(ctx)) },
    { syntax: 'show interfaces <if:iface>', help: 'Interface', run: (a) => done(intDetail(ctx, resolve(a.if!))) },
    { syntax: 'show vlan brief', help: 'VTP all VLAN status in brief', run: () => done(vlanBrief(ctx)) },
    { syntax: 'show vlan', help: 'VTP VLAN status', run: () => done(vlanBrief(ctx)) },
    { syntax: 'show etherchannel summary', help: KW.summary, run: () => done(etherchannel(ctx)) },
    { syntax: 'show cdp neighbors', help: 'CDP neighbor entries', run: () => done(cdp(ctx)) },
    { syntax: 'show lldp neighbors', help: 'LLDP neighbor entries', run: () => done(lldp(ctx)) },
    { syntax: 'show ip route', help: KW.route, run: () => done(ipRoute(ctx)) },
    { syntax: 'show ip arp', help: KW.arp, run: () => done(arp(ctx)) },
    { syntax: 'show arp', help: KW.arp, run: () => done(arp(ctx)) },
    { syntax: 'show version', help: KW.version, run: () => done(version(ctx)) },
    { syntax: 'show clock', help: 'Display the system clock', run: () => done([`*${ctx.now.toTimeString().slice(0, 8)}.000 WIB ${ctx.now.toDateString()}`]) },
    { syntax: 'ping <dst:ip>', help: 'Ping destination address', run: (a) => iosPing(ctx, a) },
    { syntax: 'ping <dst:ip> repeat <count:int:1-100>', help: 'Specify repeat count', run: (a) => iosPing(ctx, a) },
    { syntax: 'ping <dst:ip> source <src:ip>', help: 'Specify source address', run: (a) => iosPing(ctx, a) },
    { syntax: 'traceroute <dst:ip>', help: 'Trace route to destination address', run: (a) => iosTrace(ctx, a.dst!) },
  ]
  if (privileged) {
    specs.push(
      { syntax: 'show running-config', help: KW['running-config'], run: () => done(runningConfig(ctx)) },
      {
        syntax: 'show running-config interface <if:iface>',
        help: 'Show interface configuration',
        run: (a) => {
          const n = resolve(a.if!)
          const block = n === LOOPBACK ? loopbackBlock(ctx) : ifaceBlock(ctx, mustIface(ctx.device, n))
          return done(['Building configuration...', '', `Current configuration : ${block.join('\n').length} bytes`, '!', ...block, 'end'])
        },
      },
      { syntax: 'show startup-config', help: 'Contents of startup configuration', run: () => done(runningConfig(ctx).slice(3)) },
    )
  }
  return specs
}

function writeMem(): Res {
  return { save: true, out: [out('Building configuration...'), out('[OK]')] }
}

function execSpecs(ctx: Ctx): Spec[] {
  if (ctx.state.mode === 'user') {
    return [
      ...showSpecs(ctx, false),
      { syntax: 'enable', help: KW.enable, run: () => ({ state: { mode: 'enable' } }) },
      { syntax: 'exit', help: KW.exit, run: () => ({ logout: true }) },
      { syntax: 'logout', help: KW.exit, run: () => ({ logout: true }) },
    ]
  }
  return [
    ...showSpecs(ctx, true),
    { syntax: 'disable', help: KW.disable, run: () => ({ state: { mode: 'user' } }) },
    { syntax: 'configure terminal', help: KW.terminal, run: () => ({ state: { mode: 'config' }, out: [out('Enter configuration commands, one per line.  End with CNTL/Z.')] }) },
    { syntax: 'write memory', help: 'Write to NV memory', run: writeMem },
    { syntax: 'write', help: KW.write, run: writeMem },
    {
      syntax: 'copy running-config startup-config',
      help: 'Copy to startup configuration',
      run: () => ({
        state: { confirm: { prompt: 'Destination filename [startup-config]? ', answer: () => writeMem() } },
      }),
    },
    { syntax: 'exit', help: KW.exit, run: () => ({ logout: true }) },
    { syntax: 'logout', help: KW.exit, run: () => ({ logout: true }) },
  ]
}

function enterIface(ctx: Ctx, typed: string): Res {
  const { stem, num } = splitIfName(typed)
  const s = stem.toLowerCase()
  if (s.length >= 2 && 'loopback'.startsWith(s)) {
    if (num !== '0') throw new CliError('Invalid interface.', 'Simulasi hanya memodelkan satu loopback: Loopback0.')
    return { state: { mode: 'iface', iface: LOOPBACK } }
  }
  if (/^vl/i.test(s)) {
    throw new CliError('Invalid interface.', 'Interface VLAN (SVI) belum dimodelkan di simulasi; IP hanya bisa dipasang di port routed dan Loopback0.')
  }
  const names = ifaceList(ctx.device).map((i) => i.name)
  const hit = resolveIfaceName(typed, names)
  if (hit) return { state: { mode: 'iface', iface: hit } }
  if (s.length >= 2 && 'port-channel'.startsWith(s) && /^\d+$/.test(num)) {
    const name = trunkName(Number(num))
    return { state: { mode: 'iface', iface: name }, change: (d) => ensureTrunk(d, name) }
  }
  throw new CliError('Invalid interface.', `Interface ${typed} tidak ada di perangkat ini.`)
}

function configSpecs(ctx: Ctx): Spec[] {
  const names = ifaceList(ctx.device).map((i) => i.name)
  return [
    { syntax: 'hostname <name:word>', help: "This system's network name", run: (a) => ({ change: (d) => setHostname(d, a.name!) }) },
    { syntax: 'interface <if:iface>', help: 'Interface', run: (a) => enterIface(ctx, a.if!) },
    {
      syntax: 'no interface <if:iface>',
      help: 'Interface',
      run: (a) => {
        if (/^lo/i.test(a.if!)) return { change: (d) => setLoopback(d, '') }
        const hit = resolveIfaceName(a.if!, names)
        if (!hit || !ctx.device.trunks.some((t) => t.name === hit)) {
          throw new CliError('Physical interface cannot be removed.', 'Hanya Port-channel dan Loopback0 yang bisa dihapus.')
        }
        return { change: (d, env) => deleteTrunk(d, env, hit, { releaseMembers: true }) }
      },
    },
    { syntax: 'vlan <vlan:int:1-4094>', help: 'VLAN ID', run: (a) => ({ state: { mode: 'vlan', iface: a.vlan } }) },
    { syntax: 'no vlan <vlan:int:1-4094>', help: 'VLAN ID', run: () => ({ out: [hint('VLAN di simulasi mengikuti konfigurasi port — hapus VLAN-nya dari port yang memakainya.')] }) },
    { syntax: 'ip route <ip:ip> <mask:mask> <nh:ip>', help: 'Forwarding router\'s address', run: (a) => ({ change: (d) => addRoute(d, a.ip!, maskToPrefix(a.mask!)!, a.nh!) }) },
    { syntax: 'no ip route <ip:ip> <mask:mask>', help: 'Destination prefix mask', run: (a) => ({ change: (d) => removeRoute(d, a.ip!, maskToPrefix(a.mask!)!) }) },
    { syntax: 'no ip route <ip:ip> <mask:mask> <nh:ip>', help: 'Forwarding router\'s address', run: (a) => ({ change: (d) => removeRoute(d, a.ip!, maskToPrefix(a.mask!)!, a.nh!) }) },
    { syntax: 'ip routing', help: 'Enable IP routing', run: () => done() },
    { syntax: 'exit', help: 'Exit from configure mode', run: () => ({ state: { mode: 'enable' } }) },
    { syntax: 'end', help: KW.end, run: () => ({ state: { mode: 'enable', iface: undefined } }) },
  ]
}

function ifaceSpecs(ctx: Ctx): Spec[] {
  const name = ctx.state.iface ?? ''
  const base: Spec[] = [
    { syntax: 'interface <if:iface>', help: 'Interface', run: (a) => enterIface(ctx, a.if!) },
    { syntax: 'exit', help: 'Exit from interface configuration mode', run: () => ({ state: { mode: 'config', iface: undefined } }) },
    { syntax: 'end', help: KW.end, run: () => ({ state: { mode: 'enable', iface: undefined } }) },
  ]
  if (name === LOOPBACK) {
    return [
      ...base,
      {
        syntax: 'ip address <ip:ip> <mask:mask>',
        help: 'IP subnet mask',
        run: (a) => ({
          change: (d) => {
            const prefix = maskToPrefix(a.mask!)!
            const cidr = hostAddress(a.ip!, prefix)
            return setLoopback(d, prefix === 32 ? a.ip! : cidr)
          },
        }),
      },
      { syntax: 'no ip address', help: 'Remove IP address', run: () => ({ change: (d) => setLoopback(d, '') }) },
    ]
  }
  const isTrunk = ctx.device.trunks.some((t) => t.name === name)
  const cur = ifaceList(ctx.device).find((i) => i.name === name)
  const log = (state: 'up' | 'down', admin: boolean): OutLine[] => {
    const linked = cur ? ctx.env.linked.has(cur.id) : false
    const ts = `*${ctx.now.toDateString().slice(4, 10)} ${ctx.now.toTimeString().slice(0, 8)}.000:`
    if (state === 'down') {
      return [
        out(`${ts} %LINK-5-CHANGED: Interface ${name}, changed state to ${admin ? 'administratively down' : 'down'}`),
        out(`${ts} %LINEPROTO-5-UPDOWN: Line protocol on Interface ${name}, changed state to down`),
      ]
    }
    if (!linked) return []
    return [
      out(`${ts} %LINK-3-UPDOWN: Interface ${name}, changed state to up`),
      out(`${ts} %LINEPROTO-5-UPDOWN: Line protocol on Interface ${name}, changed state to up`),
    ]
  }
  const trunkAllowed = (fn: (cur: string) => string): Change =>
    onIface(name, (c) => {
      notRouted(c)
      if (c.linkType === 'access') {
        throw new CliError('Command rejected: the interface is in access mode.', 'Jalankan `switchport mode trunk` dulu.')
      }
      const base0 = c.linkType === 'none' ? { linkType: 'trunk' as const, pvid: 1, allowedVlans: '1-4094' } : {}
      return { ...base0, allowedVlans: fn(c.linkType === 'none' ? '1-4094' : c.allowedVlans) }
    })

  const specs: Spec[] = [
    ...base,
    { syntax: 'description <text:text>', help: 'Up to 240 characters describing this interface', run: (a) => ({ change: onIface(name, () => ({ description: a.text! })) }) },
    { syntax: 'no description', help: KW.description, run: () => ({ change: onIface(name, () => ({ description: '' })) }) },
    {
      syntax: 'shutdown',
      help: KW.shutdown,
      run: () => ({ change: onIface(name, () => ({ shutdown: true })), out: cur && !cur.shutdown ? log('down', true) : [] }),
    },
    {
      syntax: 'no shutdown',
      help: KW.shutdown,
      run: () => ({ change: onIface(name, () => ({ shutdown: false })), out: cur?.shutdown ? log('up', false) : [] }),
    },
    {
      syntax: 'switchport',
      help: 'Set switching mode characteristics',
      run: () => ({ change: onIface(name, (c) => (notMember(c), c.linkType === 'routed' ? { ...CLEAR_L2L3 } : {})) }),
    },
    {
      syntax: 'no switchport',
      help: 'Configure as a routed port',
      run: () => ({ change: onIface(name, (c) => (notMember(c), c.linkType === 'routed' ? {} : { ...CLEAR_L2L3, linkType: 'routed' })) }),
    },
    {
      syntax: 'switchport mode access',
      help: 'Set trunking mode to ACCESS unconditionally',
      run: () => ({
        change: onIface(name, (c) => {
          notRouted(c)
          return c.linkType === 'access' ? {} : { ...CLEAR_L2L3, linkType: 'access', pvid: 1 }
        }),
      }),
    },
    {
      syntax: 'switchport mode trunk',
      help: 'Set trunking mode to TRUNK unconditionally',
      run: () => ({
        change: onIface(name, (c) => {
          notRouted(c)
          if (c.linkType === 'trunk') return {}
          if (c.linkType === 'hybrid') return { linkType: 'trunk', allowedVlans: vlanUnion(c.allowedVlans, vlanNums(c.untaggedVlans)), untaggedVlans: '' }
          return { ...CLEAR_L2L3, linkType: 'trunk', pvid: 1, allowedVlans: '1-4094' }
        }),
      }),
    },
    {
      syntax: 'no switchport mode',
      help: 'Set trunking mode to default',
      run: () => ({ change: onIface(name, (c) => (L2.has(c.linkType) ? { ...CLEAR_L2L3 } : {})) }),
    },
    {
      syntax: 'switchport access vlan <vlan:int:1-4094>',
      help: 'VLAN ID of the VLAN when this port is in access mode',
      run: (a) => ({
        change: onIface(name, (c) => {
          notRouted(c)
          if (c.linkType === 'none') return { ...CLEAR_L2L3, linkType: 'access', pvid: Number(a.vlan) }
          if (c.linkType !== 'access') {
            throw new CliError('Command rejected: the interface is in trunk mode.', 'Port ini sedang trunk; jalankan `switchport mode access` dulu.')
          }
          return { pvid: Number(a.vlan) }
        }),
      }),
    },
    {
      syntax: 'no switchport access vlan',
      help: 'Set access mode VLAN to default',
      run: () => ({ change: onIface(name, (c) => (c.linkType === 'access' ? { pvid: 1 } : {})) }),
    },
    { syntax: 'switchport trunk allowed vlan <v:list>', help: 'VLAN IDs of the allowed VLANs when this port is in trunking mode', run: (a) => ({ change: trunkAllowed(() => formatVlanList(parseVlanWords(a.v!))) }) },
    { syntax: 'switchport trunk allowed vlan add <v:list>', help: 'add VLANs to the current list', run: (a) => ({ change: trunkAllowed((c) => vlanUnion(c, parseVlanWords(a.v!))) }) },
    { syntax: 'switchport trunk allowed vlan remove <v:list>', help: 'remove VLANs from the current list', run: (a) => ({ change: trunkAllowed((c) => vlanMinus(c, parseVlanWords(a.v!))) }) },
    { syntax: 'switchport trunk allowed vlan all', help: 'all VLANs', run: () => ({ change: trunkAllowed(() => '1-4094') }) },
    { syntax: 'switchport trunk allowed vlan none', help: 'no VLANs', run: () => ({ change: trunkAllowed(() => '') }) },
    {
      syntax: 'switchport trunk native vlan <vlan:int:1-4094>',
      help: 'Set native VLAN when interface is in trunking mode',
      run: (a) => ({
        change: onIface(name, (c) => {
          notRouted(c)
          if (c.linkType === 'access') throw new CliError('Command rejected: the interface is in access mode.', 'Jalankan `switchport mode trunk` dulu.')
          if (c.linkType === 'none') return { linkType: 'trunk', pvid: Number(a.vlan), allowedVlans: '1-4094' }
          return { pvid: Number(a.vlan) }
        }),
      }),
    },
    {
      syntax: 'no switchport trunk native vlan',
      help: 'Set native VLAN to default',
      run: () => ({ change: onIface(name, (c) => (c.linkType === 'trunk' ? { pvid: 1 } : {})) }),
    },
    {
      syntax: 'ip address <ip:ip> <mask:mask>',
      help: 'IP subnet mask',
      run: (a) => ({
        change: (d) => {
          const cidr = hostAddress(a.ip!, maskToPrefix(a.mask!)!)
          checkOverlap(d, name, cidr)
          return patchIface(d, name, (c) => {
            notMember(c)
            if (L2.has(c.linkType) || (c.linkType === 'none' && !isL3Device(d))) {
              throw new CliError('IP addresses may not be configured on L2 links.', `${c.name} masih switchport. Jalankan \`no switchport\` dulu.`)
            }
            return { linkType: 'routed', ipAddress: cidr }
          })
        },
      }),
    },
    { syntax: 'no ip address', help: 'Remove IP address', run: () => ({ change: onIface(name, (c) => (c.linkType === 'routed' ? { ipAddress: '' } : {})) }) },
  ]
  if (!isTrunk) {
    const group = (n: string, mode: 'lacp' | 'static'): Change => (d, env) => {
      const t = trunkName(Number(n))
      const created = !d.trunks.some((x) => x.name === t)
      let next = ensureTrunk(d, t, mode)
      if (!created) next = setTrunkMode(next, t, mode)
      return joinTrunk(next, env, t, name)
    }
    const created = (n: string): OutLine[] =>
      ctx.device.trunks.some((x) => x.name === trunkName(Number(n))) ? [] : [out(`Creating a port-channel interface Port-channel ${Number(n)}`), out('')]
    specs.push(
      { syntax: 'channel-group <n:int:1-128> mode active', help: 'Enable LACP unconditionally', run: (a) => ({ change: group(a.n!, 'lacp'), out: created(a.n!) }) },
      { syntax: 'channel-group <n:int:1-128> mode passive', help: 'Enable LACP only if a LACP device is detected', run: (a) => ({ change: group(a.n!, 'lacp'), out: created(a.n!) }) },
      { syntax: 'channel-group <n:int:1-128> mode on', help: 'Enable Etherchannel only', run: (a) => ({ change: group(a.n!, 'static'), out: created(a.n!) }) },
      { syntax: 'no channel-group', help: 'Remove from the channel group', run: () => ({ change: (d) => leaveTrunk(d, name) }) },
    )
  }
  return specs
}

function withDo(ctx: Ctx, specs: Spec[]): Spec[] {
  return [
    ...specs,
    {
      syntax: 'do <cmd:text>',
      help: 'Exec Command',
      run: (a) => {
        const inner: Ctx = { ...ctx, state: { ...ctx.state, mode: 'enable' } }
        const r = runSpecs(execSpecs(inner), tokenize(a.cmd!), STYLE, prompt(ctx).length + 3)
        return { ...r, state: undefined, logout: false }
      },
    },
  ]
}

function specsFor(ctx: Ctx): Spec[] {
  switch (ctx.state.mode) {
    case 'config':
      return withDo(ctx, configSpecs(ctx))
    case 'iface':
      return withDo(ctx, ifaceSpecs(ctx))
    case 'vlan':
      return withDo(ctx, [
        { syntax: 'name <text:text>', help: 'Ascii name of the VLAN', run: () => done() },
        { syntax: 'exit', help: 'Apply changes, bump revision number, and exit mode', run: () => ({ state: { mode: 'config', iface: undefined } }) },
        { syntax: 'end', help: KW.end, run: () => ({ state: { mode: 'enable', iface: undefined } }) },
        { syntax: 'vlan <vlan:int:1-4094>', help: 'VLAN ID', run: (a) => ({ state: { mode: 'vlan', iface: a.vlan } }) },
      ])
    default:
      return execSpecs(ctx)
  }
}

function prompt(ctx: Ctx): string {
  const h = ctx.device.hostname
  switch (ctx.state.mode) {
    case 'user':
      return `${h}>`
    case 'config':
      return `${h}(config)#`
    case 'iface':
      return `${h}(config-if)#`
    case 'vlan':
      return `${h}(config-vlan)#`
    default:
      return `${h}#`
  }
}

export const ios: Dialect = {
  id: 'ios',
  errorPrefix: '% ',
  ctrlZ: 'end',
  init: () => ({ mode: 'user', path: [], pending: [], vars: {} }),
  banner: (ctx) => [
    out(''),
    hint(
      isCisco(ctx)
        ? 'Simulasi CLI Cisco IOS — `enable` lalu `configure terminal`. Ketik ? untuk bantuan, Tab untuk melengkapi. Perubahan langsung tampil di kanvas dan bisa di-undo.'
        : `Perangkat ${ctx.env.model ? VENDOR_META[ctx.env.model.vendor].label : ''} ini disimulasikan dengan sintaks gaya Cisco IOS — sintaks aslinya bisa sedikit berbeda. Ketik ? untuk bantuan.`,
    ),
    out(''),
    out('Press RETURN to get started!'),
    out(''),
  ],
  prompt,
  twoStage: () => false,
  exec: (ctx, line) => {
    const { cmd, pipes } = splitPipe(line)
    const tokens = tokenize(cmd)
    // Kata tunggal yang tidak dikenal di mode EXEC dianggap nama host — khas IOS.
    if (tokens.length === 1 && (ctx.state.mode === 'user' || ctx.state.mode === 'enable')) {
      const r = runSpecs(specsFor(ctx), tokens, STYLE, prompt(ctx).length)
      if (r.out?.some((l) => l.text.includes('Invalid input'))) {
        return {
          out: [
            out(`Translating "${tokens[0]!.text}"...domain server (255.255.255.255)`),
            { text: '% Unknown command or computer name, or unable to find computer address', kind: 'err' },
          ],
        }
      }
      return r
    }
    const res = runSpecs(specsFor(ctx), tokens, STYLE, prompt(ctx).length)
    if (pipes.length === 0 || !res.out) return res
    const piped = applyPipes(res.out, pipes, { include: 'include', exclude: 'exclude', begin: 'begin', section: 'section', count: 'count' })
    if (!piped.ok) return { out: [{ text: "% Invalid input detected at '^' marker.", kind: 'err' }] }
    return { ...res, out: piped.lines }
  },
  help: (ctx, line) => specHelp(specsFor(ctx), line, STYLE),
  complete: (ctx, line) => specComplete(specsFor(ctx), line, STYLE, [...ifaceList(ctx.device).map((i) => i.name), LOOPBACK]),
}
