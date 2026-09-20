import { uid } from '@/lib/id'
import { formatIp, parseCidr, usableRange } from '@/lib/ip'
import { buildPorts, DEFAULT_SWITCHING } from '@/lib/ports'
import { nextTrunkName } from '@/lib/trunks'
import type { AppEdge, AppNode, DeviceNodeData } from '@/store/types'
import type { LinkKind, LinkMedia, Port, Speed, Trunk } from '@/types/topology'
import { type DeviceModel, getModel } from './deviceCatalog'

/**
 * Topologi contoh: jaringan ISP dua POP dengan upstream ganda, core
 * berpasangan, BNG, lapisan agregasi ber-Eth-Trunk, distribusi MikroTik,
 * serta sisi FTTH lengkap dari OLT sampai ONT pelanggan.
 *
 * Contoh ini juga berfungsi sebagai rujukan konfigurasi yang benar: ia dijaga
 * test agar selalu lolos seluruh pemeriksaan tanpa satu pun peringatan —
 * kecepatan kedua ujung cocok, VLAN sepadan, dan setiap link L3 berada dalam
 * satu /30.
 */

interface Placed {
  node: AppNode
  data: DeviceNodeData
  os: DeviceModel['os']
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
    trunks: [],
    expanded: ports.length <= 16,
  }
  return { node: { id: uid('dev'), type: 'device', position: { x, y }, data }, data, os: model.os }
}

const portOf = (d: Placed, name: string): Port => {
  const p = d.data.ports.find((x) => x.name === name)
  if (!p) throw new Error(`Port ${name} tidak ada di ${d.data.hostname}`)
  return p
}

/** Atur link-type / VLAN / IP sebuah port berdasarkan namanya. */
function cfg(d: Placed, portName: string, patch: Partial<Port>): void {
  Object.assign(portOf(d, portName), patch)
}

function trunk(d: Placed, memberNames: string[], patch: Partial<Trunk> = {}): Trunk {
  const t: Trunk = {
    id: uid('trk'),
    name: nextTrunkName(d.os, d.data.trunks),
    mode: 'lacp',
    memberIds: memberNames.map((n) => portOf(d, n).id),
    description: '',
    side: d.data.trunks.length % 2 === 0 ? 'left' : 'right',
    ...DEFAULT_SWITCHING,
    ...patch,
  }
  d.data.trunks.push(t)
  return t
}

interface LinkOpts {
  kind?: LinkKind
  media?: LinkMedia
  label?: string
}

function edge(a: Placed, aHandle: string, b: Placed, bHandle: string, speed: Speed, o: LinkOpts = {}): AppEdge {
  return {
    id: uid('lnk'),
    type: 'link',
    source: a.node.id,
    target: b.node.id,
    sourceHandle: aHandle,
    targetHandle: bHandle,
    data: {
      speed,
      media: o.media ?? 'fiber',
      kind: o.kind ?? 'single',
      label: o.label ?? '',
      vlans: '',
      color: null,
      routing: 'bezier',
      waypoints: [],
    },
  }
}

const link = (a: Placed, ap: string, b: Placed, bp: string, speed: Speed, o?: LinkOpts): AppEdge =>
  edge(a, portOf(a, ap).id, b, portOf(b, bp).id, speed, o)

/**
 * Link L3: kedua ujung diberi alamat host pertama dan terakhir dari satu /30,
 * dihitung dari blok jaringannya supaya tidak ada salah ketik.
 */
function l3(
  a: Placed,
  ap: string,
  b: Placed,
  bp: string,
  speed: Speed,
  network: string,
  o?: LinkOpts,
): AppEdge {
  const cidr = parseCidr(network)
  if (!cidr) throw new Error(`Blok ${network} tidak sah`)
  const { first, last } = usableRange(cidr)
  cfg(a, ap, { linkType: 'routed', ipAddress: `${formatIp(first)}/${cidr.prefix}` })
  cfg(b, bp, { linkType: 'routed', ipAddress: `${formatIp(last)}/${cidr.prefix}` })
  return link(a, ap, b, bp, speed, o)
}

