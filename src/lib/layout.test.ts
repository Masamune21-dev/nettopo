import { describe, expect, it } from 'vitest'
import { getModel } from '@/data/deviceCatalog'
import { buildPorts } from '@/lib/ports'
import type { AppEdge, AppNode, DeviceNode } from '@/store/types'
import { isDeviceNode } from '@/store/types'
import {
  alignNodes,
  autoPortSides,
  clearWaypoints,
  countWaypoints,
  distributeNodes,
  refitGroups,
} from './layout'

function dev(id: string, x: number, y: number, modelId = 'mikrotik-crs309-1g-8sp'): DeviceNode {
  return {
    id,
    type: 'device',
    position: { x, y },
    measured: { width: 200, height: 100 },
    data: {
      modelId,
      hostname: id.toUpperCase(),
      role: 'switch',
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

describe('autoPortSides', () => {
  it('memindahkan port ke sisi yang menghadap perangkat lawan', () => {
    const kiri = dev('a', 0, 0)
    const kanan = dev('b', 800, 0)
    // Port indeks 0 defaultnya di kiri pada kedua perangkat.
    expect(kiri.data.ports[0]!.side).toBe('left')
    expect(kanan.data.ports[0]!.side).toBe('left')

    const edges: AppEdge[] = [
      {
        id: 'e1',
        type: 'link',
        source: 'a',
        target: 'b',
        sourceHandle: kiri.data.ports[0]!.id,
        targetHandle: kanan.data.ports[0]!.id,
        data: { speed: '10G', media: 'fiber', kind: 'single', label: '', vlans: '', color: null, routing: 'bezier', waypoints: [] },
      },
    ]

    const out = autoPortSides([kiri, kanan], edges).filter(isDeviceNode)
    // Lawan ada di kanan → port pindah ke kanan, dan sebaliknya.
    expect(out[0]!.data.ports[0]!.side).toBe('right')
    expect(out[1]!.data.ports[0]!.side).toBe('left')
  })

  it('tidak mengubah port yang belum punya link', () => {
    const a = dev('a', 0, 0)
    const before = a.data.ports.map((p) => p.side)
    const out = autoPortSides([a], []).filter(isDeviceNode)
    expect(out[0]!.data.ports.map((p) => p.side)).toEqual(before)
  })
})

describe('alignNodes', () => {
  const nodes: AppNode[] = [dev('a', 0, 0), dev('b', 50, 200), dev('c', 120, 400)]
  const all = new Set(['a', 'b', 'c'])

  it('rata kiri menyamakan koordinat x terkecil', () => {
    const out = alignNodes(nodes, all, 'left')
    expect(out.map((n) => n.position.x)).toEqual([0, 0, 0])
  })

  it('rata kanan menyamakan tepi kanan', () => {
    const out = alignNodes(nodes, all, 'right')
    expect(out.map((n) => n.position.x + 200)).toEqual([320, 320, 320])
  })

  it('tidak mengubah node yang tidak terpilih', () => {
    const out = alignNodes(nodes, new Set(['a', 'b']), 'left')
    expect(out[2]!.position.x).toBe(120)
  })

  it('butuh minimal 2 objek', () => {
    expect(alignNodes(nodes, new Set(['a']), 'left')).toEqual(nodes)
  })
})

describe('distributeNodes', () => {
  it('menyamakan jarak antar node', () => {
    const nodes: AppNode[] = [dev('a', 0, 0), dev('b', 210, 0), dev('c', 800, 0)]
    const out = distributeNodes(nodes, new Set(['a', 'b', 'c']), 'horizontal')
    const xs = out.map((n) => n.position.x)
    const gap1 = xs[1]! - (xs[0]! + 200)
    const gap2 = xs[2]! - (xs[1]! + 200)
    expect(Math.abs(gap1 - gap2)).toBeLessThan(1)
    // Ujung-ujungnya tetap di tempat
    expect(xs[0]).toBe(0)
    expect(xs[2]).toBe(800)
  })

  it('butuh minimal 3 objek', () => {
    const nodes: AppNode[] = [dev('a', 0, 0), dev('b', 300, 0)]
    expect(distributeNodes(nodes, new Set(['a', 'b']), 'horizontal')).toEqual(nodes)
  })
})

describe('titik belok', () => {
  const edge = (waypoints: { x: number; y: number }[]): AppEdge => ({
    id: 'e1',
    type: 'link',
    source: 'a',
    target: 'b',
    data: { speed: '10G', media: 'fiber', kind: 'single', label: '', vlans: '', color: null, routing: 'bezier', waypoints },
  })

  it('dihitung dan dibersihkan', () => {
    const edges = [edge([{ x: 1, y: 2 }, { x: 3, y: 4 }]), edge([])]
    expect(countWaypoints(edges)).toBe(2)
    expect(countWaypoints(clearWaypoints(edges))).toBe(0)
  })
})

describe('refitGroups', () => {
  const group = (x: number, y: number, w: number, h: number): AppNode => ({
    id: 'g1',
    type: 'group',
    position: { x, y },
    width: w,
    height: h,
    data: { label: 'POP', color: '#6366f1' },
  })

  it('kotak area mengikuti perangkat yang tadinya di dalamnya', () => {
    const before: AppNode[] = [group(0, 0, 600, 400), dev('a', 50, 50), dev('b', 300, 200)]
    // Perangkat dipindah jauh oleh auto-layout
    const after: AppNode[] = [group(0, 0, 600, 400), dev('a', 1000, 1000), dev('b', 1300, 1200)]

    const out = refitGroups(before, after)
    const g = out.find((n) => n.id === 'g1')!
    expect(g.position.x).toBeLessThan(1000)
    expect(g.position.x).toBeGreaterThan(900)
    // Kotak menutupi kedua perangkat beserta jarak tepi
    expect(g.position.x + (g.width ?? 0)).toBeGreaterThan(1300 + 200)
    expect(g.position.y + (g.height ?? 0)).toBeGreaterThan(1200 + 100)
  })

  it('kotak kosong dibiarkan apa adanya', () => {
    const before: AppNode[] = [group(0, 0, 300, 200), dev('a', 900, 900)]
    const after: AppNode[] = [group(0, 0, 300, 200), dev('a', 1200, 1200)]
    const out = refitGroups(before, after)
    const g = out.find((n) => n.id === 'g1')!
    expect(g.position).toEqual({ x: 0, y: 0 })
    expect(g.width).toBe(300)
  })
})
