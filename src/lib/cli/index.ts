import type { DeviceModel } from '@/data/deviceCatalog'
import type { DeviceRole } from '@/types/topology'
import type { DialectId } from './types'

/**
 * Pintu masuk ringan untuk CLI. Mesin dan kelima dialeknya cukup besar, jadi
 * dipisah dari bundel utama dan baru diunduh saat konsol pertama kali dibuka
 * (`loadCli`). Fungsi di sini hanya memutuskan dialek tanpa memuat kodenya.
 */

/** Perangkat yang tidak punya CLI: kabel pasif, awan upstream, media converter. */
const NO_CLI = new Set<DeviceRole>(['passive', 'internet', 'converter'])

export const DIALECT_LABEL: Record<DialectId, string> = {
  vrp: 'Huawei VRP',
  ios: 'Cisco IOS',
  junos: 'Juniper Junos',
  routeros: 'MikroTik RouterOS',
  linux: 'Linux',
}

/** Dialek CLI sebuah perangkat; null berarti perangkat ini tidak punya CLI. */
export function dialectIdFor(model: DeviceModel | undefined, role: DeviceRole): DialectId | null {
  if (NO_CLI.has(role)) return null
  switch (model?.os) {
    case 'vrp':
    case 'junos':
    case 'routeros':
    case 'ios':
      return model.os
  }
  // Vendor lain (ZTE, TP-Link, BDCOM, …) CLI-nya mirip Cisco; server dan CPE memakai shell Linux.
  return role === 'server' || role === 'cpe' ? 'linux' : 'ios'
}

export const loadCli = () => import('./runtime')
export type CliRuntime = Awaited<ReturnType<typeof loadCli>>
