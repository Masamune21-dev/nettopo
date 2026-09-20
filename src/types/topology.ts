import { z } from 'zod'

/* ── Nilai dasar ─────────────────────────────────────────────────────────── */

export const SPEEDS = ['100M', '1G', '2.5G', '10G', '25G', '40G', '100G', '400G'] as const
export type Speed = (typeof SPEEDS)[number]

export const MEDIA = ['rj45', 'sfp', 'sfp+', 'sfp28', 'qsfp+', 'qsfp28', 'qsfp-dd', 'combo'] as const
export type Media = (typeof MEDIA)[number]

export const LINK_MEDIA = ['fiber', 'copper', 'wireless', 'virtual'] as const
export type LinkMedia = (typeof LINK_MEDIA)[number]

/**
 * Mode VLAN pada interface (Huawei: `port link-type`). Hati-hati: "trunk" di
 * sini berarti port bertag banyak VLAN — beda dengan Eth-Trunk/bonding yang
 * merupakan agregasi port.
 */
export const PORT_MODES = ['none', 'access', 'trunk', 'hybrid', 'routed'] as const
export type PortMode = (typeof PORT_MODES)[number]

export const PORT_MODE_LABEL: Record<PortMode, string> = {
  none: 'Belum diatur',
  access: 'Access (1 VLAN)',
  trunk: 'Trunk (tagged)',
  hybrid: 'Hybrid',
  routed: 'Routed / L3',
}

/** Singkatan yang tampil sebagai badge kecil di node. */
export const PORT_MODE_BADGE: Record<PortMode, string> = {
  none: '',
  access: 'A',
  trunk: 'T',
  hybrid: 'H',
  routed: 'L3',
}

export const PORT_MODE_COLOR: Record<PortMode, string> = {
  none: '#64748b',
  access: '#10b981',
  trunk: '#3b82f6',
  hybrid: '#f59e0b',
  routed: '#a855f7',
}

export const TRUNK_MODES = ['lacp', 'static'] as const
export type TrunkMode = (typeof TRUNK_MODES)[number]

/** Cara kabel digambar di kanvas. */
export const ROUTING_MODES = ['bezier', 'smoothstep', 'straight'] as const
export type RoutingMode = (typeof ROUTING_MODES)[number]

export const ROUTING_LABEL: Record<RoutingMode, string> = {
  bezier: 'Lengkung',
  smoothstep: 'Siku (orthogonal)',
  straight: 'Lurus',
}

export const LINK_KINDS = ['single', 'lacp', 'backup'] as const
export type LinkKind = (typeof LINK_KINDS)[number]

export const ROLES = [
  'core-router',
  'bng',
  'ssw',
  'metro-switch',
  'access-switch',
  'router',
  'switch',
  'firewall',
  'server',
  'olt',
  'internet',
  'cpe',
  'converter',
  'passive',
] as const
export type DeviceRole = (typeof ROLES)[number]

export const ROLE_LABEL: Record<DeviceRole, string> = {
  'core-router': 'Core Router',
  bng: 'BNG',
  ssw: 'SSW',
  'metro-switch': 'Metro / Distribusi',
  'access-switch': 'Access Switch',
  router: 'Router',
  switch: 'Switch',
  firewall: 'Firewall',
  server: 'Server',
  olt: 'OLT',
  internet: 'Internet / Upstream',
  cpe: 'CPE / Pelanggan',
  converter: 'Media Converter',
  passive: 'Pasif (ODP/ODC)',
}

/** Warna aksen per role — dipakai node, badge palette, dan minimap. */
export const ROLE_COLOR: Record<DeviceRole, string> = {
  'core-router': '#6366f1',
  bng: '#8b5cf6',
  ssw: '#a855f7',
  'metro-switch': '#06b6d4',
  'access-switch': '#10b981',
  router: '#f59e0b',
  switch: '#0ea5e9',
  firewall: '#ef4444',
  server: '#64748b',
  olt: '#f97316',
  internet: '#3b82f6',
  cpe: '#94a3b8',
  converter: '#14b8a6',
  passive: '#78716c',
}

/** Warna kabel mengikuti kecepatan link. */
export const SPEED_COLOR: Record<Speed, string> = {
  '100M': '#94a3b8',
  '1G': '#64748b',
  '2.5G': '#0ea5e9',
  '10G': '#10b981',
  '25G': '#f59e0b',
  '40G': '#f97316',
  '100G': '#ef4444',
  '400G': '#a855f7',
}

export const SPEED_WIDTH: Record<Speed, number> = {
  '100M': 1.2,
  '1G': 1.5,
  '2.5G': 1.8,
  '10G': 2.2,
  '25G': 2.6,
  '40G': 3,
  '100G': 3.6,
  '400G': 4.2,
}

/* ── Skema (zod) ─────────────────────────────────────────────────────────── */

