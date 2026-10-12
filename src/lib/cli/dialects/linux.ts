import { broadcastOf, contains, formatIp, networkOf, parseCidr, parseIp } from '@/lib/ip'
import { pingHint, runSpecs, simulatePing, simulateTrace, type Spec, type SpecStyle, specComplete, specHelp, stats, TRACE_STOP } from '../engine'
import {
  addRoute,
  CLEAR_L2L3,
  checkOverlap,
  hostAddress,
  ifaceList,
  type IfaceView,
  patchIface,
  removeRoute,
  setHostname,
  setLoopback,
} from '../ops'
import { netIface } from '../render'
import { macOf, type Token, tokenize } from '../text'
import { type Change, CliError, type Ctx, type Dialect, type ExecResult, hint, type OutLine, out } from '../types'

/**
 * Shell Linux untuk server, ONT, dan CPE — padanan "Command Prompt" PC di
 * Packet Tracer: lihat alamat, pasang IP dan gateway, lalu ping.
 */

const done = (o: string[] = []): ExecResult => ({ out: o.map(out) })

const STYLE: SpecStyle = {
  abbrev: false,
  kwHelp: {},
  crLabel: '',
  paramLabel: (p) => p.param.toUpperCase(),
  syntaxError: (_kind, _c, word) => [{ text: word ? `Command line is not complete. Try "help".` : 'Command line is not complete.', kind: 'err' }],
}

/** `ip a s` → `ip address show`, seperti iproute2 yang menerima singkatan. */
function normalize(tokens: Token[]): Token[] {
  if (tokens[0]?.text !== 'ip') return tokens
  const obj = ['address', 'route', 'link']
  const verbs = ['add', 'del', 'show', 'list', 'flush', 'set']
  const fix = (t: Token | undefined, names: string[]) => {
    if (!t) return t
    const hit = names.find((n) => n.startsWith(t.text))
    return hit ? { ...t, text: hit } : t
  }
  const out = [...tokens]
  out[1] = fix(out[1], obj)!
  if (out[2]) out[2] = fix(out[2], verbs)!
  if (out[2]?.text === 'list') out[2] = { ...out[2], text: 'show' }
  return out.filter(Boolean)
}

function stateOf(ctx: Ctx, i: IfaceView): { flags: string; state: string } {
  if (i.shutdown) return { flags: 'BROADCAST,MULTICAST', state: 'DOWN' }
  return netIface(ctx, i.id)?.up ? { flags: 'BROADCAST,MULTICAST,UP,LOWER_UP', state: 'UP' } : { flags: 'NO-CARRIER,BROADCAST,MULTICAST,UP', state: 'DOWN' }
}

function ipAddr(ctx: Ctx): string[] {
  const o = [
    '1: lo: <LOOPBACK,UP,LOWER_UP> mtu 65536 qdisc noqueue state UNKNOWN group default qlen 1000',
    '    link/loopback 00:00:00:00:00:00 brd 00:00:00:00:00:00',
    '    inet 127.0.0.1/8 scope host lo',
    '       valid_lft forever preferred_lft forever',
  ]
  if (ctx.device.loopback) o.push(`    inet ${ctx.device.loopback.includes('/') ? ctx.device.loopback : `${ctx.device.loopback}/32`} scope global lo`, '       valid_lft forever preferred_lft forever')
  ifaceList(ctx.device).forEach((i, k) => {
    const s = stateOf(ctx, i)
    o.push(`${k + 2}: ${i.name}: <${s.flags}> mtu 1500 qdisc mq state ${s.state} group default qlen 1000`, `    link/ether ${macOf(ctx.env.deviceId, k, '52:54:00')} brd ff:ff:ff:ff:ff:ff`)
    const c = i.linkType === 'routed' ? parseCidr(i.ipAddress) : null
    if (c) o.push(`    inet ${i.ipAddress} brd ${formatIp(broadcastOf(c))} scope global ${i.name}`, '       valid_lft forever preferred_lft forever')
  })
  return o
}

