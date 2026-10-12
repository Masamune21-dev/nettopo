import { describe, expect, it } from 'vitest'
import { sampleTopology } from '@/data/sampleTopology'
import { parseIp } from '@/lib/ip'
import type { World } from './engine'
import { buildNet, ping, traceroute } from './net'
import { byHost, cable, device, setPort } from './testkit'

const ip = (t: string) => parseIp(t)!

function sample(): World {
  const s = sampleTopology()
  return { nodes: s.nodes, edges: s.edges }
}

describe('ping di topologi contoh', () => {
  it('tetangga satu /30 saling menjawab', () => {
    const w = sample()
    const r = ping(buildNet(w.nodes, w.edges), byHost(w, 'SSW-JKT-01').id, ip('10.255.0.5'))
    expect(r).toMatchObject({ ok: true, hops: 1 })
  })

  it('tujuan beberapa hop gagal tanpa rute statis — tidak ada routing dinamis', () => {
    const w = sample()
    const r = ping(buildNet(w.nodes, w.edges), byHost(w, 'SSW-JKT-01').id, ip('10.255.2.1'))
    expect(r).toMatchObject({ ok: false, noRoute: true })
  })

  it('rute statis di kedua arah membuat ping lintas hop berhasil', () => {
    const w = sample()
    const ssw = byHost(w, 'SSW-JKT-01')
    const bdg = byHost(w, 'MX204-BDG-01')
    const core = byHost(w, 'MX204-CORE-01')
    const route = (id: string, prefix: string, nextHop: string) => {
      w.nodes = w.nodes.map((n) =>
        n.id === id && n.type === 'device' ? { ...n, data: { ...n.data, staticRoutes: [...n.data.staticRoutes, { prefix, nextHop }] } } : n,
      )
    }
    // Pergi saja tidak cukup: balasan juga butuh jalan pulang.
    route(ssw.id, '10.255.2.0/30', '10.255.0.5')
    expect(ping(buildNet(w.nodes, w.edges), ssw.id, ip('10.255.2.2')).ok).toBe(false)

    route(bdg.id, '10.255.0.4/30', '10.255.2.1')
    const net = buildNet(w.nodes, w.edges)
    expect(ping(net, ssw.id, ip('10.255.2.2'))).toMatchObject({ ok: true, hops: 2 })

    const t = traceroute(net, ssw.id, ip('10.255.2.2'))
    expect(t.reached).toBe(true)
    expect(t.hops.map((h) => h.deviceId)).toEqual([core.id, bdg.id])
  })

  it('shutdown di salah satu ujung memutus link', () => {
    const w = sample()
    const ssw = byHost(w, 'SSW-JKT-01')
    setPort(w, ssw.id, '100GE1/0/1', { shutdown: true })
    expect(ping(buildNet(w.nodes, w.edges), ssw.id, ip('10.255.0.5')).ok).toBe(false)
  })
})

describe('ping melewati switch L2', () => {
  /** R1 ── SW1 ══ SW2 ── R2, dengan VLAN yang bisa diatur per port. */
  function lab() {
    const w: World = { nodes: [], edges: [] }
    const r1 = device(w, 'generic-router', 'R1')
    const r2 = device(w, 'generic-router', 'R2')
    const sw1 = device(w, 'generic-switch', 'SW1')
    const sw2 = device(w, 'generic-switch', 'SW2')
    setPort(w, r1, 'port1', { linkType: 'routed', ipAddress: '10.0.0.1/24' })
    setPort(w, r2, 'port1', { linkType: 'routed', ipAddress: '10.0.0.2/24' })
    setPort(w, sw1, 'port1', { linkType: 'access', pvid: 10 })
    setPort(w, sw2, 'port1', { linkType: 'access', pvid: 10 })
    setPort(w, sw1, 'port12', { linkType: 'trunk', pvid: 1, allowedVlans: '1,10' })
    setPort(w, sw2, 'port12', { linkType: 'trunk', pvid: 1, allowedVlans: '1,10' })
    cable(w, r1, 'port1', sw1, 'port1')
    cable(w, sw1, 'port12', sw2, 'port12')
    cable(w, sw2, 'port1', r2, 'port1')
    return { w, r1, sw1, sw2 }
  }

  it('VLAN yang sama di sepanjang jalur: berhasil', () => {
    const { w, r1 } = lab()
    expect(ping(buildNet(w.nodes, w.edges), r1, ip('10.0.0.2')).ok).toBe(true)
  })

  it('access VLAN berbeda di satu sisi: gagal', () => {
    const { w, r1, sw2 } = lab()
    setPort(w, sw2, 'port1', { pvid: 20 })
    expect(ping(buildNet(w.nodes, w.edges), r1, ip('10.0.0.2')).ok).toBe(false)
  })

  it('trunk antar switch yang tidak membawa VLAN-nya: gagal', () => {
    const { w, r1, sw1 } = lab()
    setPort(w, sw1, 'port12', { allowedVlans: '1,20' })
    expect(ping(buildNet(w.nodes, w.edges), r1, ip('10.0.0.2')).ok).toBe(false)
  })

  it('perangkat pasif di tengah kabel diteruskan apa adanya', () => {
    const w: World = { nodes: [], edges: [] }
    const r1 = device(w, 'generic-router', 'R1')
    const r2 = device(w, 'generic-router', 'R2')
    const mc = device(w, 'htb-gs-03', 'MC1')
    setPort(w, r1, 'port1', { linkType: 'routed', ipAddress: '10.0.0.1/30' })
    setPort(w, r2, 'port1', { linkType: 'routed', ipAddress: '10.0.0.2/30' })
    cable(w, r1, 'port1', mc, 'fiber1')
    cable(w, mc, 'utp1', r2, 'port1')
    expect(ping(buildNet(w.nodes, w.edges), r1, ip('10.0.0.2')).ok).toBe(true)
  })
})
