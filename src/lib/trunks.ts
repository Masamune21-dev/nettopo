import type { DeviceModel } from '@/data/deviceCatalog'
import type { Port, Speed, Trunk } from '@/types/topology'

/** Penamaan interface agregasi mengikuti OS perangkatnya. */
const NAMING: Record<DeviceModel['os'], { prefix: string; start: number }> = {
  vrp: { prefix: 'Eth-Trunk', start: 1 }, // Huawei
  junos: { prefix: 'ae', start: 0 }, // Juniper
  routeros: { prefix: 'bond', start: 1 }, // MikroTik
  other: { prefix: 'lag', start: 1 },
}

export function trunkPrefix(os: DeviceModel['os'] | undefined): string {
  return NAMING[os ?? 'other'].prefix
}

/** Nama trunk berikutnya yang belum dipakai: Eth-Trunk1, ae0, bond1, … */
export function nextTrunkName(os: DeviceModel['os'] | undefined, trunks: Trunk[]): string {
  const { prefix, start } = NAMING[os ?? 'other']
  const used = new Set(trunks.map((t) => t.name))
  let i = start
  while (used.has(`${prefix}${i}`)) i += 1
  return `${prefix}${i}`
}

const GBPS: Record<Speed, number> = {
  '100M': 0.1,
  '1G': 1,
  '2.5G': 2.5,
  '10G': 10,
  '25G': 25,
  '40G': 40,
  '100G': 100,
  '400G': 400,
}

export const speedToGbps = (s: Speed): number => GBPS[s]

/** 0.3 → "300M", 20 → "20G", 2.5 → "2.5G" */
export function formatBandwidth(gbps: number): string {
  if (gbps <= 0) return '0'
  if (gbps < 1) return `${Math.round(gbps * 1000)}M`
  return `${Number(gbps.toFixed(1)).toString().replace(/\.0$/, '')}G`
}

export interface TrunkSummary {
  count: number
  /** Kecepatan tiap anggota; null bila anggotanya campur-campur. */
  memberSpeed: Speed | null
  totalGbps: number
  /** "2× 10G" atau "campuran" */
  composition: string
  /** "2× 10G = 20G" */
  label: string
}

export function summarizeTrunk(trunk: Trunk, ports: Port[]): TrunkSummary {
  const byId = new Map(ports.map((p) => [p.id, p]))
  const members = trunk.memberIds.map((id) => byId.get(id)).filter((p): p is Port => Boolean(p))
  const speeds = new Set(members.map((p) => p.speed))
  const memberSpeed = speeds.size === 1 ? [...speeds][0]! : null
  const totalGbps = members.reduce((sum, p) => sum + speedToGbps(p.speed), 0)
  const composition = memberSpeed ? `${members.length}× ${memberSpeed}` : `${members.length} port campuran`
  return {
    count: members.length,
    memberSpeed,
    totalGbps,
    composition,
    label: `${composition} = ${formatBandwidth(totalGbps)}`,
  }
}

/** Trunk mana yang memiliki port ini — dipakai untuk menyembunyikan anggota dari daftar port. */
export function trunkOfPort(trunks: Trunk[], portId: string): Trunk | undefined {
  return trunks.find((t) => t.memberIds.includes(portId))
}

export function isTrunkMember(trunks: Trunk[], portId: string): boolean {
  return trunks.some((t) => t.memberIds.includes(portId))
}
