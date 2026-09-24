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
  return usageFromHandles(handles, trunks)
}

const handleIndex = new WeakMap<AppEdge[], Map<string, string>>()

/**
 * Handle terpakai milik satu perangkat sebagai string terurut — nilai primitif,
 * jadi selector zustand hanya memicu render ulang node yang handle-nya berubah.
 * Indeks seluruh perangkat dibangun sekali per array edges, bukan sekali per node.
 */
export function usedHandleKey(deviceId: string, edges: AppEdge[]): string {
  let index = handleIndex.get(edges)
  if (!index) {
    const sets = new Map<string, Set<string>>()
    const add = (device: string, handle: string | null | undefined) => {
      if (!handle) return
      let set = sets.get(device)
      if (!set) sets.set(device, (set = new Set()))
      set.add(handle)
    }
    for (const e of edges) {
      add(e.source, e.sourceHandle)
      add(e.target, e.targetHandle)
    }
    index = new Map([...sets].map(([device, set]) => [device, [...set].sort().join('\n')]))
    handleIndex.set(edges, index)
  }
  return index.get(deviceId) ?? ''
}

/** Kebalikan usedHandleKey: kembalikan jadi DeviceUsage. */
export function usageFromKey(key: string, trunks: Trunk[]): DeviceUsage {
  return usageFromHandles(new Set(key ? key.split('\n') : []), trunks)
}

function usageFromHandles(handles: Set<string>, trunks: Trunk[]): DeviceUsage {
  const ports = new Set<string>()
  for (const handle of handles) {
    const trunk = trunks.find((t) => t.id === handle)
    if (trunk) for (const member of trunk.memberIds) ports.add(member)
    else ports.add(handle)
  }

  return { handles, ports }
}
