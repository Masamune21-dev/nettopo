import { formatCidr, formatIp, networkOf, parseCidr } from '@/lib/ip'
import type { DeviceNodeData } from '@/store/types'
import { errorLines, simulatePing, simulateTrace, stats, pingHint, TRACE_STOP } from '../engine'
import { isL3Device, routesOf } from '../net'
import {
  addRoute,
  CLEAR_L2L3,
  checkOverlap,
  deleteTrunk,
  ensureTrunk,
  hostAddress,
  ifaceList,
  type IfaceView,
  joinTrunk,
  leaveTrunk,
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
import { modelName, neighbors, netIface, uptime } from '../render'
import { col, macOf, row, stamp, type Token, tokenize } from '../text'
import { CliError, type Ctx, type Dialect, type ExecResult, hint, type OutLine, out } from '../types'

/**
 * MikroTik RouterOS 7. Perintah tersusun dalam menu (`/ip address add …`)
 * dengan argumen `key=value`. VLAN mengikuti model bridge VLAN filtering:
 * `bridge port` menentukan PVID, `bridge vlan` menentukan tagged/untagged —
 * keduanya dipetakan ke access/trunk/hybrid yang sama dengan panel kanan.
 */

const BRIDGE = 'bridge1'
const LOOPBACK = 'lo'

interface RosArgs {
  pos: string[]
  kv: Record<string, string>
}

interface RosCmd {
  name: string
  help: string
  args?: string[]
  run: (ctx: Ctx, a: RosArgs) => ExecResult
}

interface RosMenu {
  name: string
  help: string
  menus?: RosMenu[]
  cmds?: RosCmd[]
}

const done = (o: string[] = []): ExecResult => ({ out: o.map(out) })

const yes = (v: string | undefined) => v === 'yes' || v === 'true'

/* ── Daftar item (urutan = nomor di `print`) ─────────────────────────────── */

const ports = (d: DeviceNodeData) => ifaceList(d).filter((i) => i.kind === 'port')
const bonds = (d: DeviceNodeData) => ifaceList(d).filter((i) => i.kind === 'trunk')
const bridgePorts = (d: DeviceNodeData) => ifaceList(d).filter((i) => !i.memberOf && ['access', 'trunk', 'hybrid'].includes(i.linkType))
const addresses = (d: DeviceNodeData) => [
  ...ifaceList(d).filter((i) => i.linkType === 'routed' && i.ipAddress && !i.memberOf).map((i) => ({ iface: i.name, cidr: i.ipAddress })),
  ...(d.loopback ? [{ iface: LOOPBACK, cidr: d.loopback.includes('/') ? d.loopback : `${d.loopback}/32` }] : []),
]

interface VlanRow {
  vlan: number
  tagged: string[]
  untagged: string[]
  dynamic: boolean
}

function bridgeVlans(d: DeviceNodeData): VlanRow[] {
  const bp = bridgePorts(d)
  const all = new Set<number>()
  for (const i of bp) {
    all.add(i.pvid ?? 1)
    for (const v of [...vlanNums(i.allowedVlans), ...vlanNums(i.untaggedVlans)]) all.add(v)
  }
  const rows: VlanRow[] = [...all].sort((a, b) => a - b).map((v) => {
    const tagged: string[] = []
    const untagged: string[] = []
    for (const i of bp) {
      const pvid = i.pvid ?? 1
      if (pvid === v || vlanNums(i.untaggedVlans).includes(v)) untagged.push(i.name)
      else if (i.linkType !== 'access' && vlanNums(i.allowedVlans).includes(v)) tagged.push(i.name)
    }
    return { vlan: v, tagged, untagged, dynamic: tagged.length === 0 && bp.every((i) => !vlanNums(i.untaggedVlans).includes(v)) }
  })
  // Entri statis (punya tagged) diberi nomor lebih dulu, seperti di RouterOS.
  return [...rows.filter((r) => !r.dynamic), ...rows.filter((r) => r.dynamic)]
}

/** Resolusi item untuk set/remove/enable/disable: nomor, nama, atau `[find key=value]`. */
function pick<T>(items: T[], ref: string | undefined, keyOf: (t: T) => Record<string, string>): T[] {
  if (ref === undefined) throw new CliError('missing value for numbers')
  const find = /^\[\s*find\s+(?:where\s+)?(.*?)\s*\]$/.exec(ref)
  if (find) {
    const conds = [...find[1]!.matchAll(/([\w-]+)="?([^"\s]*)"?/g)].map((m) => [m[1]!, m[2]!] as const)
    return items.filter((t) => conds.every(([k, v]) => keyOf(t)[k] === v))
  }
  const out: T[] = []
  for (const part of ref.split(',')) {
    if (/^\d+$/.test(part)) {
      const t = items[Number(part)]
      if (!t) throw new CliError(`no such item (${part})`, 'Nomor item mengikuti urutan `print` terakhir.')
      out.push(t)
    } else {
      const t = items.find((x) => Object.values(keyOf(x)).includes(part))
      if (!t) throw new CliError(`no such item`)
      out.push(t)
    }
  }
  return out
}

function ifaceRef(d: DeviceNodeData, name: string | undefined): IfaceView {
  const i = ifaceList(d).find((x) => x.name === name)
  if (!i) throw new CliError('input does not match any value of interface', name ? `Interface ${name} tidak ada di perangkat ini.` : undefined)
  return i
}

const flagsOf = (ctx: Ctx, i: IfaceView) =>
  `${i.shutdown ? 'X' : ''}${netIface(ctx, i.id)?.up && !i.shutdown ? 'R' : ''}${i.memberOf || bridgePorts(ctx.device).includes(i) ? 'S' : ''}`

const rosMac = (ctx: Ctx, idx: number) => macOf(ctx.env.deviceId, idx, '48:a9:8a').toUpperCase()

/* ── Ekspor ──────────────────────────────────────────────────────────────── */

function exportLines(ctx: Ctx, section?: string): string[] {
  const d = ctx.device
  const o: string[] = []
  const add = (menu: string, lines: string[]) => {
    if (!lines.length || (section && !menu.startsWith(section))) return
    o.push(menu, ...lines)
  }
  const bp = bridgePorts(d)
  add('/interface bridge', bp.length ? [`add name=${BRIDGE} vlan-filtering=yes`] : [])
  add(
    '/interface ethernet',
    ports(d)
      .filter((p) => p.description || p.shutdown)
      .map((p) => `set [ find default-name=${p.name} ]${p.description ? ` comment="${p.description}"` : ''}${p.shutdown ? ' disabled=yes' : ''}`),
  )
  add(
    '/interface bonding',
    bonds(d).map((b) => {
      const slaves = ports(d).filter((p) => p.memberOf === b.id).map((p) => p.name).join(',')
      return `add${b.description ? ` comment="${b.description}"` : ''} mode=${b.mode === 'lacp' ? '802.3ad' : 'balance-xor'} name=${b.name} slaves=${slaves}`
    }),
  )
  add('/interface bridge port', bp.map((i) => `add bridge=${BRIDGE} interface=${i.name}${(i.pvid ?? 1) !== 1 ? ` pvid=${i.pvid}` : ''}`))
  add(
    '/interface bridge vlan',
    bridgeVlans(d)
      .filter((r) => !r.dynamic)
      .map((r) => `add bridge=${BRIDGE}${r.tagged.length ? ` tagged=${r.tagged.join(',')}` : ''}${r.untagged.length ? ` untagged=${r.untagged.join(',')}` : ''} vlan-ids=${r.vlan}`),
  )
  add(
    '/ip address',
    addresses(d).map((a) => {
      const c = parseCidr(a.cidr)!
      return `add address=${a.cidr} interface=${a.iface} network=${formatIp(networkOf(c))}`
    }),
  )
  add('/ip route', d.staticRoutes.map((r) => `add dst-address=${r.prefix} gateway=${r.nextHop}`))
  add('/system identity', [`set name=${d.hostname}`])
  return [`# ${stamp(ctx.now)} by RouterOS 7.16.1`, `# model = ${modelName(ctx)}`, ...o]
}

/* ── Perintah ────────────────────────────────────────────────────────────── */

function setIfaceProps(a: RosArgs, keyOf: (i: IfaceView) => Record<string, string>, list: (d: DeviceNodeData) => IfaceView[]): ExecResult {
  return {
    change: (d) => {
      let next = d
      for (const i of pick(list(d), a.pos[0] ?? a.kv.numbers, keyOf)) {
        next = patchIface(next, i.name, () => ({
          ...(a.kv.comment !== undefined ? { description: a.kv.comment } : {}),
          ...(a.kv.disabled !== undefined ? { shutdown: yes(a.kv.disabled) } : {}),
        }))
      }
      return next
    },
  }
}

const byName = (i: IfaceView) => ({ name: i.name, 'default-name': i.name })

function toggle(list: (d: DeviceNodeData) => IfaceView[], disabled: boolean): RosCmd {
  return {
    name: disabled ? 'disable' : 'enable',
    help: disabled ? 'Disable items' : 'Enable items',
    run: (_ctx, a) => ({
      change: (d) => {
        let next = d
        for (const i of pick(list(d), a.pos[0] ?? a.kv.numbers, byName)) next = patchIface(next, i.name, () => ({ shutdown: disabled }))
        return next
      },
    }),
  }
}

function interfacePrint(ctx: Ctx, list: IfaceView[]): string[] {
  const o = ['Flags: X - DISABLED; R - RUNNING; S - SLAVE', 'Columns: NAME, TYPE, ACTUAL-MTU, L2MTU, MAC-ADDRESS', ` #     ${row([['NAME', 15], ['TYPE', 10], ['ACTUAL-MTU', 12], ['L2MTU', 7], ['MAC-ADDRESS', 0]])}`]
  const all = ifaceList(ctx.device)
  list.forEach((i, k) => {
    const type = i.kind === 'trunk' ? 'bond' : 'ether'
    o.push(`${String(k).padStart(2)}  ${col(flagsOf(ctx, i), 3)}${row([[i.name, 15], [type, 10], ['1500'.padStart(10), 12], ['1598'.padStart(5), 7], [rosMac(ctx, all.findIndex((x) => x.id === i.id)), 0]])}`)
  })
  if (list.length === all.length) {
    let k = list.length
    if (bridgePorts(ctx.device).length) o.push(`${String(k++).padStart(2)}  R  ${row([[BRIDGE, 15], ['bridge', 10], ['1500'.padStart(10), 12], ['1598'.padStart(5), 7], [rosMac(ctx, 90), 0]])}`)
    o.push(`${String(k).padStart(2)}  R  ${row([[LOOPBACK, 15], ['loopback', 10], ['65536'.padStart(10), 12], ['', 7], ['00:00:00:00:00:00', 0]])}`)
  }
  return o
}

function bondingCmds(): RosCmd[] {
  const modeOf = (m: string | undefined) => (m === '802.3ad' ? 'lacp' : 'static')
  const nextName = (d: DeviceNodeData) => {
    let n = 1
    while (d.trunks.some((t) => t.name === `bond${n}`)) n += 1
    return `bond${n}`
  }
  return [
    {
      name: 'print',
      help: 'Print values of item properties',
      run: (ctx) => {
        const o = ['Flags: X - DISABLED; R - RUNNING', 'Columns: NAME, MODE, SLAVES', ` #    ${row([['NAME', 8], ['MODE', 13], ['SLAVES', 0]])}`]
        bonds(ctx.device).forEach((b, k) => {
          const slaves = ports(ctx.device).filter((p) => p.memberOf === b.id).map((p) => p.name).join(',')
          o.push(`${String(k).padStart(2)} ${col(flagsOf(ctx, b), 3)}${row([[b.name, 8], [b.mode === 'lacp' ? '802.3ad' : 'balance-xor', 13], [slaves, 0]])}`)
        })
        return done(o)
      },
    },
    {
      name: 'add',
      help: 'Create a new item',
      args: ['name', 'slaves', 'mode', 'comment', 'disabled', 'lacp-rate', 'transmit-hash-policy'],
      run: (_ctx, a) => {
        if (!a.kv.slaves) throw new CliError('missing value for slaves', 'Contoh: /interface bonding add name=bond1 slaves=ether1,ether2 mode=802.3ad')
        return {
          change: (d, env) => {
            const name = a.kv.name ?? nextName(d)
            if (d.trunks.some((t) => t.name === name)) throw new CliError('entry already exists')
            let next = ensureTrunk(d, name, modeOf(a.kv.mode))
            for (const s of a.kv.slaves!.split(',')) {
              ifaceRef(next, s)
              next = joinTrunk(next, env, name, s)
            }
            return a.kv.comment ? patchIface(next, name, () => ({ description: a.kv.comment! })) : next
          },
        }
      },
    },
    {
      name: 'set',
      help: 'Change item properties',
      args: ['slaves', 'mode', 'comment', 'disabled', 'numbers'],
      run: (_ctx, a) => ({
        change: (d, env) => {
          let next = d
          for (const b of pick(bonds(d), a.pos[0] ?? a.kv.numbers, byName)) {
            if (a.kv.mode) next = setTrunkMode(next, b.name, modeOf(a.kv.mode))
            if (a.kv.slaves !== undefined) {
              for (const p of ports(next).filter((x) => x.memberOf === b.id)) next = leaveTrunk(next, p.name)
              for (const s of a.kv.slaves.split(',').filter(Boolean)) next = joinTrunk(next, env, b.name, s)
            }
            next = patchIface(next, b.name, () => ({
              ...(a.kv.comment !== undefined ? { description: a.kv.comment } : {}),
              ...(a.kv.disabled !== undefined ? { shutdown: yes(a.kv.disabled) } : {}),
            }))
          }
          return next
        },
      }),
    },
    {
      name: 'remove',
      help: 'Remove item',
      run: (_ctx, a) => ({
        change: (d, env) => {
          let next = d
          for (const b of pick(bonds(d), a.pos[0] ?? a.kv.numbers, byName)) next = deleteTrunk(next, env, b.name, { releaseMembers: true })
          return next
        },
      }),
    },
  ]
}

function bridgePortCmds(): RosCmd[] {
  const key = (i: IfaceView) => ({ interface: i.name, bridge: BRIDGE })
  return [
    {
      name: 'print',
      help: 'Print values of item properties',
      run: (ctx) => {
        const o = ['Flags: I - INACTIVE', 'Columns: INTERFACE, BRIDGE, HW, PVID, PRIORITY, PATH-COST, HORIZON', ` #   ${row([['INTERFACE', 15], ['BRIDGE', 9], ['HW', 5], ['PVID', 6], ['PRIORITY', 10], ['PATH-COST', 11], ['HORIZON', 0]])}`]
        bridgePorts(ctx.device).forEach((i, k) => {
          const up = netIface(ctx, i.id)?.up
          o.push(`${String(k).padStart(2)} ${up ? ' ' : 'I'} ${row([[i.name, 15], [BRIDGE, 9], ['yes', 5], [String(i.pvid ?? 1).padStart(4), 6], ['0x80', 10], ['10'.padStart(9), 11], ['none', 0]])}`)
        })
        return done(o)
      },
    },
    {
      name: 'add',
      help: 'Create a new item',
      args: ['bridge', 'interface', 'pvid', 'frame-types', 'comment', 'disabled', 'hw'],
      run: (_ctx, a) => ({
        change: (d) => {
          const i = ifaceRef(d, a.kv.interface)
          if (i.memberOf) throw new CliError('interface is a bonding slave', 'Tambahkan bond-nya ke bridge, bukan port anggotanya.')
          if (i.linkType === 'routed') {
            throw new CliError('interface has an IP address', `Hapus dulu alamat IP ${i.name} lewat /ip address remove, baru jadikan bridge port.`)
          }
          if (i.linkType !== 'none') throw new CliError('device already added as bridge port')
          const pvid = a.kv.pvid ? Number(a.kv.pvid) : 1
          return patchIface(d, i.name, () => ({ ...CLEAR_L2L3, linkType: 'access', pvid }))
        },
      }),
    },
    {
      name: 'set',
      help: 'Change item properties',
      args: ['pvid', 'comment', 'disabled', 'frame-types', 'numbers'],
      run: (_ctx, a) => ({
        change: (d) => {
          let next = d
          for (const i of pick(bridgePorts(d), a.pos[0] ?? a.kv.numbers, key)) {
            if (a.kv.pvid) next = patchIface(next, i.name, () => ({ pvid: Number(a.kv.pvid) }))
          }
          return next
        },
      }),
    },
    {
      name: 'remove',
      help: 'Remove item',
      run: (_ctx, a) => ({
        change: (d) => {
          let next = d
          for (const i of pick(bridgePorts(d), a.pos[0] ?? a.kv.numbers, key)) next = patchIface(next, i.name, () => ({ ...CLEAR_L2L3 }))
          return next
        },
      }),
    },
  ]
}

/** Terapkan daftar tagged/untagged untuk VLAN tertentu ke port-port bridge. */
function applyBridgeVlan(d: DeviceNodeData, vlans: number[], tagged: string[], untagged: string[]): DeviceNodeData {
  let next = d
  for (const n of [...tagged, ...untagged]) {
    const i = ifaceRef(next, n)
    if (!['access', 'trunk', 'hybrid'].includes(i.linkType) || i.memberOf) {
      throw new CliError(`${n} is not a bridge port`, `Tambahkan dulu: /interface bridge port add bridge=${BRIDGE} interface=${n}`)
    }
  }
  for (const n of tagged) {
    next = patchIface(next, n, (i) => ({
      linkType: i.linkType === 'access' ? 'trunk' : i.linkType,
      allowedVlans: vlanUnion(i.allowedVlans, vlans.filter((v) => v !== (i.pvid ?? 1))),
    }))
  }
  for (const n of untagged) {
    next = patchIface(next, n, (i) => {
      const extra = vlans.filter((v) => v !== (i.pvid ?? 1))
      if (!extra.length) return {}
      return { linkType: 'hybrid', untaggedVlans: vlanUnion(i.untaggedVlans, extra) }
    })
  }
  return next
}

function stripVlan(d: DeviceNodeData, v: number): DeviceNodeData {
  let next = d
  for (const i of bridgePorts(d)) {
    next = patchIface(next, i.name, (c) => {
      const allowed = vlanMinus(c.allowedVlans, [v])
      const untagged = vlanMinus(c.untaggedVlans, [v])
      const linkType = c.linkType === 'hybrid' && !untagged ? (allowed ? 'trunk' : 'access') : c.linkType === 'trunk' && !allowed ? 'access' : c.linkType
      return { allowedVlans: allowed, untaggedVlans: untagged, linkType }
    })
  }
  return next
}

function bridgeVlanCmds(): RosCmd[] {
  const key = (r: VlanRow) => ({ 'vlan-ids': String(r.vlan), bridge: BRIDGE })
  const list = (s: string | undefined) => (s ? s.split(',').filter(Boolean) : [])
  return [
    {
      name: 'print',
      help: 'Print values of item properties',
      run: (ctx) => {
        const o = ['Flags: D - DYNAMIC', 'Columns: BRIDGE, VLAN-IDS, CURRENT-TAGGED, CURRENT-UNTAGGED', `#   ${row([['BRIDGE', 9], ['VLAN-IDS', 10], ['CURRENT-TAGGED', 28], ['CURRENT-UNTAGGED', 0]])}`]
        bridgeVlans(ctx.device).forEach((r, k) => {
          o.push(`${col(String(k), 2)}${r.dynamic ? 'D' : ' '} ${row([[BRIDGE, 9], [String(r.vlan), 10], [r.tagged.join(','), 28], [r.untagged.join(','), 0]])}`)
        })
        return done(o)
      },
    },
    {
      name: 'add',
      help: 'Create a new item',
      args: ['bridge', 'vlan-ids', 'tagged', 'untagged', 'comment', 'disabled'],
      run: (_ctx, a) => {
        if (!a.kv['vlan-ids']) throw new CliError('missing value for vlan-ids')
        const vlans = parseVlanWords(a.kv['vlan-ids'])
        return { change: (d) => applyBridgeVlan(d, vlans, list(a.kv.tagged), list(a.kv.untagged)) }
      },
    },
    {
      name: 'set',
      help: 'Change item properties',
      args: ['tagged', 'untagged', 'vlan-ids', 'numbers'],
      run: (_ctx, a) => ({
        change: (d) => {
          let next = d
          for (const r of pick(bridgeVlans(d), a.pos[0] ?? a.kv.numbers, key)) {
            if (a.kv.tagged !== undefined) {
              for (const n of r.tagged) next = patchIface(next, n, (i) => ({ allowedVlans: vlanMinus(i.allowedVlans, [r.vlan]) }))
              next = applyBridgeVlan(next, [r.vlan], list(a.kv.tagged), [])
            }
            if (a.kv.untagged !== undefined) next = applyBridgeVlan(next, [r.vlan], [], list(a.kv.untagged))
          }
          return next
        },
      }),
    },
    {
      name: 'remove',
      help: 'Remove item',
      run: (_ctx, a) => ({
        change: (d) => {
          let next = d
          for (const r of pick(bridgeVlans(d), a.pos[0] ?? a.kv.numbers, key)) next = stripVlan(next, r.vlan)
          return next
        },
      }),
    },
  ]
}

function addressCmds(): RosCmd[] {
  const key = (x: { iface: string; cidr: string }) => ({ interface: x.iface, address: x.cidr })
  const remove = (d: DeviceNodeData, x: { iface: string }) =>
    x.iface === LOOPBACK ? setLoopback(d, '') : patchIface(d, x.iface, () => ({ linkType: 'none', ipAddress: '' }))
  const put = (d: DeviceNodeData, ifName: string, address: string): DeviceNodeData => {
    const c = parseCidr(address)
    if (!c) throw new CliError('invalid value for argument address')
    const cidr = hostAddress(formatIp(c.addr), c.prefix)
    if (ifName === LOOPBACK || ifName === 'loopback') return setLoopback(d, c.prefix === 32 ? formatIp(c.addr) : cidr)
    const i = ifaceRef(d, ifName)
    if (i.memberOf) throw new CliError('can not add address to bonding slave', 'Pasang alamatnya di interface bond.')
    if (['access', 'trunk', 'hybrid'].includes(i.linkType)) {
      throw new CliError('interface is a bridge port', `${i.name} masih bridge port. Hapus dulu dari /interface bridge port.`)
    }
    if (i.ipAddress && i.ipAddress !== cidr) throw new CliError('already have address on this interface', 'Simulasi hanya memodelkan satu alamat per interface; hapus alamat lama dulu.')
    checkOverlap(d, i.name, cidr)
    return patchIface(d, i.name, () => ({ linkType: 'routed', ipAddress: cidr }))
  }
  return [
    {
      name: 'print',
      help: 'Print values of item properties',
      run: (ctx) => {
        const o = ['Flags: X - DISABLED; I - INVALID; D - DYNAMIC', 'Columns: ADDRESS, NETWORK, INTERFACE', `#   ${row([['ADDRESS', 19], ['NETWORK', 16], ['INTERFACE', 0]])}`]
        addresses(ctx.device).forEach((x, k) => {
          const c = parseCidr(x.cidr)!
          o.push(`${col(String(k), 4)}${row([[x.cidr, 19], [formatIp(networkOf(c)), 16], [x.iface, 0]])}`)
        })
        return done(o)
      },
    },
    {
      name: 'add',
      help: 'Create a new item',
      args: ['address', 'interface', 'network', 'comment', 'disabled'],
      run: (_ctx, a) => {
        if (!a.kv.address || !a.kv.interface) throw new CliError(`missing value for ${a.kv.address ? 'interface' : 'address'}`)
        return { change: (d) => put(d, a.kv.interface!, a.kv.address!) }
      },
    },
    {
      name: 'set',
      help: 'Change item properties',
      args: ['address', 'interface', 'numbers'],
      run: (_ctx, a) => ({
        change: (d) => {
          let next = d
          for (const x of pick(addresses(d), a.pos[0] ?? a.kv.numbers, key)) {
            next = remove(next, x)
            next = put(next, a.kv.interface ?? x.iface, a.kv.address ?? x.cidr)
          }
          return next
        },
      }),
    },
    {
      name: 'remove',
      help: 'Remove item',
      run: (_ctx, a) => ({
        change: (d) => {
          let next = d
          for (const x of pick(addresses(d), a.pos[0] ?? a.kv.numbers, key)) next = remove(next, x)
          return next
        },
      }),
    },
  ]
}

function routeCmds(): RosCmd[] {
  const key = (r: { prefix: string; nextHop: string }) => ({ 'dst-address': r.prefix, gateway: r.nextHop })
  return [
    {
      name: 'print',
      help: 'Print values of item properties',
      run: (ctx) => {
        const dev = ctx.net().devices.get(ctx.env.deviceId)
        const live = dev ? routesOf(dev) : []
        const o = ['Flags: D - DYNAMIC; A - ACTIVE; c - CONNECT, s - STATIC', 'Columns: DST-ADDRESS, GATEWAY, DISTANCE', `#     ${row([['DST-ADDRESS', 19], ['GATEWAY', 16], ['DISTANCE', 0]])}`]
        ctx.device.staticRoutes.forEach((r, k) => {
          const active = live.some((x) => x.proto === 'static' && formatCidr(x.dest) === r.prefix && formatIp(x.nextHop!) === r.nextHop)
          o.push(`${col(String(k), 3)}${col(active ? 'As' : ' s', 3)}${row([[r.prefix, 19], [r.nextHop, 16], ['1'.padStart(8), 0]])}`)
        })
        for (const r of live.filter((x) => x.proto === 'direct')) {
          const name = r.iface.kind === 'loopback' ? LOOPBACK : r.iface.name
          o.push(`   DAc${row([[formatCidr(r.dest), 19], [name, 16], ['0'.padStart(8), 0]])}`)
        }
        return done(o)
      },
    },
    {
      name: 'add',
      help: 'Create a new item',
      args: ['dst-address', 'gateway', 'distance', 'comment', 'disabled'],
      run: (_ctx, a) => {
        if (!a.kv.gateway) throw new CliError('missing value for gateway')
        const c = parseCidr(a.kv['dst-address'] ?? '0.0.0.0/0')
        if (!c) throw new CliError('invalid value for argument dst-address')
        return { change: (d) => addRoute(d, formatIp(c.addr), c.prefix, a.kv.gateway!) }
      },
    },
    {
      name: 'remove',
      help: 'Remove item',
      run: (_ctx, a) => ({
        change: (d) => {
          let next = d
          for (const r of pick(d.staticRoutes, a.pos[0] ?? a.kv.numbers, key)) {
            const c = parseCidr(r.prefix)!
            next = removeRoute(next, formatIp(c.addr), c.prefix, r.nextHop)
          }
          return next
        },
      }),
    },
  ]
}

function rosPing(ctx: Ctx, a: RosArgs): ExecResult {
  const dst = a.pos[0] ?? a.kv.address
  if (!dst) throw new CliError('missing value for address')
  const count = a.kv.count ? Number(a.kv.count) : 5
  const run = simulatePing(ctx, dst, count, a.kv['src-address'])
  const s = stats(run.replies)
  const t = (v: number) => `${Math.floor(v)}ms${Math.round((v % 1) * 1000)}us`
  return {
    out: [out(`  ${row([['SEQ', 4], ['HOST', 41], ['SIZE', 5], ['TTL', 4], ['TIME', 11], ['STATUS', 0]])}`)],
    stream: {
      lines: [
        ...run.replies.map((r, k) =>
          out(r === null ? `  ${row([[String(k).padStart(3), 4], [dst, 41], ['', 5], ['', 4], ['', 11], [run.noRoute ? 'no route to host' : 'timeout', 0]])}` : `  ${row([[String(k).padStart(3), 4], [dst, 41], ['56'.padStart(4), 5], [String(run.ttl).padStart(3), 4], [t(r), 0]])}`),
        ),
        out(`    sent=${s.sent} received=${s.got} packet-loss=${Math.round(s.loss)}%${s.got ? ` min-rtt=${t(s.min)} avg-rtt=${t(s.avg)} max-rtt=${t(s.max)}` : ''}`),
        ...(s.got ? [] : pingHint(run)),
      ],
      interval: s.got ? 300 : 700,
    },
  }
}

function rosTrace(ctx: Ctx, a: RosArgs): ExecResult {
  const dst = a.pos[0] ?? a.kv.address
  if (!dst) throw new CliError('missing value for address')
  const tr = simulateTrace(ctx, dst)
  const rows: OutLine[] = tr.hops.map((h, k) => {
    const b = ((k + 1) * 0.7).toFixed(1)
    return out(
      h.ip === null
        ? `${col(String(k + 1), 3)}${row([['', 16], ['100%', 6], ['3', 6], ['timeout', 0]])}`
        : `${col(String(k + 1), 3)}${row([[formatIp(h.ip), 16], ['0%', 6], ['3', 6], [`${b}ms`, 8], [b, 6], [b, 6], [b, 7], ['0', 0]])}`,
    )
  })
  if (!tr.reached) {
    for (let k = tr.hops.length; k < tr.hops.length + 3; k += 1) rows.push(out(`${col(String(k + 1), 3)}${row([['', 16], ['100%', 6], ['3', 6], ['timeout', 0]])}`))
    rows.push(hint(TRACE_STOP))
  }
  return {
    out: [out('Columns: ADDRESS, LOSS, SENT, LAST, AVG, BEST, WORST, STD-DEV'), out(`#  ${row([['ADDRESS', 16], ['LOSS', 6], ['SENT', 6], ['LAST', 8], ['AVG', 6], ['BEST', 6], ['WORST', 7], ['STD-DEV', 0]])}`)],
    stream: { lines: rows, interval: 400 },
  }
}

function exportCmd(section?: string): RosCmd {
  return { name: 'export', help: 'Print or save an export script', args: ['compact', 'verbose', 'file'], run: (ctx) => done(exportLines(ctx, section)) }
}

/* ── Pohon menu ──────────────────────────────────────────────────────────── */

const MENU: RosMenu = {
  name: '',
  help: '',
  cmds: [
    { name: 'ping', help: 'Send ICMP Echo packets', args: ['address', 'count', 'src-address', 'interval'], run: rosPing },
    { name: 'quit', help: 'Quit console', run: () => ({ logout: true, out: [out('interrupted')] }) },
    exportCmd(),
  ],
  menus: [
    {
      name: 'interface',
      help: 'Interface configuration',
      cmds: [
        { name: 'print', help: 'Print values of item properties', run: (ctx) => done(interfacePrint(ctx, ifaceList(ctx.device))) },
        { name: 'set', help: 'Change item properties', args: ['comment', 'disabled', 'numbers'], run: (_c, a) => setIfaceProps(a, byName, ifaceList) },
        toggle(ifaceList, true),
        toggle(ifaceList, false),
        exportCmd('/interface'),
      ],
      menus: [
        {
          name: 'ethernet',
          help: 'Ethernet interfaces',
          cmds: [
            { name: 'print', help: 'Print values of item properties', run: (ctx) => done(interfacePrint(ctx, ports(ctx.device))) },
            { name: 'set', help: 'Change item properties', args: ['comment', 'disabled', 'numbers', 'speed', 'auto-negotiation'], run: (_c, a) => setIfaceProps(a, byName, ports) },
            toggle(ports, true),
            toggle(ports, false),
            exportCmd('/interface ethernet'),
          ],
        },
        { name: 'bonding', help: 'Bonding interfaces', cmds: [...bondingCmds(), exportCmd('/interface bonding')] },
        {
          name: 'bridge',
          help: 'Bridge interfaces',
          cmds: [
            {
              name: 'print',
              help: 'Print values of item properties',
              run: (ctx) =>
                done(['Flags: X - DISABLED; R - RUNNING', 'Columns: NAME, MTU, MAC-ADDRESS, PROTOCOL-MODE, VLAN-FILTERING', ...(bridgePorts(ctx.device).length ? [` 0 R ${BRIDGE}  1500  ${rosMac(ctx, 90)}  rstp  yes`] : [])]),
            },
            { name: 'add', help: 'Create a new item', args: ['name', 'vlan-filtering', 'protocol-mode', 'comment'], run: (_c, a) => (a.kv.name && a.kv.name !== BRIDGE ? { out: [hint(`Simulasi memodelkan satu bridge (${BRIDGE}); nama lain diperlakukan sama.`)] } : done()) },
            exportCmd('/interface bridge'),
          ],
          menus: [
            { name: 'port', help: 'Bridge port settings', cmds: [...bridgePortCmds(), exportCmd('/interface bridge port')] },
            { name: 'vlan', help: 'Bridge VLAN table', cmds: [...bridgeVlanCmds(), exportCmd('/interface bridge vlan')] },
          ],
        },
      ],
    },
    {
      name: 'ip',
      help: 'IP options',
      menus: [
        { name: 'address', help: 'Address management', cmds: [...addressCmds(), exportCmd('/ip address')] },
        { name: 'route', help: 'Route management', cmds: [...routeCmds(), exportCmd('/ip route')] },
        {
          name: 'neighbor',
          help: 'Neighbor discovery',
          cmds: [
            {
              name: 'print',
              help: 'Print values of item properties',
              run: (ctx) =>
                done([
                  'Columns: INTERFACE, ADDRESS, MAC-ADDRESS, IDENTITY, PLATFORM, BOARD',
                  `#  ${row([['INTERFACE', 15], ['ADDRESS', 15], ['MAC-ADDRESS', 19], ['IDENTITY', 18], ['PLATFORM', 10], ['BOARD', 0]])}`,
                  ...neighbors(ctx).map((n, k) =>
                    `${col(String(k), 3)}${row([[n.local, 15], [n.mgmtIp, 15], [macOf(n.host, 0).toUpperCase(), 19], [n.host, 18], [platformOf(n.peerDevice), 10], [n.model, 0]])}`,
                  ),
                ]),
            },
          ],
        },
      ],
    },
    {
      name: 'system',
      help: 'System information and utilities',
      menus: [
        {
          name: 'identity',
          help: 'System identity',
          cmds: [
            { name: 'print', help: 'Print values of item properties', run: (ctx) => done([`  name: ${ctx.device.hostname}`]) },
            { name: 'set', help: 'Change item properties', args: ['name'], run: (_c, a) => ({ change: (d) => setHostname(d, a.kv.name ?? '') }) },
            exportCmd('/system identity'),
          ],
        },
        {
          name: 'resource',
          help: 'System resources',
          cmds: [
            {
              name: 'print',
              help: 'Print values of item properties',
              run: (ctx) => {
                const u = uptime()
                return done([
                  `                   uptime: ${u.weeks ? `${u.weeks}w` : ''}${u.days ? `${u.days}d` : ''}${u.hours}h${u.minutes}m${u.seconds}s`,
                  '                  version: 7.16.1 (stable)',
                  `               board-name: ${modelName(ctx)}`,
                  '                 platform: MikroTik',
                  '             architecture: arm64',
                  '                cpu-count: 4',
                  '                 cpu-load: 1%',
                ])
              },
            },
          ],
        },
      ],
    },
    { name: 'tool', help: 'Diagnostics tools', cmds: [{ name: 'traceroute', help: 'Traceroute', args: ['address', 'count', 'src-address'], run: rosTrace }] },
  ],
}

function platformOf(d: DeviceNodeData): string {
  return isL3Device(d) ? 'router' : 'switch'
}

/* ── Parser ──────────────────────────────────────────────────────────────── */

function menuAt(path: string[]): RosMenu {
  let m = MENU
  for (const p of path) m = m.menus?.find((x) => x.name === p) ?? m
  return m
}

/** Cocokkan awalan unik; kata yang persis selalu menang. */
function prefixPick(word: string, names: string[]): string | 'ambiguous' | null {
  if (names.includes(word)) return word
  const hits = names.filter((n) => n.startsWith(word))
  if (hits.length === 1) return hits[0]!
  return hits.length > 1 ? 'ambiguous' : null
}

interface Parsed {
  path: string[]
  cmd: RosCmd | null
  args: Token[]
  error?: { text: string; col: number; hint?: string }
}

/** Pecah `/ip/address` dan `..` menjadi langkah-langkah menu. */
function steps(tokens: Token[]): Token[] {
  const out: Token[] = []
  for (const t of tokens) {
    if (t.text.includes('=') || t.text.startsWith('[')) {
      out.push(t)
      continue
    }
    if (t.text.startsWith('/') && t.text.length > 1) {
      out.push({ text: '/', start: t.start })
      let off = 1
      for (const part of t.text.slice(1).split('/')) {
        if (part) out.push({ text: part, start: t.start + off })
        off += part.length + 1
      }
      continue
    }
    out.push(t)
  }
  return out
}

function parse(state: string[], line: string): Parsed {
  const toks = steps(tokenize(line, { brackets: true }))
  let path = [...state]
  let i = 0
  while (i < toks.length) {
    const t = toks[i]!
    if (t.text === '/') {
      path = []
      i += 1
      continue
    }
    if (t.text === '..') {
      path = path.slice(0, -1)
      i += 1
      continue
    }
    const m = menuAt(path)
    const menus = (m.menus ?? []).map((x) => x.name)
    const cmds = (m.cmds ?? []).map((x) => x.name)
    const hit = prefixPick(t.text, [...menus, ...cmds])
    if (hit === 'ambiguous') return { path, cmd: null, args: [], error: { text: `ambiguous value of command name ${t.text} (line 1 column ${t.start + 1})`, col: t.start } }
    if (hit === null) {
      const rootCmd = path.length > 0 && (MENU.cmds ?? []).some((c) => c.name.startsWith(t.text))
      return {
        path,
        cmd: null,
        args: [],
        error: {
          text: `bad command name ${t.text} (line 1 column ${t.start + 1})`,
          col: t.start,
          hint: rootCmd ? `Perintah root diawali garis miring: /${t.text} …` : undefined,
        },
      }
    }
    if (menus.includes(hit)) {
      path = [...path, hit]
      i += 1
      continue
    }
    return { path, cmd: m.cmds!.find((c) => c.name === hit)!, args: toks.slice(i + 1) }
  }
  return { path, cmd: null, args: [] }
}

function parseArgs(cmd: RosCmd, toks: Token[]): RosArgs {
  const a: RosArgs = { pos: [], kv: {} }
  const names = cmd.args ?? []
  for (const t of toks) {
    const eq = t.text.indexOf('=')
    if (eq <= 0) {
      a.pos.push(t.text)
      continue
    }
    const k = t.text.slice(0, eq)
    const v = t.text.slice(eq + 1)
    const name = names.length ? prefixPick(k, names) : k
    if (name === null || name === 'ambiguous') {
      throw new CliError(`expected end of command (line 1 column ${t.start + 1})`, names.length ? `Argumen yang dikenal: ${names.join(', ')}` : undefined)
    }
    a.kv[name] = v
  }
  return a
}

function prompt(ctx: Ctx): string {
  const where = ctx.state.path.length ? ` /${ctx.state.path.join(' ')}` : ' '
  return `[admin@${ctx.device.hostname}]${where}> `
}

function exec(ctx: Ctx, line: string): ExecResult {
  const p = parse(ctx.state.path, line)
  if (p.error) return { out: [{ text: p.error.text, kind: 'err' }, ...(p.error.hint ? [hint(p.error.hint)] : [])] }
  if (!p.cmd) return { state: { path: p.path } }
  try {
    return p.cmd.run(ctx, parseArgs(p.cmd, p.args))
  } catch (e) {
    if (e instanceof CliError) return { out: errorLines(routeros, e) }
    throw e
  }
}

function help(ctx: Ctx, line: string): OutLine[] {
  const trailing = line.length === 0 || /\s$/.test(line)
  const p = parse(ctx.state.path, trailing ? line : line.replace(/\S+$/, ''))
  if (p.error) return [{ text: p.error.text, kind: 'err' }]
  const word = trailing ? '' : (/\S+$/.exec(line)?.[0] ?? '')
  if (p.cmd) {
    return [out(p.cmd.help), ...(p.cmd.args ?? []).filter((n) => n.startsWith(word)).map((n) => out(`${n.padEnd(20)}--`))]
  }
  const m = menuAt(p.path)
  const items = [
    ...(p.path.length ? [{ name: '..', help: 'go up to ' + (p.path.length > 1 ? p.path.at(-2) : 'root') }] : []),
    ...(m.menus ?? []).map((x) => ({ name: x.name, help: x.help })),
    ...(m.cmds ?? []).map((x) => ({ name: x.name, help: x.help })),
  ].filter((x) => x.name.startsWith(word))
  return items.map((x) => out(`${x.name.padEnd(20)}-- ${x.help}`))
}

function complete(ctx: Ctx, line: string): { line: string; out?: OutLine[] } {
  if (line.length === 0 || /\s$/.test(line)) return { line }
  const word = /\S+$/.exec(line)![0]
  const head = line.slice(0, line.length - word.length)
  const p = parse(ctx.state.path, head)
  if (p.error) return { line }
  let words: string[]
  let prefix = ''
  let typed = word
  if (p.cmd) {
    const eq = word.indexOf('=')
    const ifaces = [...ifaceList(ctx.device).map((i) => i.name), LOOPBACK]
    if (eq > 0) {
      const key = word.slice(0, eq)
      prefix = word.slice(0, eq + 1)
      typed = word.slice(eq + 1).split(',').pop() ?? ''
      prefix = word.slice(0, word.length - typed.length)
      words = ['interface', 'slaves', 'tagged', 'untagged'].includes(key) ? ifaces : []
    } else {
      words = [...(p.cmd.args ?? []).map((n) => `${n}=`), ...ifaces]
    }
  } else {
    const slash = word.startsWith('/') ? '/' : ''
    const parts = word.slice(slash.length).split('/')
    typed = parts.pop() ?? ''
    prefix = `${slash}${parts.map((x) => `${x}/`).join('')}`
    const m = menuAt(slash ? parts : [...p.path, ...parts])
    words = [...(m.menus ?? []).map((x) => x.name), ...(m.cmds ?? []).map((x) => x.name)]
  }
  const hits = words.filter((w) => w.startsWith(typed))
  if (hits.length === 1) return { line: `${head}${prefix}${hits[0]}${hits[0]!.endsWith('=') ? '' : ' '}` }
  if (hits.length > 1) {
    let common = hits[0]!
    for (const h of hits) while (!h.startsWith(common)) common = common.slice(0, -1)
    if (common.length > typed.length) return { line: `${head}${prefix}${common}` }
    return { line, out: [out(hits.join('  '))] }
  }
  return { line }
}

const LOGO = [
  '',
  '',
  '  MMM      MMM       KKK                          TTTTTTTTTTT      KKK',
  '  MMMM    MMMM       KKK                          TTTTTTTTTTT      KKK',
  '  MMM MMMM MMM  III  KKK  KKK  RRRRRR     OOOOOO      TTT     III  KKK  KKK',
  '  MMM  MM  MMM  III  KKKKK     RRR  RRR  OOO  OOO     TTT     III  KKKKK',
  '  MMM      MMM  III  KKK KKK   RRRRRR    OOO  OOO     TTT     III  KKK KKK',
  '  MMM      MMM  III  KKK  KKK  RRR  RRR   OOOOOO      TTT     III  KKK  KKK',
  '',
  '  MikroTik RouterOS 7.16.1 (c) 1999-2024       https://www.mikrotik.com/',
  '',
]

export const routeros: Dialect = {
  id: 'routeros',
  errorPrefix: 'failure: ',
  init: () => ({ mode: 'root', path: [], pending: [], vars: {} }),
  banner: () => [
    ...LOGO.map(out),
    hint('Simulasi CLI RouterOS 7 — menu diawali `/` (mis. /ip address print). Ketik ? untuk bantuan, Tab untuk melengkapi. VLAN memakai satu bridge: bridge1.'),
    out(''),
  ],
  prompt,
  twoStage: () => false,
  exec,
  help,
  complete,
}
