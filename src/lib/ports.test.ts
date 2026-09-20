import { describe, expect, it } from 'vitest'
import { getModel } from '@/data/deviceCatalog'
import { buildPorts, comparePortName, expandTemplate, nextPortName } from './ports'
import type { Port } from '@/types/topology'

describe('expandTemplate', () => {
  it('menomori port Juniper mulai dari 0', () => {
    const names = expandTemplate({
      prefix: 'et-0/0/',
      count: 4,
      startIndex: 0,
      speed: '100G',
      media: 'qsfp28',
      group: 'QSFP28',
    }).map((p) => p.name)
    expect(names).toEqual(['et-0/0/0', 'et-0/0/1', 'et-0/0/2', 'et-0/0/3'])
  })

  it('menomori port MikroTik & Huawei mulai dari 1', () => {
    expect(
      expandTemplate({
        prefix: 'sfp-sfpplus',
        count: 3,
        startIndex: 1,
        speed: '10G',
        media: 'sfp+',
        group: 'SFP+',
      }).map((p) => p.name),
    ).toEqual(['sfp-sfpplus1', 'sfp-sfpplus2', 'sfp-sfpplus3'])

    expect(
      expandTemplate({
        prefix: '100GE1/0/',
        count: 2,
        startIndex: 1,
        speed: '100G',
        media: 'qsfp28',
        group: '100GE',
      }).map((p) => p.name),
    ).toEqual(['100GE1/0/1', '100GE1/0/2'])
  })

  it('menghormati akhiran untuk port QSFP MikroTik', () => {
    expect(
      expandTemplate({
        prefix: 'qsfpplus',
        suffix: '-1',
        count: 2,
        startIndex: 1,
        speed: '40G',
        media: 'qsfp+',
        group: 'QSFP+',
      }).map((p) => p.name),
    ).toEqual(['qsfpplus1-1', 'qsfpplus2-1'])
  })
})

describe('buildPorts', () => {
  it('membuat semua port MX204 dengan kecepatan yang benar', () => {
    const model = getModel('juniper-mx204')
    expect(model).toBeDefined()
    const ports = buildPorts(model!)
    expect(ports).toHaveLength(12)
    expect(ports.filter((p) => p.speed === '100G')).toHaveLength(4)
    expect(ports.filter((p) => p.speed === '10G')).toHaveLength(8)
    expect(ports[0]?.name).toBe('et-0/0/0')
    expect(ports.at(-1)?.name).toBe('xe-0/1/7')
  })

  it('memberi setiap port id unik dan sisi berselang-seling', () => {
    const ports = buildPorts(getModel('mikrotik-crs309-1g-8sp')!)
    expect(new Set(ports.map((p) => p.id)).size).toBe(ports.length)
    expect(ports.map((p) => p.side).slice(0, 4)).toEqual(['left', 'right', 'left', 'right'])
  })

  it('membuat port untuk setiap model di katalog tanpa nama ganda', () => {
    for (const id of [
      'juniper-mx10003',
      'huawei-ce6881-48s6cq',
      'huawei-ce6865e-48s8cq',
      'huawei-s6730-h48x6c',
      'mikrotik-ccr2216-1g-12xs-2xq',
      'mikrotik-crs354-48g-4sp2qp',
    ]) {
      const ports = buildPorts(getModel(id)!)
      expect(ports.length).toBeGreaterThan(0)
      expect(new Set(ports.map((p) => p.name)).size, `nama port ganda di ${id}`).toBe(ports.length)
    }
  })
})

describe('model Huawei SSW', () => {
  it('S6730-H48X6C punya 48× 10GE + 6× 100GE', () => {
    const ports = buildPorts(getModel('huawei-s6730-h48x6c')!)
    expect(ports.filter((p) => p.speed === '10G')).toHaveLength(48)
    expect(ports.filter((p) => p.speed === '100G')).toHaveLength(6)
    expect(ports[0]?.name).toBe('10GE1/0/1')
    expect(ports.at(-1)?.name).toBe('100GE1/0/6')
  })

  it('CE6865E-48S8CQ punya 48× 25GE + 8× 100GE', () => {
    const ports = buildPorts(getModel('huawei-ce6865e-48s8cq')!)
    expect(ports.filter((p) => p.speed === '25G')).toHaveLength(48)
    expect(ports.filter((p) => p.speed === '100G')).toHaveLength(8)
    expect(ports[0]?.name).toBe('25GE1/0/1')
    expect(ports.at(-1)?.name).toBe('100GE1/0/8')
  })

  it('CE6881-48S6CQ punya 48× 25GE + 6× 100GE', () => {
    const ports = buildPorts(getModel('huawei-ce6881-48s6cq')!)
    expect(ports.filter((p) => p.speed === '25G')).toHaveLength(48)
    expect(ports.filter((p) => p.speed === '100G')).toHaveLength(6)
  })
})

describe('nextPortName', () => {
  const port = (name: string): Port => ({
    id: name,
    name,
    speed: '1G',
    media: 'rj45',
    description: '',
    side: 'left',
    linkType: 'none',
    pvid: null,
    allowedVlans: '',
    untaggedVlans: '',
    ipAddress: '',
  })

  it('melewati nama yang sudah dipakai', () => {
    expect(nextPortName([port('port1'), port('port2')])).toBe('port3')
    expect(nextPortName([])).toBe('port1')
  })
})

describe('comparePortName', () => {
  it('mengurutkan angka secara natural', () => {
    const sorted = ['ether10', 'ether2', 'ether1'].sort(comparePortName)
    expect(sorted).toEqual(['ether1', 'ether2', 'ether10'])
  })
})
