import { formatIp } from '@/lib/ip'
import type { DeviceNodeData } from '@/store/types'
import { type Net, type NetIface, peerOf } from './net'
import type { Ctx } from './types'

/** Waktu sejak halaman dibuka — dipakai sebagai "uptime" perangkat. */
export function uptime(): { weeks: number; days: number; hours: number; minutes: number; seconds: number } {
  const s = Math.floor((typeof performance !== 'undefined' ? performance.now() : 0) / 1000)
  return {
    weeks: Math.floor(s / 604800),
    days: Math.floor(s / 86400) % 7,
    hours: Math.floor(s / 3600) % 24,
    minutes: Math.floor(s / 60) % 60,
    seconds: s % 60,
  }
}

export function modelName(ctx: Ctx): string {
  return ctx.env.model?.model ?? ctx.device.modelId
}

export interface Neighbor {
  /** Nama interface lokal (port anggota bila link-nya di trunk). */
  local: string
  host: string
  remote: string
  mgmtIp: string
  model: string
  peerDevice: DeviceNodeData
}

/**
 * Tetangga LLDP/CDP: satu baris per kabel fisik. Kabel yang ditarik antar
 * trunk diuraikan ke pasangan port anggotanya, karena LLDP berjalan per port.
 */
export function neighbors(ctx: Ctx): Neighbor[] {
  const net = ctx.net()
  const me = net.devices.get(ctx.env.deviceId)
  if (!me) return []
  const out: Neighbor[] = []
  for (const i of me.ifaces) {
    if (!i.up || i.memberOf || i.kind === 'loopback') continue
    const p = peerOf(net, i)
    const peerDev = p ? net.devices.get(p.deviceId) : undefined
    if (!p || !peerDev || peerDev.transparent) continue
    const base = { host: peerDev.data.hostname, mgmtIp: peerDev.data.mgmtIp, model: peerDev.model?.model ?? '', peerDevice: peerDev.data }
    if (i.kind === 'trunk') {
      const mine = membersOf(net, i)
      const theirs = p.kind === 'trunk' ? membersOf(net, p) : [p]
      mine.forEach((m, idx) => out.push({ ...base, local: m.name, remote: theirs[idx]?.name ?? p.name }))
    } else {
      const theirs = p.kind === 'trunk' ? membersOf(net, p) : [p]
      out.push({ ...base, local: i.name, remote: theirs[0]?.name ?? p.name })
    }
  }
  return out
}

function membersOf(net: Net, trunk: NetIface): NetIface[] {
  const dev = net.devices.get(trunk.deviceId)
  return dev ? dev.ifaces.filter((x) => x.memberOf === trunk.id && !x.cfg.shutdown) : []
}

export function netIface(ctx: Ctx, id: string): NetIface | undefined {
  return ctx.net().devices.get(ctx.env.deviceId)?.byId.get(id)
}

/** Tetangga L3 yang terjangkau ARP dari tiap interface routed — bahan `display arp`. */
export function arpEntries(ctx: Ctx, l2: (n: Net, i: NetIface) => NetIface[]): { ip: string; mac: string; iface: string; local: boolean }[] {
  const net = ctx.net()
  const me = net.devices.get(ctx.env.deviceId)
  if (!me) return []
  const out: { ip: string; mac: string; iface: string; local: boolean }[] = []
  for (const i of me.ifaces) {
    if (!i.addr || i.kind === 'loopback' || !i.up) continue
    out.push({ ip: formatIp(i.addr.addr), mac: '', iface: i.name, local: true })
    for (const n of l2(net, i)) {
      if (!n.addr) continue
      out.push({ ip: formatIp(n.addr.addr), mac: n.deviceId, iface: i.name, local: false })
    }
  }
  return out
}
