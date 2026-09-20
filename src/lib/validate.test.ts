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