/** Tabel rute kernel: dibaca dari konfigurasi, dengan tanda `linkdown` untuk NIC tanpa kabel. */
function ipRoute(ctx: Ctx): string[] {
  const nets = ifaceList(ctx.device).flatMap((i) => {
    const c = i.linkType === 'routed' ? parseCidr(i.ipAddress) : null
    return c ? [{ i, c, down: !netIface(ctx, i.id)?.up }] : []
  })
  const o: string[] = []
  for (const r of ctx.device.staticRoutes) {
    const nh = parseIp(r.nextHop)
    const via = nets.find((n) => nh !== null && contains({ addr: networkOf(n.c), prefix: n.c.prefix }, { addr: nh, prefix: 32 }))
    if (!via) continue
    o.push(`${r.prefix === '0.0.0.0/0' ? 'default' : r.prefix} via ${r.nextHop} dev ${via.i.name}${via.down ? ' linkdown' : ''} `)
  }
  for (const n of nets) {
    o.push(`${formatIp(networkOf(n.c))}/${n.c.prefix} dev ${n.i.name} proto kernel scope link src ${formatIp(n.c.addr)}${n.down ? ' linkdown' : ''} `)
  }
  return o
}

function linuxPing(ctx: Ctx, dst: string, count: number): ExecResult {
  const run = simulatePing(ctx, dst, count)
  if (run.noRoute) return { out: [{ text: 'ping: connect: Network is unreachable', kind: 'err' }, ...pingHint(run)] }
  const s = stats(run.replies)
  const rows = run.replies.flatMap((r, k) => (r === null ? [] : [out(`64 bytes from ${dst}: icmp_seq=${k + 1} ttl=${run.ttl} time=${r.toFixed(3)} ms`)]))
  return {
    out: [out(`PING ${dst} (${dst}) 56(84) bytes of data.`)],
    stream: {
      lines: [
        ...(rows.length ? rows : [out('')]),
        out(''),
        out(`--- ${dst} ping statistics ---`),
        out(`${s.sent} packets transmitted, ${s.got} received, ${Math.round(s.loss)}% packet loss, time ${(s.sent - 1) * 1003}ms`),
        ...(s.got ? [out(`rtt min/avg/max/mdev = ${s.min.toFixed(3)}/${s.avg.toFixed(3)}/${s.max.toFixed(3)}/${((s.max - s.min) / 2).toFixed(3)} ms`)] : pingHint(run)),
      ],
      interval: s.got ? 320 : 900,
    },
  }
}

function linuxTrace(ctx: Ctx, dst: string): ExecResult {
  const t = simulateTrace(ctx, dst)
  const rows: OutLine[] = t.hops.map((h, k) => {
    if (h.ip === null) return out(`${String(k + 1).padStart(2)}  * * *`)
    const ip = formatIp(h.ip)
    const b = (k + 1) * 0.7
    return out(`${String(k + 1).padStart(2)}  ${ip} (${ip})  ${b.toFixed(3)} ms  ${(b + 0.1).toFixed(3)} ms  ${(b + 0.2).toFixed(3)} ms`)
  })
  if (!t.reached) {
    for (let k = t.hops.length; k < t.hops.length + 3; k += 1) rows.push(out(`${String(k + 1).padStart(2)}  * * *`))
    rows.push(hint(TRACE_STOP))
  }
  return { out: [out(`traceroute to ${dst} (${dst}), 30 hops max, 60 byte packets`)], stream: { lines: rows, interval: 400 } }
}

function dev(ctx: Ctx, name: string): IfaceView {
  const i = ifaceList(ctx.device).find((x) => x.name === name)
  if (!i) throw new CliError(`Cannot find device "${name}"`)
  return i
}

