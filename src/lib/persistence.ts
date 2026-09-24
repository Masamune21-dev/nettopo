import type { Topology } from '@/types/topology'
import { parseTopology } from './serialize'

const LIST_KEY = 'nettopo:projects'
const LAST_KEY = 'nettopo:last'
const docKey = (id: string) => `nettopo:project:${id}`

export interface ProjectListItem {
  id: string
  name: string
  site: string
  updatedAt: string
  devices: number
  links: number
}

function safeGet(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function safeSet(key: string, value: string): boolean {
  try {
    localStorage.setItem(key, value)
    return true
  } catch {
    return false
  }
}

export function listProjects(): ProjectListItem[] {
  const raw = safeGet(LIST_KEY)
  if (!raw) return []
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    // Entri rusak (null, tanpa id) dibuang supaya daftar tetap bisa dipakai.
    return parsed.filter(
      (p): p is ProjectListItem => typeof p === 'object' && p !== null && typeof p.id === 'string',
    )
  } catch {
    return []
  }
}

export function saveProject(topo: Topology): boolean {
  const ok = safeSet(docKey(topo.project.id), JSON.stringify(topo))
  if (!ok) return false
  const item: ProjectListItem = {
    id: topo.project.id,
    name: topo.project.name,
    site: topo.project.site,
    updatedAt: topo.project.updatedAt,
    devices: topo.devices.length,
    links: topo.links.length,
  }
  const rest = listProjects().filter((p) => p.id !== item.id)
  safeSet(LIST_KEY, JSON.stringify([item, ...rest]))
  safeSet(LAST_KEY, topo.project.id)
  return true
}

export function loadProject(id: string): Topology | null {
  const raw = safeGet(docKey(id))
  if (!raw) return null
  const parsed = parseTopology(raw)
  return parsed.ok ? parsed.data : null
}

export function deleteProject(id: string): void {
  try {
    localStorage.removeItem(docKey(id))
  } catch {
    /* abaikan */
  }
  safeSet(LIST_KEY, JSON.stringify(listProjects().filter((p) => p.id !== id)))
  if (safeGet(LAST_KEY) === id) {
    try {
      localStorage.removeItem(LAST_KEY)
    } catch {
      /* abaikan */
    }
  }
}

export function lastProjectId(): string | null {
  return safeGet(LAST_KEY)
}
