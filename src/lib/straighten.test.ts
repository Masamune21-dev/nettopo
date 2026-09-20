import type { InternalNode, Node } from '@xyflow/react'
import { describe, expect, it } from 'vitest'
import { planStraighten } from './straighten'

/** Node tiruan dengan dua handle di sisi kiri dan kanan. */
function node(id: string, x: number, y: number, handleY: Record<string, number>): InternalNode<Node> {
  return {
    id,
    position: { x, y },
    data: {},
    internals: {
      positionAbsolute: { x, y },
      handleBounds: {
        source: Object.entries(handleY).map(([hid, hy]) => ({
          id: hid,
          position: 'right',
          x: 200,
          y: hy,
          width: 10,
          height: 10,
        })),
        target: [],
      },
      userNode: {} as Node,
      z: 0,
    },
  } as unknown as InternalNode<Node>
}

describe('planStraighten', () => {
  it('menggeser node tujuan secara tegak untuk kabel mendatar', () => {
    // Port A di y absolut 100+50+5 = 155; port B di 100+62+5 = 167
    const a = node('a', 0, 100, { pa: 50 })
    const b = node('b', 600, 100, { pb: 62 })
    const plan = planStraighten(a, 'pa', b, 'pb')
    expect(plan).toEqual({ nodeId: 'b', dx: 0, dy: -12, axis: 'y' })
  })

  it('tidak menghasilkan rencana kalau sudah lurus', () => {
    const a = node('a', 0, 100, { pa: 50 })
    const b = node('b', 600, 100, { pb: 50 })
    expect(planStraighten(a, 'pa', b, 'pb')).toBeNull()
  })

  it('memakai sumbu X kalau kabelnya lebih tegak daripada mendatar', () => {
    const a = node('a', 0, 0, { pa: 10 })
    const b = node('b', 30, 900, { pb: 10 })
    const plan = planStraighten(a, 'pa', b, 'pb')
    expect(plan?.axis).toBe('x')
    expect(plan?.dx).toBe(-30)
  })

  it('bisa menggeser sisi sumber, bukan tujuan', () => {
    const a = node('a', 0, 100, { pa: 50 })
    const b = node('b', 600, 100, { pb: 62 })
    const plan = planStraighten(a, 'pa', b, 'pb', 'a')
    expect(plan).toEqual({ nodeId: 'a', dx: 0, dy: 12, axis: 'y' })
  })

  it('mengembalikan null kalau handle tidak dikenal', () => {
    const a = node('a', 0, 0, { pa: 10 })
    const b = node('b', 600, 0, { pb: 10 })
    expect(planStraighten(a, 'tidak-ada', b, 'pb')).toBeNull()
  })
})
