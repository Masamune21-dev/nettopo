import { describe, expect, it } from 'vitest'
import { sampleTopology } from '@/data/sampleTopology'
import { toTopology } from '@/lib/serialize'
import { describeCatalog, describeTopology } from './aiContext'

describe('describeCatalog', () => {
  const text = describeCatalog()

  // Ini pernah jadi bug nyata: tanpa rentang port, model bahasa menebak nama
  // interface (mis. "100GE0/0/25") dan SEMUA link yang dibuatnya ditolak.
  it('mencantumkan rentang nama port yang sebenarnya', () => {
    expect(text).toContain('100GE1/0/1..100GE1/0/6')
    expect(text).toContain('et-0/0/0..et-0/0/3')
    expect(text).toContain('GE0/0/1..GE0/0/24')
    expect(text).toContain('sfp-sfpplus1..sfp-sfpplus8')
  })

  it('menulis port tunggal tanpa rentang', () => {
    // CRS309 hanya punya satu port ether
    expect(text).toMatch(/ether1 \(1G\)/)
  })

  it('menyertakan setiap model di katalog', () => {
    expect(text).toContain('juniper-mx204')
    expect(text).toContain('mikrotik-ccr2004-1g-12sp-2xs')
    expect(text).toContain('huawei-ce6865e-48s8cq')
  })
})

describe('describeTopology', () => {
  const s = sampleTopology()
  const topo = toTopology({ projectId: 'p', projectName: 'Uji', site: 'POP-JKT-1' }, s.nodes, s.edges)
  const text = describeTopology(topo)

  it('memakai hostname, bukan id acak', () => {
    expect(text).toContain('MX204-CORE-01')
    expect(text).not.toMatch(/dev_[a-z0-9]{8}/)
  })

  it('menyebut trunk beserta anggotanya', () => {
    expect(text).toContain('Eth-Trunk1')
    // Baris trunk menyebut anggotanya dan kapasitas gabungannya
    expect(text).toMatch(/trunk \S+ \(lacp\) anggota: [^\n]+= \d+× \d+G = \d+G/)
  })

  it('menyebut VLAN dan IP interface', () => {
    expect(text).toMatch(/access vlan \d+/)
    expect(text).toMatch(/routed \d+\.\d+\.\d+\.\d+\/30/)
    expect(text).toMatch(/trunk · pvid \d+ · tagged /)
  })

  it('meringkas port yang belum dikonfigurasi, bukan mendaftar semuanya', () => {
    expect(text).toMatch(/\(\+\d+ port lain belum dikonfigurasi\)/)
    // Ringkasan harus jauh lebih pendek daripada mendaftar setiap port satu-satu:
    // topologi contoh punya ribuan port, ringkasannya harus di bawah seperlimanya.
    const totalPorts = topo.devices.reduce((n, d) => n + d.ports.length, 0)
    expect(totalPorts).toBeGreaterThan(300)
    expect(text.split('\n').length).toBeLessThan(totalPorts / 2)
  })

  it('mendaftar setiap link dengan kedua ujungnya', () => {
    expect(text).toContain('<->')
    for (const l of topo.links) expect(text).toContain(l.speed)
  })
})