function addAddr(ctx: Ctx, cidrText: string, name: string): ExecResult {
  const c = parseCidr(cidrText.includes('/') ? cidrText : `${cidrText}/32`)
  if (!c) throw new CliError(`Error: any valid prefix is expected rather than "${cidrText}".`)
  const cidr = hostAddress(formatIp(c.addr), c.prefix)
  if (name === 'lo') return { change: (d) => setLoopback(d, c.prefix === 32 ? formatIp(c.addr) : cidr) }
  const i = dev(ctx, name)
  const note = i.linkType !== 'none' && i.linkType !== 'routed' ? [hint(`${name} sebelumnya diatur sebagai port ${i.linkType}; sekarang menjadi interface ber-IP.`)] : []
  const change: Change = (d) => {
    const cur = ifaceList(d).find((x) => x.name === name)!
    if (cur.linkType === 'routed' && cur.ipAddress) throw new CliError('RTNETLINK answers: File exists', 'Simulasi hanya memodelkan satu alamat per interface; hapus dulu dengan `ip addr del`.')
    checkOverlap(d, name, cidr)
    return patchIface(d, name, () => ({ ...CLEAR_L2L3, linkType: 'routed', ipAddress: cidr }))
  }
  return { change, out: note }
}

function addGw(ctx: Ctx, dest: string, via: string): ExecResult {
  const nh = parseIp(via)
  if (nh === null) throw new CliError(`Error: inet address is expected rather than "${via}".`)
  const c = dest === 'default' ? { addr: 0, prefix: 0 } : parseCidr(dest)
  if (!c) throw new CliError(`Error: inet prefix is expected rather than "${dest}".`)
  const reachable = ifaceList(ctx.device).some((i) => {
    const a = i.linkType === 'routed' ? parseCidr(i.ipAddress) : null
    return a && contains({ addr: networkOf(a), prefix: a.prefix }, { addr: nh, prefix: 32 })
  })
  if (!reachable) throw new CliError('RTNETLINK answers: Network is unreachable', `Gateway ${via} tidak berada di subnet mana pun milik perangkat ini. Pasang dulu alamat IP di interface yang satu subnet dengannya.`)
  return { change: (d) => addRoute(d, formatIp(c.addr), c.prefix, via) }
}

