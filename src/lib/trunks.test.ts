import { describe, expect, it } from 'vitest'
import { getModel } from '@/data/deviceCatalog'
import { buildPorts } from '@/lib/ports'
import type { Port, Trunk } from '@/types/topology'
import { deviceUsage } from './usage'
import { formatBandwidth, nextTrunkName, summarizeTrunk, trunkOfPort } from './trunks'

const trunk = (memberIds: string[], name = 'Eth-Trunk1'): Trunk => ({
  id: 't1',
  name,
  mode: 'lacp',
  memberIds,
  description: '',
  side: 'left',
})

describe('nextTrunkName', () => {
  it('memakai penamaan sesuai OS perangkat', () => {
    expect(nextTrunkName('vrp', [])).toBe('Eth-Trunk1') // Huawei
    expect(nextTrunkName('junos', [])).toBe('ae0') // Juniper mulai dari 0
    expect(nextTrunkName('routeros', [])).toBe('bond1') // MikroTik
    expect(nextTrunkName('other', [])).toBe('lag1')
  })

  it('melewati nomor yang sudah dipakai', () => {
    const existing = [trunk([], 'Eth-Trunk1'), trunk([], 'Eth-Trunk2')]
    expect(nextTrunkName('vrp', existing)).toBe('Eth-Trunk3')
    expect(nextTrunkName('junos', [trunk([], 'ae0')])).toBe('ae1')
  })
})

describe('summarizeTrunk', () => {
  const ports = buildPorts(getModel('huawei-s6730-h48x6c')!)

  it('menjumlahkan bandwidth anggota', () => {
    const s = summarizeTrunk(trunk([ports[0]!.id, ports[1]!.id]), ports)
    expect(s.count).toBe(2)
    expect(s.memberSpeed).toBe('10G')
    expect(s.totalGbps).toBe(20)
    expect(s.label).toBe('2× 10G = 20G')
  })

  it('menandai anggota dengan kecepatan campuran', () => {
    const tenGig = ports.find((p) => p.speed === '10G')!
    const hundredGig = ports.find((p) => p.speed === '100G')!
    const s = summarizeTrunk(trunk([tenGig.id, hundredGig.id]), ports)
    expect(s.memberSpeed).toBeNull()
    expect(s.totalGbps).toBe(110)
    expect(s.composition).toContain('campuran')
  })

  it('mengabaikan id anggota yang sudah tidak ada', () => {
    const s = summarizeTrunk(trunk([ports[0]!.id, 'port_hilang']), ports)
    expect(s.count).toBe(1)
  })
})

describe('formatBandwidth', () => {
  it('memilih satuan yang wajar', () => {
    expect(formatBandwidth(0.3)).toBe('300M')
    expect(formatBandwidth(2)).toBe('2G')
    expect(formatBandwidth(2.5)).toBe('2.5G')
    expect(formatBandwidth(200)).toBe('200G')
  })
})

describe('trunkOfPort', () => {
  it('menemukan trunk pemilik sebuah port', () => {
    const ports: Port[] = buildPorts(getModel('mikrotik-ccr2004-1g-12sp-2xs')!)
    const t = trunk([ports[1]!.id, ports[2]!.id], 'bond1')
    expect(trunkOfPort([t], ports[1]!.id)?.name).toBe('bond1')
    expect(trunkOfPort([t], ports[5]!.id)).toBeUndefined()
  })
})

describe('deviceUsage', () => {
  const ports = buildPorts(getModel('huawei-s6730-h48x6c')!)
  const t = trunk([ports[0]!.id, ports[1]!.id])
  const edge = (handle: string) => ({
    id: `e-${handle}`,
    source: 'dev',
    target: 'lain',
    sourceHandle: handle,
    targetHandle: 'x',
  })

  it('menghitung anggota trunk sebagai port yang terpakai', () => {
    const u = deviceUsage('dev', [t], [edge(t.id)] as never)
    expect(u.handles.has(t.id)).toBe(true)
    expect(u.ports.size).toBe(2)
    expect(u.ports.has(ports[0]!.id)).toBe(true)
  })

  it('tetap menghitung port yang punya link sendiri', () => {
    const solo = ports[9]!
    const u = deviceUsage('dev', [t], [edge(t.id), edge(solo.id)] as never)
    expect(u.ports.size).toBe(3)
    expect(u.ports.has(solo.id)).toBe(true)
  })

  it('kosong bila perangkat belum punya link', () => {
    const u = deviceUsage('dev', [t], [])
    expect(u.ports.size).toBe(0)
  })
})
