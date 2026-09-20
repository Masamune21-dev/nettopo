import { describe, expect, it } from 'vitest'
import { validateTopology } from '@/lib/validate'
import { getModel } from './deviceCatalog'
import { isDeviceNode } from '@/store/types'
import { sampleTopology } from './sampleTopology'

describe('topologi contoh', () => {
  const { nodes, edges } = sampleTopology()

  it('cukup kompleks untuk menunjukkan kemampuan aplikasi', () => {
    const devices = nodes.filter(isDeviceNode)
    expect(devices.length).toBeGreaterThanOrEqual(20)
    expect(edges.length).toBeGreaterThanOrEqual(25)
    // Lebih dari satu site, dan setiap site punya kotak areanya
    expect(new Set(devices.map((d) => d.data.site).filter(Boolean)).size).toBeGreaterThanOrEqual(4)
    expect(nodes.filter((n) => n.type === 'group').length).toBeGreaterThanOrEqual(4)
  })

  it('memakai beragam vendor dan peran', () => {
    const devices = nodes.filter(isDeviceNode)
    const vendors = new Set(devices.map((d) => getModel(d.data.modelId)?.vendor))
    expect(vendors.size).toBeGreaterThanOrEqual(4)
    const roles = new Set(devices.map((d) => d.data.role))
    for (const r of ['core-router', 'bng', 'ssw', 'olt', 'passive', 'cpe']) {
      expect(roles, `peran ${r} belum terwakili`).toContain(r)
    }
  })

  it('menunjukkan bonding, VLAN, dan pengalamatan L3', () => {
    const devices = nodes.filter(isDeviceNode)
    const trunks = devices.flatMap((d) => d.data.trunks)
    expect(trunks.length).toBeGreaterThanOrEqual(3)
    for (const t of trunks) expect(t.memberIds.length).toBeGreaterThanOrEqual(2)

    const ifaces = devices.flatMap((d) => [...d.data.ports, ...d.data.trunks])
    expect(ifaces.filter((i) => i.linkType === 'access').length).toBeGreaterThanOrEqual(4)
    expect(ifaces.filter((i) => i.linkType === 'trunk').length).toBeGreaterThanOrEqual(10)
    expect(ifaces.filter((i) => i.linkType === 'routed' && i.ipAddress).length).toBeGreaterThanOrEqual(20)
  })

  it('setiap perangkat tersambung, tidak ada yang menggantung', () => {
    const connected = new Set(edges.flatMap((e) => [e.source, e.target]))
    for (const d of nodes.filter(isDeviceNode)) {
      expect(connected.has(d.id), `${d.data.hostname} tidak tersambung`).toBe(true)
    }
  })

  it('tidak ada port yang dipakai dua link', () => {
    const used = new Set<string>()
    for (const e of edges) {
      for (const [dev, handle] of [
        [e.source, e.sourceHandle],
        [e.target, e.targetHandle],
      ] as const) {
        const key = `${dev}:${handle}`
        expect(used.has(key), `handle ${handle} dipakai dua kali`).toBe(false)
        used.add(key)
      }
    }
  })

  it('setiap ujung link menunjuk port atau trunk yang benar-benar ada', () => {
    const devices = nodes.filter(isDeviceNode)
    for (const e of edges) {
      for (const [deviceId, handle] of [
        [e.source, e.sourceHandle],
        [e.target, e.targetHandle],
      ] as const) {
        const d = devices.find((n) => n.id === deviceId)
        expect(d, `perangkat ${deviceId} tidak ada`).toBeDefined()
        const found =
          d!.data.ports.some((p) => p.id === handle) || d!.data.trunks.some((t) => t.id === handle)
        expect(found, `handle ${handle} tidak ada di ${d!.data.hostname}`).toBe(true)
      }
    }
  })

  it('tidak memakai port yang sudah jadi anggota trunk sebagai ujung link', () => {
    const devices = nodes.filter(isDeviceNode)
    for (const e of edges) {
      for (const [deviceId, handle] of [
        [e.source, e.sourceHandle],
        [e.target, e.targetHandle],
      ] as const) {
        const d = devices.find((n) => n.id === deviceId)!
        const insideTrunk = d.data.trunks.some((t) => t.memberIds.includes(handle ?? ''))
        expect(insideTrunk, `${handle} di ${d.data.hostname} sudah jadi anggota trunk`).toBe(false)
      }
    }
  })

  it('lolos pemeriksaan tanpa peringatan', () => {
    expect(validateTopology(nodes, edges)).toEqual([])
  })
})
