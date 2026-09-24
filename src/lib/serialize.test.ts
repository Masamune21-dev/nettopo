import { describe, expect, it } from 'vitest'
import { getModel } from '@/data/deviceCatalog'
import { buildPorts } from '@/lib/ports'
import type { AppEdge, AppNode } from '@/store/types'
import { fromTopology, parseTopology, toTopology } from './serialize'

function fixture(): { nodes: AppNode[]; edges: AppEdge[] } {
  const mxPorts = buildPorts(getModel('juniper-mx204')!)
  const crsPorts = buildPorts(getModel('mikrotik-crs309-1g-8sp')!)

  const nodes: AppNode[] = [
    {
      id: 'grp1',
      type: 'group',
      position: { x: 0, y: 0 },
      width: 400,
      height: 300,
      data: { label: 'POP', color: '#6366f1' },
    },
    {
      id: 'dev1',
      type: 'device',
      position: { x: 10, y: 20 },
      data: {
        modelId: 'juniper-mx204',
        hostname: 'MX204-01',
        role: 'core-router',
        mgmtIp: '10.0.0.1',
        loopback: '10.255.0.1',
        site: 'POP-JKT-1',
        notes: 'catatan',
        ports: mxPorts,
        trunks: [],
        expanded: true,
      },
    },
    {
      id: 'dev2',
      type: 'device',
      position: { x: 300, y: 20 },
      data: {
        modelId: 'mikrotik-crs309-1g-8sp',
        hostname: 'CRS309-01',
        role: 'switch',
        mgmtIp: '10.0.0.2',
        loopback: '',
        site: '',
        notes: '',
        ports: crsPorts,
        trunks: [],
        expanded: true,
      },
    },
    {
      id: 'note1',
      type: 'note',
      position: { x: 5, y: 500 },
      width: 200,
      height: 120,
      data: { text: 'halo', color: '#fde68a' },
    },
  ]

  const edges: AppEdge[] = [
    {
      id: 'lnk1',
      type: 'link',
      source: 'dev1',
      target: 'dev2',
      sourceHandle: mxPorts[0]!.id,
      targetHandle: crsPorts[1]!.id,
      data: { speed: '10G', media: 'fiber', kind: 'lacp', label: 'uplink', vlans: '100', color: null, routing: 'bezier', waypoints: [] },
    },
  ]

  return { nodes, edges }
}

const meta = { projectId: 'prj1', projectName: 'Tes', site: 'POP-JKT-1' }

describe('round-trip ekspor → impor', () => {
  it('menghasilkan topologi yang sama persis', () => {
    const { nodes, edges } = fixture()
    const raw = JSON.stringify(toTopology(meta, nodes, edges))

    const parsed = parseTopology(raw)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return

    const back = fromTopology(parsed.data)
    expect(back.meta).toEqual(meta)

    const again = toTopology(back.meta, back.nodes, back.edges)
    const first = JSON.parse(raw) as Record<string, unknown>
    // updatedAt sengaja diperbarui tiap ekspor
    expect({ ...again, project: { ...again.project, updatedAt: '' } }).toEqual({
      ...first,
      project: { ...(first.project as object), updatedAt: '' },
    })
  })

  it('mempertahankan port dan ujung link', () => {
    const { nodes, edges } = fixture()
    const topo = toTopology(meta, nodes, edges)
    expect(topo.devices).toHaveLength(2)
    expect(topo.devices[0]?.ports).toHaveLength(12)
    expect(topo.links[0]?.a.portId).toBe(edges[0]?.sourceHandle)
    expect(topo.links[0]?.b.portId).toBe(edges[0]?.targetHandle)
    expect(topo.groups).toHaveLength(1)
    expect(topo.notes).toHaveLength(1)
  })
})

