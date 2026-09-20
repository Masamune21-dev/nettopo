import type { DeviceRole, Media, Speed } from '@/types/topology'

/**
 * Katalog perangkat — SATU-SATUNYA tempat spesifikasi hardware didefinisikan.
 * Menambah model baru cukup menambah satu entri di sini; UI, palette, dan
 * generator port otomatis mengikuti.
 *
 * Catatan: jumlah/nama port di bawah adalah konfigurasi umum tiap model.
 * Chassis modular (MX240/480/960/10003) jelas tergantung MPC/MIC terpasang,
 * jadi yang dipakai di sini adalah konfigurasi contoh — silakan sesuaikan
 * lewat tabel port di panel Inspector.
 */

export type Vendor = 'juniper' | 'huawei' | 'mikrotik' | 'generic'

export interface PortTemplate {
  /** Awalan nama interface, mis. "ge-0/0/", "sfp-sfpplus", "10GE1/0/" */
  prefix: string
  /** Akhiran opsional, mis. "-1" untuk qsfpplus1-1 */
  suffix?: string
  count: number
  /** Juniper mulai dari 0; Huawei & MikroTik mulai dari 1 */
  startIndex: number
  speed: Speed
  media: Media
  /** Label kelompok port di UI, mis. "SFP+ 10G" */
  group: string
}

export interface DeviceModel {
  id: string
  vendor: Vendor
  series: string
  model: string
  role: DeviceRole
  os: 'junos' | 'vrp' | 'routeros' | 'other'
  /** Keterangan singkat yang muncul di tooltip palette */
  note?: string
  ports: PortTemplate[]
}

export const VENDOR_META: Record<Vendor, { label: string; color: string }> = {
  juniper: { label: 'Juniper', color: '#84b135' },
  huawei: { label: 'Huawei', color: '#e02020' },
  mikrotik: { label: 'MikroTik', color: '#f97316' },
  generic: { label: 'Umum', color: '#64748b' },
}

export const VENDOR_ORDER: Vendor[] = ['juniper', 'huawei', 'mikrotik', 'generic']

