import { beforeEach, describe, expect, it } from 'vitest'
import { isDeviceNode } from './types'
import { useTopologyStore } from './useTopologyStore'

const store = () => useTopologyStore.getState()

beforeEach(() => {
  store().replaceAll({ nodes: [], edges: [] })
})

describe('undo setelah menggeser perangkat', () => {
  it('mengembalikan posisi sebelum digeser', () => {
    store().addDevice('juniper-mx204', { x: 0, y: 0 })
    const id = store().nodes[0].id

    // Urutan yang dikirim React Flow: beberapa langkah dragging, lalu penutup.
    store().onNodesChange([{ type: 'position', id, position: { x: 100, y: 0 }, dragging: true }])
    store().onNodesChange([{ type: 'position', id, position: { x: 300, y: 0 }, dragging: true }])
    store().onNodesChange([{ type: 'position', id, position: { x: 300, y: 0 }, dragging: false }])
    expect(store().nodes[0].position).toEqual({ x: 300, y: 0 })

    store().undo()
    expect(store().nodes[0].position).toEqual({ x: 0, y: 0 })

    // Satu drag = satu langkah history; undo berikutnya membatalkan addDevice.
    store().undo()
    expect(store().nodes).toHaveLength(0)
  })
})

describe('duplikasi', () => {
  it('memberi hostname berbeda untuk tiap salinan bermodel sama', () => {
    store().addDevice('juniper-mx204', { x: 0, y: 0 })
    store().addDevice('juniper-mx204', { x: 200, y: 0 })
    useTopologyStore.setState((s) => ({ nodes: s.nodes.map((n) => ({ ...n, selected: true })) }))

    store().duplicateSelected()
    const names = store()
      .nodes.filter(isDeviceNode)
      .map((n) => n.data.hostname)
    expect(names).toEqual(['MX204-01', 'MX204-02', 'MX204-03', 'MX204-04'])
  })
})