/**
 * Konfigurasi L2/L3 yang berlaku sama untuk port fisik maupun Eth-Trunk —
 * di perangkat asli pun Eth-Trunk punya link-type dan VLAN sendiri.
 */
const switchingFields = {
  /** Huawei: `port link-type`. Dinamai linkType agar tidak tertukar dengan mode LACP pada trunk. */
  linkType: z.enum(PORT_MODES).default('none'),
  /** VLAN access, atau native/PVID untuk trunk & hybrid. */
  pvid: z.number().int().min(1).max(4094).nullable().default(null),
  /** Daftar VLAN bertag, gaya CLI: "100,200,300-310". */
  allowedVlans: z.string().default(''),
  /** Hybrid: VLAN yang keluar tanpa tag. */
  untaggedVlans: z.string().default(''),
  /** Mode routed: alamat IP interface, mis. "10.0.0.1/30". */
  ipAddress: z.string().default(''),
}

export const portSchema = z.object({
  id: z.string(),
  name: z.string(),
  speed: z.enum(SPEEDS),
  media: z.enum(MEDIA),
  description: z.string().default(''),
  side: z.enum(['left', 'right']).default('left'),
  ...switchingFields,
})

/**
 * Link aggregation pada satu perangkat: Eth-Trunk (Huawei), ae (Juniper),
 * bond (MikroTik). Anggotanya adalah port fisik milik perangkat itu sendiri —
 * sisi lawan punya trunk-nya sendiri dengan anggota sendiri.
 */
export const trunkSchema = z.object({
  id: z.string(),
  name: z.string(),
  mode: z.enum(TRUNK_MODES).default('lacp'),
  memberIds: z.array(z.string()),
  description: z.string().default(''),
  side: z.enum(['left', 'right']).default('left'),
  ...switchingFields,
})

export const deviceSchema = z.object({
  id: z.string(),
  modelId: z.string(),
  hostname: z.string(),
  role: z.enum(ROLES),
  mgmtIp: z.string().default(''),
  loopback: z.string().default(''),
  site: z.string().default(''),
  notes: z.string().default(''),
  position: z.object({ x: z.number(), y: z.number() }),
  ports: z.array(portSchema),
  trunks: z.array(trunkSchema).default([]),
  expanded: z.boolean().default(true),
  parentId: z.string().nullable().default(null),
})

/** Ujung link menunjuk port fisik, atau sebuah trunk (bonding). */
export const endpointSchema = z.object({
  deviceId: z.string(),
  portId: z.string().default(''),
  trunkId: z.string().nullable().default(null),
})

export const linkSchema = z.object({
  id: z.string(),
  a: endpointSchema,
  b: endpointSchema,
  speed: z.enum(SPEEDS),
  media: z.enum(LINK_MEDIA).default('fiber'),
  kind: z.enum(LINK_KINDS).default('single'),
  label: z.string().default(''),
  vlans: z.string().default(''),
  color: z.string().nullable().default(null),
  routing: z.enum(ROUTING_MODES).default('bezier'),
  /** Titik belok yang digeser manual; kosong berarti kabel lurus otomatis. */
  waypoints: z.array(z.object({ x: z.number(), y: z.number() })).default([]),
})

export const groupSchema = z.object({
  id: z.string(),
  label: z.string(),
  color: z.string().default('#6366f1'),
  position: z.object({ x: z.number(), y: z.number() }),
  size: z.object({ width: z.number(), height: z.number() }),
})

export const noteSchema = z.object({
  id: z.string(),
  text: z.string(),
  color: z.string().default('#fde68a'),
  position: z.object({ x: z.number(), y: z.number() }),
  size: z.object({ width: z.number(), height: z.number() }),
})

export const topologySchema = z.object({
  // Versi 1 (tanpa trunk) tetap diterima: field baru terisi nilai bawaan.
  schemaVersion: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
  project: z.object({
    id: z.string(),
    name: z.string(),
    site: z.string().default(''),
    updatedAt: z.string(),
  }),
  devices: z.array(deviceSchema),
  links: z.array(linkSchema),
  groups: z.array(groupSchema).default([]),
  notes: z.array(noteSchema).default([]),
})

export type Port = z.infer<typeof portSchema>
export type Trunk = z.infer<typeof trunkSchema>
export type Device = z.infer<typeof deviceSchema>
export type Endpoint = z.infer<typeof endpointSchema>
export type Link = z.infer<typeof linkSchema>
export type Waypoint = { x: number; y: number }
export type TopoGroup = z.infer<typeof groupSchema>
export type TopoNote = z.infer<typeof noteSchema>
export type Topology = z.infer<typeof topologySchema>

export const SCHEMA_VERSION = 4 as const
export const SUPPORTED_SCHEMA_VERSIONS = [1, 2, 3, 4] as const