/** VLAN yang dibawa tulang punggung dan lapisan akses. */
const VLAN_BACKBONE = '1,100,200,300,400'
const VLAN_AKSES = '1,100,200,300'
const VLAN_FTTH = '1,100,200'

/** Link trunk VLAN: kedua ujung disetel sama persis agar tidak timpang. */
function vlanLink(
  a: Placed,
  ap: string,
  b: Placed,
  bp: string,
  speed: Speed,
  vlans: string,
  o?: LinkOpts,
): AppEdge {
  const patch: Partial<Port> = { linkType: 'trunk', pvid: 1, allowedVlans: vlans }
  cfg(a, ap, patch)
  cfg(b, bp, patch)
  return link(a, ap, b, bp, speed, o)
}

function group(label: string, color: string, x: number, y: number, w: number, h: number): AppNode {
  return {
    id: uid('grp'),
    type: 'group',
    position: { x, y },
    width: w,
    height: h,
    zIndex: -1,
    data: { label, color },
  }
}

export function sampleTopology(): { nodes: AppNode[]; edges: AppEdge[]; name: string; site: string } {
  /* ── Upstream ──────────────────────────────────────────────────────────── */
  const ix = device('generic-internet', 'IX-JAKARTA', '', '', 260, -260)
  const transit = device('generic-internet', 'TRANSIT-GLOBAL', '', '', 700, -260)

  /* ── POP JKT-1: core, BNG, agregasi ────────────────────────────────────── */
  const core1 = device('juniper-mx204', 'MX204-CORE-01', '10.254.0.1', 'POP-JKT-1', 200, -40)
  const core2 = device('juniper-mx204', 'MX204-CORE-02', '10.254.0.2', 'POP-JKT-1', 700, -40)
  const bng = device('huawei-ne8000-m8', 'NE8000-BNG-01', '10.254.0.3', 'POP-JKT-1', 1180, 190)
  const ssw1 = device('huawei-s6730-h48x6c', 'SSW-JKT-01', '10.254.0.11', 'POP-JKT-1', 160, 220)
  const ssw2 = device('huawei-s6730-h48x6c', 'SSW-JKT-02', '10.254.0.12', 'POP-JKT-1', 680, 220)
  const fw = device('juniper-srx4100', 'FW-MGMT-01', '10.254.0.4', 'POP-JKT-1', -260, 220)
  const nms = device('generic-server', 'SRV-NMS-01', '10.254.0.20', 'POP-JKT-1', -260, 430)

  /* ── POP BDG-1 ─────────────────────────────────────────────────────────── */
  const coreBdg = device('juniper-mx204', 'MX204-BDG-01', '10.254.1.1', 'POP-BDG-1', 1560, -40)
  const sswBdg = device('huawei-s6730-h24x6c', 'SSW-BDG-01', '10.254.1.11', 'POP-BDG-1', 1560, 220)

  /* ── Distribusi & akses ────────────────────────────────────────────────── */
  const distJkt = device('mikrotik-ccr2116-12g-4sp', 'CCR2116-DIST-JKT', '10.254.0.31', 'JKT-NODE-A', 380, 520)
  const aggJkt = device('mikrotik-crs354-48g-4sp2qp', 'CRS354-AGG-JKT', '10.254.0.32', 'JKT-NODE-A', 380, 760)
  const accJkt1 = device('huawei-s5731-s24t4x', 'SW-ACC-JKT-01', '10.254.0.41', 'JKT-NODE-A', 120, 1010)
  const accJkt2 = device('huawei-s5731-s24t4x', 'SW-ACC-JKT-02', '10.254.0.42', 'JKT-NODE-A', 640, 1010)

  const distBdg = device('mikrotik-ccr2116-12g-4sp', 'CCR2116-DIST-BDG', '10.254.1.31', 'BDG-NODE-A', 1560, 520)
  const accBdg = device('mikrotik-crs328-24p-4sp', 'SW-ACC-BDG-01', '10.254.1.41', 'BDG-NODE-A', 1560, 760)

  /* ── FTTH ──────────────────────────────────────────────────────────────── */
  const oltJkt = device('huawei-ma5800-x7', 'OLT-JKT-01', '10.254.0.51', 'POP-JKT-1', 1060, 520)
  const oltBdg = device('zte-c320', 'OLT-BDG-01', '10.254.1.51', 'POP-BDG-1', 1960, 520)
  const odc = device('generic-odc', 'ODC-JKT-A', '', 'JKT-NODE-A', 1060, 760)
  const odp1 = device('generic-odp', 'ODP-JKT-A1', '', 'JKT-NODE-A', 940, 980)
  const odp2 = device('generic-odp', 'ODP-JKT-A2', '', 'JKT-NODE-A', 1220, 980)
  const ont = device('generic-ont', 'ONT-PLG-0001', '', 'JKT-NODE-A', 940, 1200)

  /* ── Agregasi berpasangan (Eth-Trunk / bonding) ────────────────────────── */
  const trunkCfg = { linkType: 'trunk' as const, pvid: 1, allowedVlans: VLAN_BACKBONE }
  const sswPair1 = trunk(ssw1, ['100GE1/0/4', '100GE1/0/5'], trunkCfg)
  const sswPair2 = trunk(ssw2, ['100GE1/0/4', '100GE1/0/5'], trunkCfg)
  const sswDown = trunk(ssw1, ['10GE1/0/3', '10GE1/0/4'], trunkCfg)
  const distUp = trunk(distJkt, ['sfp-sfpplus1', 'sfp-sfpplus2'], trunkCfg)

  /* ── Port pelanggan ────────────────────────────────────────────────────── */
  cfg(accJkt1, 'GE0/0/1', { linkType: 'access', pvid: 100, description: 'Ritel — Toko Mawar' })
  cfg(accJkt1, 'GE0/0/2', { linkType: 'access', pvid: 100, description: 'Ritel — Kos Melati' })
  cfg(accJkt1, 'GE0/0/3', { linkType: 'access', pvid: 200, description: 'Korporat — PT Sejahtera' })
  cfg(accJkt2, 'GE0/0/1', { linkType: 'access', pvid: 300, description: 'CCTV Pemkot' })
  cfg(accBdg, 'ether1', { linkType: 'access', pvid: 100, description: 'Ritel — Warnet Bandung' })
  cfg(ont, 'lan1', { linkType: 'access', pvid: 100, description: 'Pelanggan FTTH' })

  const nodes: AppNode[] = [
    group('POP JKT-1', '#6366f1', -360, -130, 1700, 460),
    group('JKT-NODE-A', '#10b981', 20, 440, 1420, 880),
    group('POP BDG-1', '#a855f7', 1460, -130, 640, 460),
    group('BDG-NODE-A', '#f59e0b', 1460, 440, 640, 460),
    ix.node,
    transit.node,
    core1.node,
    core2.node,
    bng.node,
    ssw1.node,
    ssw2.node,
    fw.node,
    nms.node,
    coreBdg.node,
    sswBdg.node,
    distJkt.node,
    aggJkt.node,
    accJkt1.node,
    accJkt2.node,
    distBdg.node,
    accBdg.node,
    oltJkt.node,
    oltBdg.node,
    odc.node,
    odp1.node,
    odp2.node,
    ont.node,
    {
      id: uid('note'),
      type: 'note',
      position: { x: -360, y: 620 },
      width: 250,
      height: 150,
      data: {
        text:
          'VLAN:\n100 Internet Ritel\n200 Internet Korporat\n300 CCTV\n400 Manajemen\n\n' +
          'Loopback: 10.255.255.0/24\nP2P: 10.255.0.0/16',
        color: '#fde68a',
      },
    },
  ]

  const edges: AppEdge[] = [
    /* Upstream */
    l3(ix, 'link1', core1, 'et-0/0/0', '100G', '103.20.0.0/30', { label: 'IIX Peering' }),
    l3(transit, 'link1', core2, 'et-0/0/0', '100G', '103.20.0.4/30', { label: 'Transit Global' }),

    /* Core berpasangan */
    l3(core1, 'et-0/0/1', core2, 'et-0/0/1', '100G', '10.255.0.0/30', { label: 'Core sync' }),

    /* Core ke agregasi — saling silang untuk ketersediaan */
    l3(core1, 'et-0/0/2', ssw1, '100GE1/0/1', '100G', '10.255.0.4/30'),
    l3(core1, 'et-0/0/3', ssw2, '100GE1/0/1', '100G', '10.255.0.8/30'),
    l3(core2, 'et-0/0/2', ssw1, '100GE1/0/2', '100G', '10.255.0.12/30'),
    l3(core2, 'et-0/0/3', ssw2, '100GE1/0/2', '100G', '10.255.0.16/30'),

    /* BNG */
    l3(bng, '100GE0/1/0', ssw1, '100GE1/0/3', '100G', '10.255.0.20/30'),
    l3(bng, '100GE0/1/1', ssw2, '100GE1/0/3', '100G', '10.255.0.24/30'),

    /* Eth-Trunk antar SSW */
    edge(ssw1, sswPair1.id, ssw2, sswPair2.id, '100G', { kind: 'lacp', label: 'Inter-SSW' }),

    /* Manajemen */
    l3(fw, 'xe-0/0/0', ssw1, '10GE1/0/1', '10G', '10.255.1.0/30', { label: 'Mgmt' }),
    vlanLink(nms, 'nic1', ssw1, '10GE1/0/2', '10G', VLAN_BACKBONE, { label: 'NMS' }),

    /* Jakarta ke Bandung */
    l3(core1, 'xe-0/1/0', coreBdg, 'xe-0/1/0', '10G', '10.255.2.0/30', { label: 'JKT–BDG utama' }),
    l3(core2, 'xe-0/1/0', coreBdg, 'xe-0/1/1', '10G', '10.255.2.4/30', {
      kind: 'backup',
      label: 'JKT–BDG cadangan',
    }),
    l3(coreBdg, 'et-0/0/0', sswBdg, '100GE1/0/1', '100G', '10.255.2.8/30'),

    /* Distribusi Jakarta */
    edge(ssw1, sswDown.id, distJkt, distUp.id, '10G', { kind: 'lacp', label: 'Bundle 2×10G' }),
    vlanLink(ssw2, '10GE1/0/3', distJkt, 'sfp-sfpplus3', '10G', VLAN_BACKBONE, {
      kind: 'backup',
      label: 'Cadangan',
    }),
    vlanLink(distJkt, 'sfp-sfpplus4', aggJkt, 'sfp-sfpplus1', '10G', VLAN_AKSES),
    vlanLink(aggJkt, 'sfp-sfpplus2', accJkt1, 'XGE0/0/1', '10G', VLAN_AKSES),
    vlanLink(aggJkt, 'sfp-sfpplus3', accJkt2, 'XGE0/0/1', '10G', VLAN_AKSES),

    /* Distribusi Bandung */
    vlanLink(sswBdg, '10GE1/0/1', distBdg, 'sfp-sfpplus1', '10G', VLAN_BACKBONE),
    vlanLink(sswBdg, '10GE1/0/2', distBdg, 'sfp-sfpplus2', '10G', VLAN_BACKBONE, {
      kind: 'backup',
      label: 'Cadangan',
    }),
    vlanLink(distBdg, 'sfp-sfpplus3', accBdg, 'sfp-sfpplus1', '10G', VLAN_AKSES),

    /* FTTH — uplink OLT */
    vlanLink(ssw1, '10GE1/0/5', oltJkt, 'XGE0/9/0', '10G', VLAN_FTTH),
    vlanLink(ssw2, '10GE1/0/5', oltJkt, 'XGE0/9/1', '10G', VLAN_FTTH, {
      kind: 'backup',
      label: 'Cadangan',
    }),
    vlanLink(sswBdg, '10GE1/0/3', oltBdg, 'xgei_1/3/1', '10G', VLAN_FTTH),

    /* FTTH — jaringan pasif */
    link(oltJkt, 'GPON0/1/0', odc, 'in1', '2.5G', { label: 'Feeder' }),
    link(odc, 'out1', odp1, 'in1', '2.5G'),
    link(odc, 'out2', odp2, 'in1', '2.5G'),
    link(odp1, 'drop1', ont, 'pon1', '2.5G', { label: 'Drop core' }),
  ]

  return {
    nodes,
    edges,
    name: 'Contoh — Backbone Jakarta & Bandung',
    site: 'POP-JKT-1',
  }
}
