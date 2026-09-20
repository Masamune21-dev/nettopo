import { describe, expect, it } from 'vitest'
import { getModel } from '@/data/deviceCatalog'
import { buildPorts } from '@/lib/ports'
import type { AppEdge, AppNode, DeviceNode } from '@/store/types'
import { validateTopology } from './validate'

function dev(id: string, hostname: string, mgmtIp: string, modelId: string): DeviceNode {
  return {
    id,
    type: 'device',
    position: { x: 0, y: 0 },
    data: {
      modelId,
      hostname,
      role: 'switch',
      mgmtIp,
      loopback: '',
      site: '',
      notes: '',
      ports: buildPorts(getModel(modelId)!),
      trunks: [],
      expanded: true,
    },
  }
}

describe('validateTopology', () => {
  it('menandai IP manajemen ganda', () => {
    const nodes: AppNode[] = [
      dev('a', 'SW-01', '10.0.0.1', 'mikrotik-crs309-1g-8sp'),
      dev('b', 'SW-02', '10.0.0.1', 'mikrotik-crs309-1g-8sp'),
    ]
    const issues = validateTopology(nodes, [])
    expect(issues.some((i) => i.text.includes('10.0.0.1') && i.level === 'warn')).toBe(true)
  })

  it('menandai hostname ganda', () => {
    const nodes: AppNode[] = [
      dev('a', 'SW-01', '', 'mikrotik-crs309-1g-8sp'),
      dev('b', 'SW-01', '', 'mikrotik-crs309-1g-8sp'),
    ]
    expect(validateTopology(nodes, []).some((i) => i.text.includes('"SW-01"'))).toBe(true)
  })

  it('menandai beda kecepatan di dua ujung link', () => {
    const a = dev('a', 'MX-01', '', 'juniper-mx204')
    const b = dev('b', 'CRS-01', '', 'mikrotik-crs309-1g-8sp')
    const edges: AppEdge[] = [
      {
        id: 'e1',
        type: 'link',
        source: 'a',
        target: 'b',
        sourceHandle: a.data.ports[0]!.id, // et-0/0/0 = 100G
        targetHandle: b.data.ports[0]!.id, // ether1 = 1G
        data: { speed: '1G', media: 'fiber', kind: 'single', label: '', vlans: '', color: null },
      },
    ]
    const issues = validateTopology([a, b], edges)
    expect(issues.some((i) => i.edgeId === 'e1' && i.text.includes('beda kecepatan'))).toBe(true)
  })

  it('menandai perangkat yang belum tersambung', () => {
    const nodes: AppNode[] = [dev('a', 'SW-01', '', 'mikrotik-crs309-1g-8sp')]
    const issues = validateTopology(nodes, [])
    expect(issues.some((i) => i.nodeId === 'a' && i.level === 'info')).toBe(true)
  })

  it('tidak mengeluh pada topologi yang sehat', () => {
    const a = dev('a', 'CRS-01', '10.0.0.1', 'mikrotik-crs309-1g-8sp')
    const b = dev('b', 'CRS-02', '10.0.0.2', 'mikrotik-crs309-1g-8sp')
    const edges: AppEdge[] = [
      {
        id: 'e1',
        type: 'link',
        source: 'a',
        target: 'b',
        sourceHandle: a.data.ports[1]!.id,
        targetHandle: b.data.ports[1]!.id,
        data: { speed: '10G', media: 'fiber', kind: 'single', label: '', vlans: '', color: null },
      },
    ]
    expect(validateTopology([a, b], edges)).toEqual([])
  })
})

describe('pemeriksaan VLAN', () => {
  const withCfg = (
    id: string,
    hostname: string,
    portPatch: Partial<DeviceNode['data']['ports'][number]>,
  ) => {
    const d = dev(id, hostname, '', 'mikrotik-crs309-1g-8sp')
    d.data.ports[1] = { ...d.data.ports[1]!, ...portPatch }
    return d
  }

  const linkBetween = (a: DeviceNode, b: DeviceNode): AppEdge => ({
    id: 'e1',
    type: 'link',
    source: a.id,
    target: b.id,
    sourceHandle: a.data.ports[1]!.id,
    targetHandle: b.data.ports[1]!.id,
    data: { speed: '10G', media: 'fiber', kind: 'single', label: '', vlans: '', color: null },
  })

  it('menandai daftar VLAN yang tidak sah', () => {
    const d = withCfg('a', 'SW-01', { linkType: 'trunk', allowedVlans: '100,abc' })
    const issues = validateTopology([d], [])
    expect(issues.some((i) => i.text.includes('tidak sah'))).toBe(true)
  })

  it('menandai PVID di luar daftar tagged', () => {
    const d = withCfg('a', 'SW-01', { linkType: 'trunk', pvid: 999, allowedVlans: '100,200' })
    const issues = validateTopology([d], [])
    expect(issues.some((i) => i.text.includes('PVID 999'))).toBe(true)
  })

  it('menandai access yang VLAN-nya belum diisi', () => {
    const d = withCfg('a', 'SW-01', { linkType: 'access' })
    expect(validateTopology([d], []).some((i) => i.text.includes('VLAN-nya belum diisi'))).toBe(true)
  })

  it('menandai VLAN yang tidak cocok di dua ujung link', () => {
    const a = withCfg('a', 'SW-01', { linkType: 'trunk', pvid: 1, allowedVlans: '1,100,200' })
    const b = withCfg('b', 'SW-02', { linkType: 'trunk', pvid: 1, allowedVlans: '1,100' })
    const issues = validateTopology([a, b], [linkBetween(a, b)])
    const found = issues.find((i) => i.id === 'vlan-mismatch-e1')
    expect(found?.text).toContain('200')
  })

  it('menandai beda link-type antar ujung', () => {
    const a = withCfg('a', 'SW-01', { linkType: 'trunk', pvid: 1, allowedVlans: '1,100' })
    const b = withCfg('b', 'SW-02', { linkType: 'access', pvid: 100 })
    const issues = validateTopology([a, b], [linkBetween(a, b)])
    expect(issues.some((i) => i.id === 'linktype-e1')).toBe(true)
  })

  it('diam kalau kedua ujung cocok', () => {
    const a = withCfg('a', 'SW-01', { linkType: 'trunk', pvid: 1, allowedVlans: '1,100,200' })
    const b = withCfg('b', 'SW-02', { linkType: 'trunk', pvid: 1, allowedVlans: '1,100,200' })
    const issues = validateTopology([a, b], [linkBetween(a, b)])
    expect(issues.filter((i) => i.edgeId === 'e1')).toEqual([])
  })
})
