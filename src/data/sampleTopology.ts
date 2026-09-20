import { uid } from '@/lib/id'
import { buildPorts } from '@/lib/ports'
import type { AppEdge, AppNode, DeviceNodeData } from '@/store/types'
import type { LinkKind, LinkMedia, Speed } from '@/types/topology'
import { getModel } from './deviceCatalog'

interface Placed {
  node: AppNode
  data: DeviceNodeData
}

function device(
  modelId: string,
  hostname: string,
  mgmtIp: string,
  site: string,
  x: number,
  y: number,
): Placed {
  const model = getModel(modelId)
  if (!model) throw new Error(`Model ${modelId} tidak ada`)
  const ports = buildPorts(model)
  const data: DeviceNodeData = {
    modelId,
    hostname,
    role: model.role,
    mgmtIp,
    loopback: '',
    site,
    notes: '',
    ports,
    expanded: ports.length <= 16,
  }
  return { node: { id: uid('dev'), type: 'device', position: { x, y }, data }, data }
}

function link(
  a: Placed,
  aPort: string,
  b: Placed,
  bPort: string,
  speed: Speed,
  opts: { kind?: LinkKind; media?: LinkMedia; label?: string; vlans?: string } = {},
): AppEdge {
  const pa = a.data.ports.find((p) => p.name === aPort)
  const pb = b.data.ports.find((p) => p.name === bPort)
  if (!pa || !pb) throw new Error(`Port ${aPort} / ${bPort} tidak ditemukan`)
  return {
    id: uid('lnk'),
    type: 'link',
    source: a.node.id,
    target: b.node.id,
    sourceHandle: pa.id,
    targetHandle: pb.id,
    data: {
      speed,
      media: opts.media ?? 'fiber',
      kind: opts.kind ?? 'single',
      label: opts.label ?? '',
      vlans: opts.vlans ?? '',
      color: null,
    },
  }
}

/** Topologi contoh yang tampil saat aplikasi pertama kali dibuka. */
export function sampleTopology(): { nodes: AppNode[]; edges: AppEdge[]; name: string; site: string } {
  const net = device('generic-internet', 'UPSTREAM-IX', '', '', 420, -140)
  const mx = device('juniper-mx204', 'MX204-CORE-01', '10.10.0.1', 'POP-JKT-1', 380, 20)
  const ssw1 = device('huawei-s6730-h24x6c', 'SSW-JKT-01', '10.10.0.11', 'POP-JKT-1', 120, 300)
  const ssw2 = device('huawei-s6730-h24x6c', 'SSW-JKT-02', '10.10.0.12', 'POP-JKT-1', 660, 300)
  const ccr = device('mikrotik-ccr2004-1g-12sp-2xs', 'CCR2004-DIST-01', '10.10.0.21', 'POP-JKT-1', 390, 640)
  const crs = device('mikrotik-crs309-1g-8sp', 'CRS309-AGG-01', '10.10.0.31', 'JKT-NODE-A', 120, 900)
  const sw = device('huawei-s5731-s24t4x', 'S5731-ACC-01', '10.10.0.41', 'JKT-NODE-A', 660, 900)

  const group: AppNode = {
    id: uid('grp'),
    type: 'group',
    position: { x: 70, y: -30 },
    width: 850,
    height: 830,
    zIndex: -1,
    data: { label: 'POP JKT-1', color: '#6366f1' },
  }

  const nodes: AppNode[] = [group, net.node, mx.node, ssw1.node, ssw2.node, ccr.node, crs.node, sw.node]

  const edges: AppEdge[] = [
    link(net, 'link1', mx, 'et-0/0/0', '100G', { label: 'Transit' }),
    link(mx, 'et-0/0/1', ssw1, '100GE1/0/1', '100G'),
    link(mx, 'et-0/0/2', ssw2, '100GE1/0/1', '100G'),
    link(ssw1, '10GE1/0/1', ccr, 'sfp-sfpplus1', '10G', { kind: 'lacp', label: 'Bundle' }),
    link(ssw2, '10GE1/0/1', ccr, 'sfp-sfpplus2', '10G', { kind: 'backup', label: 'Backup' }),
    link(ccr, 'sfp-sfpplus3', crs, 'sfp-sfpplus1', '10G'),
    link(ccr, 'sfp-sfpplus4', sw, 'XGE0/0/1', '10G', { vlans: '100,200' }),
  ]

  return { nodes, edges, name: 'Contoh — Backbone Jakarta', site: 'POP-JKT-1' }
}
