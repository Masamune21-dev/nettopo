import { z } from 'zod'

/* ── Nilai dasar ─────────────────────────────────────────────────────────── */

export const SPEEDS = ['100M', '1G', '2.5G', '10G', '25G', '40G', '100G', '400G'] as const
export type Speed = (typeof SPEEDS)[number]

export const MEDIA = ['rj45', 'sfp', 'sfp+', 'sfp28', 'qsfp+', 'qsfp28', 'qsfp-dd', 'combo'] as const
export type Media = (typeof MEDIA)[number]

export const LINK_MEDIA = ['fiber', 'copper', 'wireless', 'virtual'] as const
export type LinkMedia = (typeof LINK_MEDIA)[number]

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

export const portSchema = z.object({
  id: z.string(),
  name: z.string(),
  speed: z.enum(SPEEDS),
  media: z.enum(MEDIA),
  description: z.string().default(''),
  side: z.enum(['left', 'right']).default('left'),
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
  expanded: z.boolean().default(true),
  parentId: z.string().nullable().default(null),
})

export const endpointSchema = z.object({ deviceId: z.string(), portId: z.string() })

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
  schemaVersion: z.literal(1),
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
export type Device = z.infer<typeof deviceSchema>
export type Endpoint = z.infer<typeof endpointSchema>
export type Link = z.infer<typeof linkSchema>
export type TopoGroup = z.infer<typeof groupSchema>
export type TopoNote = z.infer<typeof noteSchema>
export type Topology = z.infer<typeof topologySchema>

export const SCHEMA_VERSION = 1 as const
