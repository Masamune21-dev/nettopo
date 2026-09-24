import { describe, expect, it } from 'vitest'
import type { AppEdge } from '@/store/types'
import type { Trunk } from '@/types/topology'
import { deviceUsage, usageFromKey, usedHandleKey } from './usage'

const edge = (id: string, source: string, sh: string, target: string, th: string): AppEdge => ({
  id,
  type: 'link',
  source,
  sourceHandle: sh,
  target,
  targetHandle: th,
})

describe('usedHandleKey', () => {
  const edges = [edge('l1', 'a', 'p1', 'b', 'p9'), edge('l2', 'a', 'trk1', 'c', 'p3')]
  const trunks = [{ id: 'trk1', memberIds: ['p5', 'p6'] }] as Trunk[]

  it('menghasilkan pemakaian yang sama dengan deviceUsage', () => {
    for (const device of ['a', 'b', 'c', 'x']) {
      expect(usageFromKey(usedHandleKey(device, edges), trunks)).toEqual(deviceUsage(device, trunks, edges))
    }
  })

  it('tetap sama selama handle perangkat itu tidak berubah', () => {
    const before = usedHandleKey('b', edges)
    const moved = [edges[0]!, edge('l2', 'a', 'trk1', 'c', 'p4')]
    expect(usedHandleKey('b', moved)).toBe(before)
    expect(usedHandleKey('c', moved)).not.toBe(usedHandleKey('c', edges))
  })
})