function specs(ctx: Ctx): Spec[] {
  return [
    { syntax: 'ip address', help: 'Show addresses', run: () => done(ipAddr(ctx)) },
    { syntax: 'ip address show', help: 'Show addresses', run: () => done(ipAddr(ctx)) },
    { syntax: 'ip address add <cidr:word> dev <dev:word>', help: 'Add address', run: (a) => addAddr(ctx, a.cidr!, a.dev!) },
    { syntax: 'ip address del <cidr:word> dev <dev:word>', help: 'Delete address', run: (a) => ({ change: (d) => (a.dev === 'lo' ? setLoopback(d, '') : patchIface(d, dev(ctx, a.dev!).name, () => ({ ...CLEAR_L2L3 }))) }) },
    { syntax: 'ip address flush dev <dev:word>', help: 'Flush addresses', run: (a) => ({ change: (d) => patchIface(d, dev(ctx, a.dev!).name, () => ({ ...CLEAR_L2L3 })) }) },
    { syntax: 'ip route', help: 'Show routes', run: () => done(ipRoute(ctx)) },
    { syntax: 'ip route show', help: 'Show routes', run: () => done(ipRoute(ctx)) },
    { syntax: 'ip route add <dest:word> via <via:word>', help: 'Add route', run: (a) => addGw(ctx, a.dest!, a.via!) },
    { syntax: 'ip route add <dest:word> via <via:word> dev <dev:word>', help: 'Add route', run: (a) => addGw(ctx, a.dest!, a.via!) },
    {
      syntax: 'ip route del <dest:word>',
      help: 'Delete route',
      run: (a) => {
        const c = a.dest === 'default' ? { addr: 0, prefix: 0 } : parseCidr(a.dest!)
        if (!c) throw new CliError(`Error: inet prefix is expected rather than "${a.dest}".`)
        return { change: (d) => removeRoute(d, formatIp(c.addr), c.prefix) }
      },
    },
    { syntax: 'ip link', help: 'Show links', run: () => done(ipAddr(ctx).filter((l) => !/^\s+(inet|valid_lft)/.test(l))) },
    { syntax: 'ip link show', help: 'Show links', run: () => done(ipAddr(ctx).filter((l) => !/^\s+(inet|valid_lft)/.test(l))) },
    { syntax: 'ip link set <dev:word> up', help: 'Bring up', run: (a) => ({ change: (d) => patchIface(d, dev(ctx, a.dev!).name, () => ({ shutdown: false })) }) },
    { syntax: 'ip link set <dev:word> down', help: 'Bring down', run: (a) => ({ change: (d) => patchIface(d, dev(ctx, a.dev!).name, () => ({ shutdown: true })) }) },
    { syntax: 'ip link set dev <dev:word> up', help: 'Bring up', run: (a) => ({ change: (d) => patchIface(d, dev(ctx, a.dev!).name, () => ({ shutdown: false })) }) },
    { syntax: 'ip link set dev <dev:word> down', help: 'Bring down', run: (a) => ({ change: (d) => patchIface(d, dev(ctx, a.dev!).name, () => ({ shutdown: true })) }) },
    { syntax: 'ifconfig', help: 'Show interfaces', run: () => done(ipAddr(ctx)) },
    { syntax: 'ping <dst:ip>', help: 'Ping', run: (a) => linuxPing(ctx, a.dst!, 4) },
    { syntax: 'ping -c <n:int:1-100> <dst:ip>', help: 'Ping', run: (a) => linuxPing(ctx, a.dst!, Number(a.n)) },
    { syntax: 'traceroute <dst:ip>', help: 'Traceroute', run: (a) => linuxTrace(ctx, a.dst!) },
    { syntax: 'hostname', help: 'Show hostname', run: () => done([ctx.device.hostname]) },
    { syntax: 'hostname <name:word>', help: 'Set hostname', run: (a) => ({ change: (d) => setHostname(d, a.name!) }) },
    { syntax: 'clear', help: 'Clear screen', run: () => ({ clear: true }) },
    { syntax: 'exit', help: 'Logout', run: () => ({ logout: true, out: [out('logout')] }) },
    { syntax: 'logout', help: 'Logout', run: () => ({ logout: true, out: [out('logout')] }) },
    {
      syntax: 'help',
      help: 'Help',
      run: () =>
        done([
          'Perintah yang tersedia di simulasi:',
          '  ip addr [show]                     ip addr add 10.0.0.2/24 dev nic1',
          '  ip route [show]                    ip route add default via 10.0.0.1',
          '  ip link set nic1 up|down           ping [-c N] 10.0.0.1',
          '  traceroute 10.0.0.1                hostname [nama]',
        ]),
    },
  ]
}

function prompt(ctx: Ctx): string {
  return `root@${ctx.device.hostname}:~# `
}

export const linux: Dialect = {
  id: 'linux',
  errorPrefix: '',
  init: () => ({ mode: 'shell', path: [], pending: [], vars: {} }),
  banner: (ctx) => [
    out(`Linux ${ctx.device.hostname} 6.8.0-45-generic #45-Ubuntu SMP x86_64`),
    out(''),
    hint('Simulasi shell Linux — `ip addr`, `ip route`, `ping`. Ketik `help` untuk daftar perintah.'),
    out(''),
  ],
  prompt,
  twoStage: () => false,
  exec: (ctx, line) => {
    const tokens = normalize(tokenize(line))
    if (tokens.length === 0) return {}
    const first = tokens[0]!.text
    const known = specs(ctx).some((s) => s.syntax.split(' ')[0] === first)
    if (!known) return { out: [{ text: `bash: ${first}: command not found`, kind: 'err' }] }
    return runSpecs(specs(ctx), tokens, STYLE, prompt(ctx).length)
  },
  help: (ctx, line) => specHelp(specs(ctx), line, STYLE),
  complete: (ctx, line) => specComplete(specs(ctx), line, STYLE, ifaceList(ctx.device).map((i) => i.name)),
}
