import { Position } from '@xyflow/react'
import { describe, expect, it } from 'vitest'
import { buildEdgePath, endpointDirections } from './edgePath'

const base = {
  sourceX: 0,
  sourceY: 0,
  targetX: 300,
  targetY: 0,
  sourcePosition: Position.Right,
  targetPosition: Position.Left,
}

describe('endpointDirections', () => {
  it('menghadap kanan kalau tujuannya di kanan', () => {
    const d = endpointDirections(0, 0, 300, 0, [])
    expect(d.sourcePosition).toBe(Position.Right)
    expect(d.targetPosition).toBe(Position.Left)
  })

  it('menghadap bawah kalau selisih tegaknya lebih besar', () => {
    const d = endpointDirections(0, 0, 50, 400, [])
    expect(d.sourcePosition).toBe(Position.Bottom)
    expect(d.targetPosition).toBe(Position.Top)
  })

  it('mengikuti titik belok pertama dan terakhir', () => {
    // Tujuan di kanan, tapi kabel dibelokkan ke atas dulu.
    const d = endpointDirections(0, 0, 300, 0, [{ x: 10, y: -200 }])
    expect(d.sourcePosition).toBe(Position.Top)
  })
})

describe('buildEdgePath', () => {
  it('tanpa titik belok memakai jalur bawaan React Flow', () => {
    const [path] = buildEdgePath({ ...base, routing: 'bezier', waypoints: [] })
    expect(path.startsWith('M')).toBe(true)
    expect(path).toContain('C')
  })

  it('gaya lurus tanpa belokan menghasilkan garis lurus', () => {
    const [path] = buildEdgePath({ ...base, routing: 'straight', waypoints: [] })
    expect(path).not.toContain('C')
  })

  it('melewati titik belok yang diberikan', () => {
    const [path, labelX, labelY] = buildEdgePath({
      ...base,
      routing: 'straight',
      waypoints: [{ x: 150, y: 120 }],
    })
    expect(path).toBe('M 0,0 L 150,120 L 300,0')
    // Label menggantung di tengah panjang kabel
    expect(labelX).toBeCloseTo(150, 0)
    expect(labelY).toBeCloseTo(120, 0)
  })

  it('gaya lengkung dengan belokan memakai spline', () => {
    const [path] = buildEdgePath({
      ...base,
      routing: 'bezier',
      waypoints: [{ x: 150, y: 120 }],
    })
    expect(path.startsWith('M 0,0')).toBe(true)
    expect((path.match(/C/g) ?? []).length).toBe(2)
  })

  it('gaya siku menumpulkan sudut', () => {
    const [path] = buildEdgePath({
      ...base,
      routing: 'smoothstep',
      waypoints: [{ x: 150, y: 120 }],
    })
    expect(path).toContain('Q')
  })
})
