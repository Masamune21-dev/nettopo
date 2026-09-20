import type { AppEdge, AppNode, DeviceNodeData } from '@/store/types'
import { isDeviceNode, isGroupNode, isNoteNode } from '@/store/types'
import {
  SCHEMA_VERSION,
  type Topology,
  topologySchema,
} from '@/types/topology'

export interface ProjectMeta {
  projectId: string
  projectName: string
  site: string
}

/**
 * Sebuah handle React Flow bisa berupa port fisik atau trunk. Saat diekspor
 * keduanya dibedakan supaya file JSON tetap bisa dibaca sendiri.
 */
function endpoint(nodes: AppNode[], deviceId: string, handleId: string | null | undefined) {
  const id = handleId ?? ''
  const device = nodes.filter(isDeviceNode).find((n) => n.id === deviceId)
  const isTrunk = device?.data.trunks.some((t) => t.id === id) ?? false
  return isTrunk
    ? { deviceId, portId: '', trunkId: id }
    : { deviceId, portId: id, trunkId: null }
}

const sizeOf = (n: AppNode, fw: number, fh: number) => ({
  width: n.width ?? n.measured?.width ?? fw,
  height: n.height ?? n.measured?.height ?? fh,
})

/** State kanvas → dokumen JSON portabel. */
export function toTopology(
  meta: ProjectMeta,
  nodes: AppNode[],
  edges: AppEdge[],
): Topology {
  return {
    schemaVersion: SCHEMA_VERSION,
    project: {
      id: meta.projectId,
      name: meta.projectName,
      site: meta.site,
      updatedAt: new Date().toISOString(),
    },
    devices: nodes.filter(isDeviceNode).map((n) => ({
      id: n.id,
      modelId: n.data.modelId,
      hostname: n.data.hostname,
      role: n.data.role,
      mgmtIp: n.data.mgmtIp,
      loopback: n.data.loopback,
      site: n.data.site,
      notes: n.data.notes,
      position: { x: Math.round(n.position.x), y: Math.round(n.position.y) },
      ports: n.data.ports,
      trunks: n.data.trunks,
      expanded: n.data.expanded,
      parentId: n.parentId ?? null,
    })),
    links: edges.map((e) => ({
      id: e.id,
      a: endpoint(nodes, e.source, e.sourceHandle),
      b: endpoint(nodes, e.target, e.targetHandle),
      speed: e.data?.speed ?? '1G',
      media: e.data?.media ?? 'fiber',
      kind: e.data?.kind ?? 'single',
      label: e.data?.label ?? '',
      vlans: e.data?.vlans ?? '',
      color: e.data?.color ?? null,
    })),
    groups: nodes.filter(isGroupNode).map((n) => ({
      id: n.id,
      label: n.data.label,
      color: n.data.color,
      position: { x: Math.round(n.position.x), y: Math.round(n.position.y) },
      size: sizeOf(n, 460, 320),
    })),
    notes: nodes.filter(isNoteNode).map((n) => ({
      id: n.id,
      text: n.data.text,
      color: n.data.color,
      position: { x: Math.round(n.position.x), y: Math.round(n.position.y) },
      size: sizeOf(n, 220, 130),
    })),
  }
}

/** Dokumen JSON → state kanvas. */
export function fromTopology(t: Topology): {
  nodes: AppNode[]
  edges: AppEdge[]
  meta: ProjectMeta
} {
  const groups: AppNode[] = t.groups.map((g) => ({
    id: g.id,
    type: 'group',
    position: g.position,
    width: g.size.width,
    height: g.size.height,
    zIndex: -1,
    data: { label: g.label, color: g.color },
  }))

  const devices: AppNode[] = t.devices.map((d) => {
    const data: DeviceNodeData = {
      modelId: d.modelId,
      hostname: d.hostname,
      role: d.role,
      mgmtIp: d.mgmtIp,
      loopback: d.loopback,
      site: d.site,
      notes: d.notes,
      ports: d.ports,
      trunks: d.trunks,
      expanded: d.expanded,
    }
    return {
      id: d.id,
      type: 'device',
      position: d.position,
      data,
      ...(d.parentId ? { parentId: d.parentId } : {}),
    }
  })

  const notes: AppNode[] = t.notes.map((n) => ({
    id: n.id,
    type: 'note',
    position: n.position,
    width: n.size.width,
    height: n.size.height,
    data: { text: n.text, color: n.color },
  }))

  const edges: AppEdge[] = t.links.map((l) => ({
    id: l.id,
    type: 'link',
    source: l.a.deviceId,
    target: l.b.deviceId,
    sourceHandle: l.a.trunkId ?? l.a.portId,
    targetHandle: l.b.trunkId ?? l.b.portId,
    data: {
      speed: l.speed,
      media: l.media,
      kind: l.kind,
      label: l.label,
      vlans: l.vlans,
      color: l.color,
    },
  }))

  return {
    nodes: [...groups, ...devices, ...notes],
    edges,
    meta: { projectId: t.project.id, projectName: t.project.name, site: t.project.site },
  }
}

/** Parse + validasi file JSON dari pengguna. Pesan error dibuat agar mudah dibaca. */
export function parseTopology(raw: string): { ok: true; data: Topology } | { ok: false; error: string } {
  let json: unknown
  try {
    json = JSON.parse(raw)
  } catch {
    return { ok: false, error: 'File bukan JSON yang valid.' }
  }
  const parsed = topologySchema.safeParse(json)
  if (!parsed.success) {
    const first = parsed.error.issues[0]
    const path = first?.path.join('.') || '(akar)'
    const version = (json as { schemaVersion?: unknown })?.schemaVersion
    const hint =
      version !== undefined && version !== SCHEMA_VERSION
        ? ` File memakai schemaVersion ${String(version)}, aplikasi ini membaca versi ${SCHEMA_VERSION}.`
        : ''
    return { ok: false, error: `Isi file tidak sesuai skema pada "${path}": ${first?.message ?? '-'}.${hint}` }
  }
  return { ok: true, data: parsed.data }
}
