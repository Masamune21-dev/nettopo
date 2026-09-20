import { describe, expect, it } from 'vitest'
import { validateTopology } from '@/lib/validate'
import { isDeviceNode } from '@/store/types'
import { sampleTopology } from './sampleTopology'

describe('topologi contoh', () => {
  const { nodes, edges } = sampleTopology()

  it('punya perangkat dan link', () => {
    expect(nodes.filter(isDeviceNode)).toHaveLength(7)
    expect(edges).toHaveLength(7)
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