describe('link berbasis trunk', () => {
  it('membedakan ujung trunk dan ujung port saat ekspor-impor', () => {
    const { nodes, edges } = fixture()
    const mx = nodes.find((n) => n.id === 'dev1')!
    const ports = (mx.data as { ports: { id: string }[] }).ports
    const trunk = {
      id: 'trk1',
      name: 'ae0',
      mode: 'lacp' as const,
      memberIds: [ports[2]!.id, ports[3]!.id],
      description: '',
      side: 'left' as const,
    }
    ;(mx.data as { trunks: unknown[] }).trunks = [trunk]
    edges[0]!.sourceHandle = trunk.id

    const topo = toTopology(meta, nodes, edges)
    expect(topo.links[0]?.a.trunkId).toBe('trk1')
    expect(topo.links[0]?.a.portId).toBe('')
    expect(topo.links[0]?.b.trunkId).toBeNull()

    const parsed = parseTopology(JSON.stringify(topo))
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    const state = fromTopology(parsed.data)
    expect(state.edges[0]?.sourceHandle).toBe('trk1')
    const device = state.nodes.find((n) => n.id === 'dev1')!
    expect((device.data as { trunks: unknown[] }).trunks).toHaveLength(1)
  })
})

describe('kompatibilitas file lama', () => {
  it('membaca file schemaVersion 1 yang belum punya trunk', () => {
    const { nodes, edges } = fixture()
    const v1 = JSON.parse(JSON.stringify(toTopology(meta, nodes, edges))) as Record<string, unknown>
    v1.schemaVersion = 1
    for (const d of v1.devices as Record<string, unknown>[]) delete d.trunks
    for (const l of v1.links as Record<string, Record<string, unknown>>[]) {
      delete l.a!.trunkId
      delete l.b!.trunkId
    }

    const parsed = parseTopology(JSON.stringify(v1))
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.data.devices[0]?.trunks).toEqual([])
    expect(parsed.data.links[0]?.a.trunkId).toBeNull()

    const state = fromTopology(parsed.data)
    expect(state.edges[0]?.sourceHandle).toBe(edges[0]?.sourceHandle)
  })
})

describe('parseTopology', () => {
  it('menolak file yang bukan JSON', () => {
    const r = parseTopology('bukan json {')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain('bukan JSON')
  })

  it('menolak skema versi lain dan menyebut versinya', () => {
    const r = parseTopology(JSON.stringify({ schemaVersion: 99, devices: [], links: [] }))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain('99')
  })

  it('menolak field yang salah tipe dan menyebut lokasinya', () => {
    const { nodes, edges } = fixture()
    const topo = toTopology(meta, nodes, edges) as unknown as Record<string, unknown>
    const devices = topo.devices as Record<string, unknown>[]
    devices[0]!.position = 'bukan posisi'
    const r = parseTopology(JSON.stringify(topo))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain('devices.0.position')
  })
})

describe('repairTopology', () => {
  it('berkas yang sehat tidak diubah', () => {
    const { nodes, edges } = fixture()
    const parsed = parseTopology(JSON.stringify(toTopology(meta, nodes, edges)))
    expect(parsed.ok && parsed.fixes).toEqual([])
  })

  it('membuang id ganda, link yatim, anggota trunk hilang, dan parentId tak dikenal', () => {
    const { nodes, edges } = fixture()
    const topo = toTopology(meta, nodes, edges)
    const dev = topo.devices[0]!
    const broken = {
      ...topo,
      devices: [
        {
          ...dev,
          parentId: 'grp-hilang',
          trunks: [{ ...(dev.trunks[0] ?? {}), id: 't1', name: 'ae0', memberIds: [dev.ports[0]!.id, 'p-hilang'] }],
        },
        topo.devices[1]!,
        { ...topo.devices[1]!, hostname: 'KEMBAR' },
      ],
      links: [
        ...topo.links,
        { ...topo.links[0]!, id: 'l-yatim', b: { ...topo.links[0]!.b, deviceId: 'dev-hilang' } },
      ],
    }
    const parsed = parseTopology(JSON.stringify(broken))
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.data.devices.map((d) => d.hostname)).not.toContain('KEMBAR')
    expect(parsed.data.devices[0]?.parentId).toBeNull()
    expect(parsed.data.devices[0]?.trunks[0]?.memberIds).toEqual([dev.ports[0]!.id])
    expect(parsed.data.links.map((l) => l.id)).toEqual(topo.links.map((l) => l.id))
    expect(parsed.fixes).toHaveLength(4)
  })
})
