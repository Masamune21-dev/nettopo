import { describe, expect, it } from 'vitest'
import { getModel } from '@/data/deviceCatalog'
import { buildPorts } from '@/lib/ports'
import type { AppEdge, AppNode, DeviceNode } from '@/store/types'
import { analyzeIpam } from './ipam'

function dev(id: string, hostname: string, modelId = 'juniper-mx204'): DeviceNode {
  return {
    id,
    type: 'device',
    position: { x: 0, y: 0 },
    data: {
      modelId,
      hostname,
      role: 'core-router',
      mgmtIp: '',
      loopback: '',
      site: '',
      notes: '',
      ports: buildPorts(getModel(modelId)!),
      trunks: [],
      expanded: true,
    },
  }
}

function setIp(d: DeviceNode, index: number, ip: string) {
  d.data.ports[index] = { ...d.data.ports[index]!, linkType: 'routed', ipAddress: ip }
}
function setRouted(d: DeviceNode, index: number) {
  d.data.ports[index] = { ...d.data.ports[index]!, linkType: 'routed' }
}

const link = (a: DeviceNode, ai: number, b: DeviceNode, bi: number): AppEdge => ({
  id: `e-${a.id}-${b.id}-${ai}`,
  type: 'link',
  source: a.id,
  target: b.id,
  sourceHandle: a.data.ports[ai]!.id,
  targetHandle: b.data.ports[bi]!.id,
  data: { speed: '100G', media: 'fiber', kind: 'single', label: '', vlans: '', color: null, routing: 'bezier', waypoints: [] },
})

describe('analyzeIpam', () => {
  it('mengelompokkan interface ke dalam subnetnya', () => {
    const a = dev('a', 'MX-01')
    const b = dev('b', 'MX-02')
    setIp(a, 0, '10.0.0.1/30')
    setIp(b, 0, '10.0.0.2/30')
    const r = analyzeIpam([a, b] as AppNode[], [link(a, 0, b, 0)])
    expect(r.subnets).toHaveLength(1)
    expect(r.subnets[0]!.members).toHaveLength(2)
    expect(r.subnets[0]!.capacity).toBe(2)
    expect(r.issues).toEqual([])
  })

  it('menandai dua ujung link yang beda subnet', () => {
    const a = dev('a', 'MX-01')
    const b = dev('b', 'MX-02')
    setIp(a, 0, '10.0.0.1/30')
    setIp(b, 0, '10.0.0.9/30')
    const r = analyzeIpam([a, b] as AppNode[], [link(a, 0, b, 0)])
    expect(r.issues.some((i) => i.text.includes('tidak berada di subnet yang sama'))).toBe(true)
  })

  it('menandai alamat yang dipakai dua interface', () => {
    const a = dev('a', 'MX-01')
    const b = dev('b', 'MX-02')
    setIp(a, 0, '10.0.0.1/30')
    setIp(b, 0, '10.0.0.1/30')
    const r = analyzeIpam([a, b] as AppNode[], [])
    expect(r.issues.some((i) => i.text.includes('dipakai 2 interface'))).toBe(true)
  })

  it('menolak alamat jaringan dan broadcast', () => {
    const a = dev('a', 'MX-01')
    setIp(a, 0, '10.0.0.0/30')
    setIp(a, 1, '10.0.0.7/30')
    const r = analyzeIpam([a] as AppNode[], [])
    expect(r.issues.some((i) => i.text.includes('alamat jaringan'))).toBe(true)
    expect(r.issues.some((i) => i.text.includes('alamat broadcast'))).toBe(true)
  })

  it('menandai tulisan alamat yang tidak sah', () => {
    const a = dev('a', 'MX-01')
    setIp(a, 0, '10.0.0.999/30')
    const r = analyzeIpam([a] as AppNode[], [])
    expect(r.issues.some((i) => i.text.includes('bukan alamat IP yang sah'))).toBe(true)
  })

  it('mendaftar link routed yang kedua ujungnya masih kosong', () => {
    const a = dev('a', 'MX-01')
    const b = dev('b', 'MX-02')
    setRouted(a, 0)
    setRouted(b, 0)
    const r = analyzeIpam([a, b] as AppNode[], [link(a, 0, b, 0)])
    expect(r.unaddressed).toHaveLength(1)
    expect(r.unaddressed[0]!.aHost).toBe('MX-01')
  })

  it('mengingatkan kalau hanya satu ujung yang beralamat', () => {
    const a = dev('a', 'MX-01')
    const b = dev('b', 'MX-02')
    setIp(a, 0, '10.0.0.1/30')
    setRouted(b, 0)
    const r = analyzeIpam([a, b] as AppNode[], [link(a, 0, b, 0)])
    expect(r.issues.some((i) => i.text.includes('Hanya satu ujung'))).toBe(true)
  })

  it('menandai blok yang tumpang tindih', () => {
    const a = dev('a', 'MX-01')
    setIp(a, 0, '10.0.0.1/24')
    setIp(a, 1, '10.0.0.130/25')
    const r = analyzeIpam([a] as AppNode[], [])
    expect(r.issues.some((i) => i.text.includes('tumpang tindih'))).toBe(true)
  })

  it('mengabaikan interface yang tidak beralamat', () => {
    const a = dev('a', 'MX-01')
    const r = analyzeIpam([a] as AppNode[], [])
    expect(r.interfaces).toHaveLength(0)
    expect(r.subnets).toHaveLength(0)
  })
})
