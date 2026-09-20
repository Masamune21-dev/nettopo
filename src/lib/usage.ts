import type { AppEdge } from '@/store/types'
import type { Trunk } from '@/types/topology'

export interface DeviceUsage {
  /** Handle yang punya link: bisa id port fisik, bisa id trunk. */
  handles: Set<string>
  /** Port fisik yang benar-benar terpakai — termasuk anggota trunk yang punya link. */
  ports: Set<string>
}

/**
 * Port anggota sebuah trunk tidak punya link sendiri, tetapi tetap terpakai
 * secara fisik. Tanpa pembedaan ini hitungan "x terpakai" jadi menyesatkan.
 */
export function deviceUsage(deviceId: string, trunks: Trunk[], edges: AppEdge[]): DeviceUsage {
  const handles = new Set<string>()
  for (const e of edges) {
    if (e.source === deviceId && e.sourceHandle) handles.add(e.sourceHandle)
    if (e.target === deviceId && e.targetHandle) handles.add(e.targetHandle)
  }

  const ports = new Set<string>()
  for (const handle of handles) {
    const trunk = trunks.find((t) => t.id === handle)
    if (trunk) for (const member of trunk.memberIds) ports.add(member)
    else ports.add(handle)
  }

  return { handles, ports }
}