export const DEVICE_CATALOG: DeviceModel[] = [
  /* ── Juniper MX ────────────────────────────────────────────────────────── */
  {
    id: 'juniper-mx204',
    vendor: 'juniper',
    series: 'MX',
    model: 'MX204',
    role: 'core-router',
    os: 'junos',
    note: '4× QSFP28 100G + 8× SFP+ 10G',
    ports: [
      { prefix: 'et-0/0/', count: 4, startIndex: 0, speed: '100G', media: 'qsfp28', group: 'QSFP28 100G' },
      { prefix: 'xe-0/1/', count: 8, startIndex: 0, speed: '10G', media: 'sfp+', group: 'SFP+ 10G' },
    ],
  },
  {
    id: 'juniper-mx104',
    vendor: 'juniper',
    series: 'MX',
    model: 'MX104',
    role: 'core-router',
    os: 'junos',
    note: '4× SFP+ 10G fixed + MIC 1G (contoh)',
    ports: [
      { prefix: 'xe-2/0/', count: 4, startIndex: 0, speed: '10G', media: 'sfp+', group: 'SFP+ 10G (fixed)' },
      { prefix: 'ge-1/0/', count: 20, startIndex: 0, speed: '1G', media: 'sfp', group: 'MIC 1G' },
    ],
  },
  {
    id: 'juniper-mx240',
    vendor: 'juniper',
    series: 'MX',
    model: 'MX240',
    role: 'core-router',
    os: 'junos',
    note: 'Chassis modular — contoh 2× MPC 10G',
    ports: [
      { prefix: 'xe-0/0/', count: 10, startIndex: 0, speed: '10G', media: 'sfp+', group: 'MPC slot 0' },
      { prefix: 'xe-1/0/', count: 10, startIndex: 0, speed: '10G', media: 'sfp+', group: 'MPC slot 1' },
    ],
  },
  {
    id: 'juniper-mx480',
    vendor: 'juniper',
    series: 'MX',
    model: 'MX480',
    role: 'core-router',
    os: 'junos',
    note: 'Chassis modular — contoh 2× MPC 10G + 1× MPC 100G',
    ports: [
      { prefix: 'xe-0/0/', count: 10, startIndex: 0, speed: '10G', media: 'sfp+', group: 'MPC slot 0' },
      { prefix: 'xe-1/0/', count: 10, startIndex: 0, speed: '10G', media: 'sfp+', group: 'MPC slot 1' },
      { prefix: 'et-2/0/', count: 4, startIndex: 0, speed: '100G', media: 'qsfp28', group: 'MPC slot 2' },
    ],
  },
  {
    id: 'juniper-mx960',
    vendor: 'juniper',
    series: 'MX',
    model: 'MX960',
    role: 'core-router',
    os: 'junos',
    note: 'Chassis modular — contoh 3× MPC 10G + 1× MPC 100G',
    ports: [
      { prefix: 'xe-0/0/', count: 10, startIndex: 0, speed: '10G', media: 'sfp+', group: 'MPC slot 0' },
      { prefix: 'xe-1/0/', count: 10, startIndex: 0, speed: '10G', media: 'sfp+', group: 'MPC slot 1' },
      { prefix: 'xe-2/0/', count: 10, startIndex: 0, speed: '10G', media: 'sfp+', group: 'MPC slot 2' },
      { prefix: 'et-3/0/', count: 4, startIndex: 0, speed: '100G', media: 'qsfp28', group: 'MPC slot 3' },
    ],
  },
  {
    id: 'juniper-mx10003',
    vendor: 'juniper',
    series: 'MX',
    model: 'MX10003',
    role: 'core-router',
    os: 'junos',
    note: 'Contoh 2× LMIC 100G',
    ports: [
      { prefix: 'et-0/0/', count: 12, startIndex: 0, speed: '100G', media: 'qsfp28', group: 'LMIC 0' },
      { prefix: 'et-1/0/', count: 12, startIndex: 0, speed: '100G', media: 'qsfp28', group: 'LMIC 1' },
    ],
  },

  /* ── Huawei — akses / agregasi ─────────────────────────────────────────── */
  {
    id: 'huawei-s5731-s24t4x',
    vendor: 'huawei',
    series: 'S5700',
    model: 'S5731-S24T4X',
    role: 'access-switch',
    os: 'vrp',
    note: '24× GE RJ45 + 4× SFP+ 10G',
    ports: [
      { prefix: 'GE0/0/', count: 24, startIndex: 1, speed: '1G', media: 'rj45', group: 'GE RJ45' },
      { prefix: 'XGE0/0/', count: 4, startIndex: 1, speed: '10G', media: 'sfp+', group: 'Uplink SFP+' },
    ],
  },
  {
    id: 'huawei-s5731-h24p4xc',
    vendor: 'huawei',
    series: 'S5700',
    model: 'S5731-H24P4XC',
    role: 'access-switch',
    os: 'vrp',
    note: '24× GE PoE + 4× SFP+ 10G',
    ports: [
      { prefix: 'GE0/0/', count: 24, startIndex: 1, speed: '1G', media: 'rj45', group: 'GE PoE' },
      { prefix: 'XGE0/0/', count: 4, startIndex: 1, speed: '10G', media: 'sfp+', group: 'Uplink SFP+' },
    ],
  },
  {
    id: 'huawei-s5720-28x-si',
    vendor: 'huawei',
    series: 'S5700',
    model: 'S5720-28X-SI',
    role: 'access-switch',
    os: 'vrp',
    note: '24× GE RJ45 + 4× SFP+ 10G',
    ports: [
      { prefix: 'GE0/0/', count: 24, startIndex: 1, speed: '1G', media: 'rj45', group: 'GE RJ45' },
      { prefix: 'XGE0/0/', count: 4, startIndex: 1, speed: '10G', media: 'sfp+', group: 'Uplink SFP+' },
    ],
  },
  {
    id: 'huawei-s6720-30c-ei',
    vendor: 'huawei',
    series: 'S6700',
    model: 'S6720-30C-EI-24S',
    role: 'metro-switch',
    os: 'vrp',
    note: '24× SFP+ 10G + 2× QSFP+ 40G',
    ports: [
      { prefix: 'XGE0/0/', count: 24, startIndex: 1, speed: '10G', media: 'sfp+', group: 'SFP+ 10G' },
      { prefix: '40GE0/0/', count: 2, startIndex: 1, speed: '40G', media: 'qsfp+', group: 'QSFP+ 40G' },
    ],
  },

  /* ── Huawei — SSW / service switch ─────────────────────────────────────── */
  {
    id: 'huawei-s6730-h24x6c',
    vendor: 'huawei',
    series: 'S6730',
    model: 'S6730-H24X6C',
    role: 'ssw',
    os: 'vrp',
    note: 'SSW — 24× SFP+ 10G + 6× QSFP28 100G',
    ports: [
      { prefix: '10GE1/0/', count: 24, startIndex: 1, speed: '10G', media: 'sfp+', group: '10GE' },
      { prefix: '100GE1/0/', count: 6, startIndex: 1, speed: '100G', media: 'qsfp28', group: '100GE uplink' },
    ],
  },
  {
    id: 'huawei-ce6881-48s6cq',
    vendor: 'huawei',
    series: 'CloudEngine',
    model: 'CE6881-48S6CQ',
    role: 'ssw',
    os: 'vrp',
    note: 'SSW — 48× SFP28 25G + 6× QSFP28 100G',
    ports: [
      { prefix: '25GE1/0/', count: 48, startIndex: 1, speed: '25G', media: 'sfp28', group: '25GE' },
      { prefix: '100GE1/0/', count: 6, startIndex: 1, speed: '100G', media: 'qsfp28', group: '100GE uplink' },
    ],
  },
  {
    id: 'huawei-ce6865-48s8cq',
    vendor: 'huawei',
    series: 'CloudEngine',
    model: 'CE6865-48S8CQ',
    role: 'ssw',
    os: 'vrp',
    note: 'SSW — 48× SFP28 25G + 8× QSFP28 100G',
    ports: [
      { prefix: '25GE1/0/', count: 48, startIndex: 1, speed: '25G', media: 'sfp28', group: '25GE' },
      { prefix: '100GE1/0/', count: 8, startIndex: 1, speed: '100G', media: 'qsfp28', group: '100GE uplink' },
    ],
  },

  /* ── MikroTik CCR ──────────────────────────────────────────────────────── */
  {
    id: 'mikrotik-ccr2004-1g-12sp-2xs',
    vendor: 'mikrotik',
    series: 'CCR2004',
    model: 'CCR2004-1G-12S+2XS',
    role: 'router',
    os: 'routeros',
    note: '1× GE + 12× SFP+ 10G + 2× SFP28 25G',
    ports: [
      { prefix: 'ether', count: 1, startIndex: 1, speed: '1G', media: 'rj45', group: 'Ethernet' },
      { prefix: 'sfp-sfpplus', count: 12, startIndex: 1, speed: '10G', media: 'sfp+', group: 'SFP+ 10G' },
      { prefix: 'sfp28-', count: 2, startIndex: 1, speed: '25G', media: 'sfp28', group: 'SFP28 25G' },
    ],
  },
  {
    id: 'mikrotik-ccr2116-12g-4sp',
    vendor: 'mikrotik',
    series: 'CCR2116',
    model: 'CCR2116-12G-4S+',
    role: 'router',
    os: 'routeros',
    note: '12× GE + 4× SFP+ 10G',
    ports: [
      { prefix: 'ether', count: 12, startIndex: 1, speed: '1G', media: 'rj45', group: 'Ethernet' },
      { prefix: 'sfp-sfpplus', count: 4, startIndex: 1, speed: '10G', media: 'sfp+', group: 'SFP+ 10G' },
    ],
  },
  {
    id: 'mikrotik-ccr2216-1g-12xs-2xq',
    vendor: 'mikrotik',
    series: 'CCR2216',
    model: 'CCR2216-1G-12XS-2XQ',
    role: 'router',
    os: 'routeros',
    note: '1× GE + 12× SFP28 25G + 2× QSFP28 100G',
    ports: [
      { prefix: 'ether', count: 1, startIndex: 1, speed: '1G', media: 'rj45', group: 'Ethernet' },
      { prefix: 'sfp28-', count: 12, startIndex: 1, speed: '25G', media: 'sfp28', group: 'SFP28 25G' },
      { prefix: 'qsfp28-', suffix: '-1', count: 2, startIndex: 1, speed: '100G', media: 'qsfp28', group: 'QSFP28 100G' },
    ],
  },
  {
    id: 'mikrotik-ccr1036-8g-2sp',
    vendor: 'mikrotik',
    series: 'CCR1036',
    model: 'CCR1036-8G-2S+',
    role: 'router',
    os: 'routeros',
    note: '8× GE + 2× SFP+ 10G',
    ports: [
      { prefix: 'ether', count: 8, startIndex: 1, speed: '1G', media: 'rj45', group: 'Ethernet' },
      { prefix: 'sfp-sfpplus', count: 2, startIndex: 1, speed: '10G', media: 'sfp+', group: 'SFP+ 10G' },
    ],
  },
  {
    id: 'mikrotik-ccr1009-7g-1c-1sp',
    vendor: 'mikrotik',
    series: 'CCR1009',
    model: 'CCR1009-7G-1C-1S+',
    role: 'router',
    os: 'routeros',
    note: '7× GE + 1× combo + 1× SFP+ 10G',
    ports: [
      { prefix: 'ether', count: 7, startIndex: 1, speed: '1G', media: 'rj45', group: 'Ethernet' },
      { prefix: 'combo', count: 1, startIndex: 1, speed: '1G', media: 'combo', group: 'Combo' },
      { prefix: 'sfp-sfpplus', count: 1, startIndex: 1, speed: '10G', media: 'sfp+', group: 'SFP+ 10G' },
    ],
  },
  {
    id: 'mikrotik-ccr1072-1g-8sp',
    vendor: 'mikrotik',
    series: 'CCR1072',
    model: 'CCR1072-1G-8S+',
    role: 'router',
    os: 'routeros',
    note: '1× GE + 8× SFP+ 10G',
    ports: [
      { prefix: 'ether', count: 1, startIndex: 1, speed: '1G', media: 'rj45', group: 'Ethernet' },
      { prefix: 'sfp-sfpplus', count: 8, startIndex: 1, speed: '10G', media: 'sfp+', group: 'SFP+ 10G' },
    ],
  },

  /* ── MikroTik CRS ──────────────────────────────────────────────────────── */
  {
    id: 'mikrotik-crs309-1g-8sp',
    vendor: 'mikrotik',
    series: 'CRS309',
    model: 'CRS309-1G-8S+',
    role: 'switch',
    os: 'routeros',
    note: '1× GE + 8× SFP+ 10G',
    ports: [
      { prefix: 'ether', count: 1, startIndex: 1, speed: '1G', media: 'rj45', group: 'Ethernet' },
      { prefix: 'sfp-sfpplus', count: 8, startIndex: 1, speed: '10G', media: 'sfp+', group: 'SFP+ 10G' },
    ],
  },
  {
    id: 'mikrotik-crs317-1g-16sp',
    vendor: 'mikrotik',
    series: 'CRS317',
    model: 'CRS317-1G-16S+',
    role: 'switch',
    os: 'routeros',
    note: '1× GE + 16× SFP+ 10G',
    ports: [
      { prefix: 'ether', count: 1, startIndex: 1, speed: '1G', media: 'rj45', group: 'Ethernet' },
      { prefix: 'sfp-sfpplus', count: 16, startIndex: 1, speed: '10G', media: 'sfp+', group: 'SFP+ 10G' },
    ],
  },
  {
    id: 'mikrotik-crs326-24g-2sp',
    vendor: 'mikrotik',
    series: 'CRS326',
    model: 'CRS326-24G-2S+',
    role: 'access-switch',
    os: 'routeros',
    note: '24× GE + 2× SFP+ 10G',
    ports: [
      { prefix: 'ether', count: 24, startIndex: 1, speed: '1G', media: 'rj45', group: 'Ethernet' },
      { prefix: 'sfp-sfpplus', count: 2, startIndex: 1, speed: '10G', media: 'sfp+', group: 'SFP+ 10G' },
    ],
  },
  {
    id: 'mikrotik-crs354-48g-4sp2qp',
    vendor: 'mikrotik',
    series: 'CRS354',
    model: 'CRS354-48G-4S+2Q+',
    role: 'access-switch',
    os: 'routeros',
    note: '48× GE + 4× SFP+ 10G + 2× QSFP+ 40G',
    ports: [
      { prefix: 'ether', count: 48, startIndex: 1, speed: '1G', media: 'rj45', group: 'Ethernet' },
      { prefix: 'sfp-sfpplus', count: 4, startIndex: 1, speed: '10G', media: 'sfp+', group: 'SFP+ 10G' },
      { prefix: 'qsfpplus', suffix: '-1', count: 2, startIndex: 1, speed: '40G', media: 'qsfp+', group: 'QSFP+ 40G' },
    ],
  },
  {
    id: 'mikrotik-crs310-1g-5s-4sp',
    vendor: 'mikrotik',
    series: 'CRS310',
    model: 'CRS310-1G-5S-4S+',
    role: 'switch',
    os: 'routeros',
    note: '1× GE + 5× SFP 1G + 4× SFP+ 10G',
    ports: [
      { prefix: 'ether', count: 1, startIndex: 1, speed: '1G', media: 'rj45', group: 'Ethernet' },
      { prefix: 'sfp', count: 5, startIndex: 1, speed: '1G', media: 'sfp', group: 'SFP 1G' },
      { prefix: 'sfp-sfpplus', count: 4, startIndex: 1, speed: '10G', media: 'sfp+', group: 'SFP+ 10G' },
    ],
  },

  /* ── Umum / generik ────────────────────────────────────────────────────── */
  {
    id: 'generic-internet',
    vendor: 'generic',
    series: 'Umum',
    model: 'Internet / Upstream',
    role: 'internet',
    os: 'other',
    note: 'Awan upstream / IX / transit',
    ports: [{ prefix: 'link', count: 2, startIndex: 1, speed: '100G', media: 'qsfp28', group: 'Uplink' }],
  },
  {
    id: 'generic-router',
    vendor: 'generic',
    series: 'Umum',
    model: 'Router',
    role: 'router',
    os: 'other',
    ports: [{ prefix: 'port', count: 8, startIndex: 1, speed: '1G', media: 'rj45', group: 'Port' }],
  },
  {
    id: 'generic-switch',
    vendor: 'generic',
    series: 'Umum',
    model: 'Switch',
    role: 'switch',
    os: 'other',
    ports: [{ prefix: 'port', count: 12, startIndex: 1, speed: '1G', media: 'rj45', group: 'Port' }],
  },
  {
    id: 'generic-firewall',
    vendor: 'generic',
    series: 'Umum',
    model: 'Firewall',
    role: 'firewall',
    os: 'other',
    ports: [{ prefix: 'port', count: 6, startIndex: 1, speed: '10G', media: 'sfp+', group: 'Port' }],
  },
  {
    id: 'generic-server',
    vendor: 'generic',
    series: 'Umum',
    model: 'Server',
    role: 'server',
    os: 'other',
    ports: [{ prefix: 'nic', count: 4, startIndex: 1, speed: '10G', media: 'sfp+', group: 'NIC' }],
  },
  {
    id: 'generic-olt',
    vendor: 'generic',
    series: 'Umum',
    model: 'OLT',
    role: 'olt',
    os: 'other',
    ports: [
      { prefix: 'uplink', count: 4, startIndex: 1, speed: '10G', media: 'sfp+', group: 'Uplink' },
      { prefix: 'pon', count: 8, startIndex: 1, speed: '1G', media: 'sfp', group: 'PON' },
    ],
  },
  {
    id: 'generic-cpe',
    vendor: 'generic',
    series: 'Umum',
    model: 'CPE / ONT',
    role: 'cpe',
    os: 'other',
    ports: [{ prefix: 'port', count: 2, startIndex: 1, speed: '1G', media: 'rj45', group: 'Port' }],
  },
]

export const CATALOG_BY_ID: Record<string, DeviceModel> = Object.fromEntries(
  DEVICE_CATALOG.map((m) => [m.id, m]),
)

export function getModel(modelId: string): DeviceModel | undefined {
  return CATALOG_BY_ID[modelId]
}
