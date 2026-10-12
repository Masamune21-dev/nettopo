import { getModel } from '@/data/deviceCatalog'
import { buildPorts } from '@/lib/ports'
import type { AppEdge, AppNode, DeviceNode, DeviceNodeData } from '@/store/types'
import { isDeviceNode } from '@/store/types'
import type { Port } from '@/types/topology'
import { dialectIdFor } from './index'
import { dialectById, makeCtx, runLine, type World } from './runtime'
import type { SessionState } from './types'

/** Perangkat bantu test: membangun topologi kecil dan menjalankan sesi CLI di atasnya. */

export function device(world: World, modelId: string, hostname: string): string {
  const m = getModel(modelId)
  if (!m) throw new Error(`model ${modelId}`)
  const id = `dev_${hostname}`
  const data: DeviceNodeData = {
    modelId,
    hostname,
    role: m.role,
    mgmtIp: '',
    loopback: '',
    site: '',
    notes: '',
    ports: buildPorts(m),
    trunks: [],
    staticRoutes: [],
    expanded: true,
  }
  world.nodes = [...world.nodes, { id, type: 'device', position: { x: 0, y: 0 }, data }]
  return id
}

export function dev(world: World, id: string): DeviceNode {
  const n = world.nodes.find((x) => x.id === id)
  if (!n || !isDeviceNode(n)) throw new Error(`device ${id}`)
  return n
}

export function byHost(world: World, host: string): DeviceNode {
  const n = world.nodes.find((x) => isDeviceNode(x) && x.data.hostname === host)
  if (!n || !isDeviceNode(n)) throw new Error(`host ${host}`)
  return n
}

export function port(world: World, id: string, name: string): Port {
  const p = dev(world, id).data.ports.find((x) => x.name === name)
  if (!p) throw new Error(`port ${name} di ${id}`)
  return p
}

export function setPort(world: World, id: string, name: string, patch: Partial<Port>): void {
  world.nodes = world.nodes.map((n): AppNode =>
    n.id === id && isDeviceNode(n)
      ? { ...n, data: { ...n.data, ports: n.data.ports.map((p) => (p.name === name ? { ...p, ...patch } : p)) } }
      : n,
  )
}

export function cable(world: World, a: string, ap: string, b: string, bp: string): void {
  const edge: AppEdge = {
    id: `lnk_${a}_${ap}_${b}_${bp}`,
    type: 'link',
    source: a,
    target: b,
    sourceHandle: port(world, a, ap).id,
    targetHandle: port(world, b, bp).id,
    data: { speed: '1G', media: 'fiber', kind: 'single', label: '', vlans: '', color: null, routing: 'bezier', waypoints: [] },
  }
  world.edges = [...world.edges, edge]
}

export interface Session {
  /** Jalankan satu baris; keluaran (termasuk yang mengalir) digabung jadi teks. */
  run: (line: string) => string
  prompt: () => string
  state: () => SessionState
  data: () => DeviceNodeData
}

export function session(world: World, deviceId: string): Session {
  const d = dev(world, deviceId)
  const id = dialectIdFor(getModel(d.data.modelId), d.data.role)
  if (!id) throw new Error('tanpa CLI')
  const dialect = dialectById(id)
  const blank: SessionState = { mode: '', path: [], pending: [], vars: {} }
  let state = dialect.init(makeCtx(blank, deviceId, world)!)
  const ctx = () => makeCtx(state, deviceId, world)!
  return {
    run: (line) => {
      const o = runLine(dialect, ctx(), line)
      state = o.state
      if (o.data) {
        const data = o.data
        world.nodes = world.nodes.map((n) => (n.id === deviceId && isDeviceNode(n) ? { ...n, data } : n))
      }
      const text: string[] = []
      for (const l of [...o.out, ...(o.stream?.lines ?? [])]) {
        if (l.append && text.length) text[text.length - 1] += l.text
        else text.push(l.text)
      }
      return text.join('\n')
    },
    prompt: () => (state.confirm ? state.confirm.prompt : dialect.prompt(ctx())),
    state: () => state,
    data: () => dev(world, deviceId).data,
  }
}
