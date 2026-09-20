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

export type Vendor =
  | 'juniper'
  | 'huawei'
  | 'mikrotik'
  | 'zte'
  | 'cisco'
  | 'ubiquiti'
  | 'tplink'
  | 'fiberhome'
  | 'bdcom'
  | 'vsol'
  | 'cdata'
  | 'htb'
  | 'generic'

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
  zte: { label: 'ZTE', color: '#1e40af' },
  cisco: { label: 'Cisco', color: '#0ea5e9' },
  ubiquiti: { label: 'Ubiquiti', color: '#06b6d4' },
  tplink: { label: 'TP-Link', color: '#16a34a' },
  fiberhome: { label: 'FiberHome', color: '#db2777' },
  bdcom: { label: 'BDCOM', color: '#7c3aed' },
  vsol: { label: 'V-SOL', color: '#0d9488' },
  cdata: { label: 'C-Data', color: '#b45309' },
  htb: { label: 'HTB', color: '#eab308' },
  generic: { label: 'Umum', color: '#64748b' },
}

export const VENDOR_ORDER: Vendor[] = [
  'juniper',
  'huawei',
  'mikrotik',
  'zte',
  'cisco',
  'ubiquiti',
  'tplink',
  'fiberhome',
  'bdcom',
  'vsol',
  'cdata',
  'htb',
  'generic',
]

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

  {
    id: 'juniper-mx304',
    vendor: 'juniper',
    series: 'MX',
    model: 'MX304',
    role: 'core-router',
    os: 'junos',
    note: '4× QSFP56-DD 400G + 16× QSFP28 100G',
    ports: [
      { prefix: 'et-0/0/', count: 4, startIndex: 0, speed: '400G', media: 'qsfp-dd', group: 'QSFP-DD 400G' },
      { prefix: 'et-0/1/', count: 16, startIndex: 0, speed: '100G', media: 'qsfp28', group: 'QSFP28 100G' },
    ],
  },
  {
    id: 'juniper-acx7100-32c',
    vendor: 'juniper',
    series: 'ACX',
    model: 'ACX7100-32C',
    role: 'metro-switch',
    os: 'junos',
    note: 'Metro/agregasi — 32× QSFP28 100G',
    ports: [
      { prefix: 'et-0/0/', count: 32, startIndex: 0, speed: '100G', media: 'qsfp28', group: 'QSFP28 100G' },
    ],
  },
  {
    id: 'juniper-qfx5120-48y',
    vendor: 'juniper',
    series: 'QFX',
    model: 'QFX5120-48Y',
    role: 'metro-switch',
    os: 'junos',
    note: '48× SFP28 25G + 8× QSFP28 100G',
    ports: [
      { prefix: 'xe-0/0/', count: 48, startIndex: 0, speed: '25G', media: 'sfp28', group: 'SFP28 25G' },
      { prefix: 'et-0/0/', count: 8, startIndex: 48, speed: '100G', media: 'qsfp28', group: 'QSFP28 100G' },
    ],
  },
  {
    id: 'juniper-ex4600-40f',
    vendor: 'juniper',
    series: 'EX',
    model: 'EX4600-40F',
    role: 'metro-switch',
    os: 'junos',
    note: '24× SFP+ 10G + 4× QSFP+ 40G',
    ports: [
      { prefix: 'xe-0/0/', count: 24, startIndex: 0, speed: '10G', media: 'sfp+', group: 'SFP+ 10G' },
      { prefix: 'et-0/0/', count: 4, startIndex: 24, speed: '40G', media: 'qsfp+', group: 'QSFP+ 40G' },
    ],
  },
  {
    id: 'juniper-ex4300-48t',
    vendor: 'juniper',
    series: 'EX',
    model: 'EX4300-48T',
    role: 'access-switch',
    os: 'junos',
    note: '48× GE RJ45 + 4× QSFP+ 40G',
    ports: [
      { prefix: 'ge-0/0/', count: 48, startIndex: 0, speed: '1G', media: 'rj45', group: 'GE RJ45' },
      { prefix: 'et-0/1/', count: 4, startIndex: 0, speed: '40G', media: 'qsfp+', group: 'QSFP+ uplink' },
    ],
  },
  {
    id: 'juniper-srx4100',
    vendor: 'juniper',
    series: 'SRX',
    model: 'SRX4100',
    role: 'firewall',
    os: 'junos',
    note: '8× SFP+ 10G',
    ports: [
      { prefix: 'xe-0/0/', count: 8, startIndex: 0, speed: '10G', media: 'sfp+', group: 'SFP+ 10G' },
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

  {
    id: 'huawei-ne8000-m8',
    vendor: 'huawei',
    series: 'NE8000',
    model: 'NE8000 M8',
    role: 'bng',
    os: 'vrp',
    note: 'BNG — contoh 8× 100GE + 24× 10GE',
    ports: [
      { prefix: '100GE0/1/', count: 8, startIndex: 0, speed: '100G', media: 'qsfp28', group: '100GE' },
      { prefix: '10GE0/2/', count: 24, startIndex: 0, speed: '10G', media: 'sfp+', group: '10GE' },
    ],
  },
  {
    id: 'huawei-ne40e-m2k',
    vendor: 'huawei',
    series: 'NE40E',
    model: 'NE40E-M2K',
    role: 'core-router',
    os: 'vrp',
    note: 'Contoh 4× 100GE + 20× 10GE',
    ports: [
      { prefix: '100GE0/1/', count: 4, startIndex: 0, speed: '100G', media: 'qsfp28', group: '100GE' },
      { prefix: '10GE0/2/', count: 20, startIndex: 0, speed: '10G', media: 'sfp+', group: '10GE' },
    ],
  },
  {
    id: 'huawei-ce8850-64cq',
    vendor: 'huawei',
    series: 'CloudEngine',
    model: 'CE8850-64CQ',
    role: 'ssw',
    os: 'vrp',
    note: 'Spine — 64× QSFP28 100G',
    ports: [
      { prefix: '100GE1/0/', count: 64, startIndex: 1, speed: '100G', media: 'qsfp28', group: '100GE' },
    ],
  },
  {
    id: 'huawei-s5731-h48t4xc',
    vendor: 'huawei',
    series: 'S5700',
    model: 'S5731-H48T4XC',
    role: 'access-switch',
    os: 'vrp',
    note: '48× GE RJ45 + 4× SFP+ 10G',
    ports: [
      { prefix: 'GE0/0/', count: 48, startIndex: 1, speed: '1G', media: 'rj45', group: 'GE RJ45' },
      { prefix: 'XGE0/0/', count: 4, startIndex: 1, speed: '10G', media: 'sfp+', group: 'Uplink SFP+' },
    ],
  },
  {
    id: 'huawei-s5720-52x-si',
    vendor: 'huawei',
    series: 'S5700',
    model: 'S5720-52X-SI',
    role: 'access-switch',
    os: 'vrp',
    note: '48× GE RJ45 + 4× SFP+ 10G',
    ports: [
      { prefix: 'GE0/0/', count: 48, startIndex: 1, speed: '1G', media: 'rj45', group: 'GE RJ45' },
      { prefix: 'XGE0/0/', count: 4, startIndex: 1, speed: '10G', media: 'sfp+', group: 'Uplink SFP+' },
    ],
  },
  {
    id: 'huawei-ma5800-x7',
    vendor: 'huawei',
    series: 'MA5800',
    model: 'MA5800-X7 (OLT)',
    role: 'olt',
    os: 'vrp',
    note: 'OLT GPON — contoh 2 board 16 PON + uplink 10GE',
    ports: [
      { prefix: 'GPON0/1/', count: 16, startIndex: 0, speed: '2.5G', media: 'sfp', group: 'PON board 1' },
      { prefix: 'GPON0/2/', count: 16, startIndex: 0, speed: '2.5G', media: 'sfp', group: 'PON board 2' },
      { prefix: 'XGE0/9/', count: 4, startIndex: 0, speed: '10G', media: 'sfp+', group: 'Uplink' },
    ],
  },
  {
    id: 'huawei-ma5608t',
    vendor: 'huawei',
    series: 'MA5600',
    model: 'MA5608T (OLT)',
    role: 'olt',
    os: 'vrp',
    note: 'OLT GPON kecil — 16 PON + uplink 10GE',
    ports: [
      { prefix: 'GPON0/0/', count: 8, startIndex: 0, speed: '2.5G', media: 'sfp', group: 'PON slot 0' },
      { prefix: 'GPON0/1/', count: 8, startIndex: 0, speed: '2.5G', media: 'sfp', group: 'PON slot 1' },
      { prefix: 'XGE0/2/', count: 2, startIndex: 0, speed: '10G', media: 'sfp+', group: 'Uplink' },
    ],
  },

  {
    id: 'huawei-ma5800-x15',
    vendor: 'huawei',
    series: 'MA5800',
    model: 'MA5800-X15 (OLT)',
    role: 'olt',
    os: 'vrp',
    note: 'OLT besar - contoh 3 board 16 PON + uplink 10GE dan 100GE',
    ports: [
      { prefix: 'GPON0/1/', count: 16, startIndex: 0, speed: '2.5G', media: 'sfp', group: 'PON board 1' },
      { prefix: 'GPON0/2/', count: 16, startIndex: 0, speed: '2.5G', media: 'sfp', group: 'PON board 2' },
      { prefix: 'GPON0/3/', count: 16, startIndex: 0, speed: '2.5G', media: 'sfp', group: 'PON board 3' },
      { prefix: 'XGE0/9/', count: 4, startIndex: 0, speed: '10G', media: 'sfp+', group: 'Uplink 10GE' },
      { prefix: '100GE0/10/', count: 2, startIndex: 0, speed: '100G', media: 'qsfp28', group: 'Uplink 100GE' },
    ],
  },
  {
    id: 'huawei-ma5800-x2',
    vendor: 'huawei',
    series: 'MA5800',
    model: 'MA5800-X2 (OLT)',
    role: 'olt',
    os: 'vrp',
    note: 'OLT ringkas - contoh 2 board 16 PON + uplink 10GE',
    ports: [
      { prefix: 'GPON0/1/', count: 16, startIndex: 0, speed: '2.5G', media: 'sfp', group: 'PON board 1' },
      { prefix: 'GPON0/2/', count: 16, startIndex: 0, speed: '2.5G', media: 'sfp', group: 'PON board 2' },
      { prefix: 'XGE0/0/', count: 4, startIndex: 0, speed: '10G', media: 'sfp+', group: 'Uplink' },
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
    id: 'huawei-s6730-h48x6c',
    vendor: 'huawei',
    series: 'S6730',
    model: 'S6730-H48X6C',
    role: 'ssw',
    os: 'vrp',
    note: 'SSW — 48× SFP+ 10G + 6× QSFP28 100G',
    ports: [
      { prefix: '10GE1/0/', count: 48, startIndex: 1, speed: '10G', media: 'sfp+', group: '10GE' },
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
  {
    id: 'huawei-ce6865e-48s8cq',
    vendor: 'huawei',
    series: 'CloudEngine',
    model: 'CE6865E-48S8CQ',
    role: 'ssw',
    os: 'vrp',
    note: 'SSW — 48× SFP28 25G + 8× QSFP28 100G (varian E)',
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
    id: 'mikrotik-ccr1036-12g-4s',
    vendor: 'mikrotik',
    series: 'CCR1036',
    model: 'CCR1036-12G-4S',
    role: 'router',
    os: 'routeros',
    note: '12× GE + 4× SFP 1G',
    ports: [
      { prefix: 'ether', count: 12, startIndex: 1, speed: '1G', media: 'rj45', group: 'Ethernet' },
      { prefix: 'sfp', count: 4, startIndex: 1, speed: '1G', media: 'sfp', group: 'SFP 1G' },
    ],
  },
  {
    id: 'mikrotik-rb4011igs',
    vendor: 'mikrotik',
    series: 'RB4011',
    model: 'RB4011iGS+',
    role: 'router',
    os: 'routeros',
    note: '10× GE + 1× SFP+ 10G',
    ports: [
      { prefix: 'ether', count: 10, startIndex: 1, speed: '1G', media: 'rj45', group: 'Ethernet' },
      { prefix: 'sfp-sfpplus', count: 1, startIndex: 1, speed: '10G', media: 'sfp+', group: 'SFP+ 10G' },
    ],
  },
  {
    id: 'mikrotik-rb3011uias',
    vendor: 'mikrotik',
    series: 'RB3011',
    model: 'RB3011UiAS-RM',
    role: 'router',
    os: 'routeros',
    note: '10× GE + 1× SFP 1G',
    ports: [
      { prefix: 'ether', count: 10, startIndex: 1, speed: '1G', media: 'rj45', group: 'Ethernet' },
      { prefix: 'sfp', count: 1, startIndex: 1, speed: '1G', media: 'sfp', group: 'SFP 1G' },
    ],
  },
  {
    id: 'mikrotik-hex-s',
    vendor: 'mikrotik',
    series: 'hEX',
    model: 'hEX S (RB760iGS)',
    role: 'router',
    os: 'routeros',
    note: '5× GE + 1× SFP 1G',
    ports: [
      { prefix: 'ether', count: 5, startIndex: 1, speed: '1G', media: 'rj45', group: 'Ethernet' },
      { prefix: 'sfp', count: 1, startIndex: 1, speed: '1G', media: 'sfp', group: 'SFP 1G' },
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

  {
    id: 'mikrotik-ccr2004-16g-2sp',
    vendor: 'mikrotik',
    series: 'CCR2004',
    model: 'CCR2004-16G-2S+',
    role: 'router',
    os: 'routeros',
    note: '16× GE + 2× SFP+ 10G',
    ports: [
      { prefix: 'ether', count: 16, startIndex: 1, speed: '1G', media: 'rj45', group: 'Ethernet' },
      { prefix: 'sfp-sfpplus', count: 2, startIndex: 1, speed: '10G', media: 'sfp+', group: 'SFP+ 10G' },
    ],
  },
  {
    id: 'mikrotik-ccr1016-12g',
    vendor: 'mikrotik',
    series: 'CCR1016',
    model: 'CCR1016-12G',
    role: 'router',
    os: 'routeros',
    note: '12× GE',
    ports: [{ prefix: 'ether', count: 12, startIndex: 1, speed: '1G', media: 'rj45', group: 'Ethernet' }],
  },
  {
    id: 'mikrotik-rb5009',
    vendor: 'mikrotik',
    series: 'RB5009',
    model: 'RB5009UG+S+',
    role: 'router',
    os: 'routeros',
    note: '7× GE + 1× 2.5G + 1× SFP+ 10G',
    ports: [
      { prefix: 'ether', count: 7, startIndex: 1, speed: '1G', media: 'rj45', group: 'Ethernet' },
      { prefix: 'ether', count: 1, startIndex: 8, speed: '2.5G', media: 'rj45', group: '2.5G' },
      { prefix: 'sfp-sfpplus', count: 1, startIndex: 1, speed: '10G', media: 'sfp+', group: 'SFP+ 10G' },
    ],
  },
  {
    id: 'mikrotik-l009',
    vendor: 'mikrotik',
    series: 'L009',
    model: 'L009UiGS-RM',
    role: 'router',
    os: 'routeros',
    note: '8× GE + 1× SFP 1G',
    ports: [
      { prefix: 'ether', count: 8, startIndex: 1, speed: '1G', media: 'rj45', group: 'Ethernet' },
      { prefix: 'sfp', count: 1, startIndex: 1, speed: '1G', media: 'sfp', group: 'SFP' },
    ],
  },
  {
    id: 'mikrotik-crs312-4cp-8xg',
    vendor: 'mikrotik',
    series: 'CRS312',
    model: 'CRS312-4C+8XG',
    role: 'switch',
    os: 'routeros',
    note: '8× 10G RJ45 + 4× combo 10G',
    ports: [
      { prefix: 'ether', count: 8, startIndex: 1, speed: '10G', media: 'rj45', group: '10G RJ45' },
      { prefix: 'combo', count: 4, startIndex: 1, speed: '10G', media: 'combo', group: 'Combo 10G' },
    ],
  },
  {
    id: 'mikrotik-crs328-24p-4sp',
    vendor: 'mikrotik',
    series: 'CRS328',
    model: 'CRS328-24P-4S+',
    role: 'access-switch',
    os: 'routeros',
    note: '24× GE PoE + 4× SFP+ 10G',
    ports: [
      { prefix: 'ether', count: 24, startIndex: 1, speed: '1G', media: 'rj45', group: 'GE PoE' },
      { prefix: 'sfp-sfpplus', count: 4, startIndex: 1, speed: '10G', media: 'sfp+', group: 'SFP+ 10G' },
    ],
  },

  /* ── MikroTik CRS ──────────────────────────────────────────────────────── */
  {
    id: 'mikrotik-crs305-1g-4sp',
    vendor: 'mikrotik',
    series: 'CRS305',
    model: 'CRS305-1G-4S+',
    role: 'switch',
    os: 'routeros',
    note: '1× GE + 4× SFP+ 10G',
    ports: [
      { prefix: 'ether', count: 1, startIndex: 1, speed: '1G', media: 'rj45', group: 'Ethernet' },
      { prefix: 'sfp-sfpplus', count: 4, startIndex: 1, speed: '10G', media: 'sfp+', group: 'SFP+ 10G' },
    ],
  },
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

  /* ── ZTE ───────────────────────────────────────────────────────────────── */
  {
    id: 'zte-c320',
    vendor: 'zte',
    series: 'ZXA10',
    model: 'C320 (OLT)',
    role: 'olt',
    os: 'other',
    note: 'OLT GPON 2 slot — contoh 16 PON + uplink 10GE',
    ports: [
      { prefix: 'gpon-olt_1/1/', count: 8, startIndex: 1, speed: '2.5G', media: 'sfp', group: 'PON slot 1' },
      { prefix: 'gpon-olt_1/2/', count: 8, startIndex: 1, speed: '2.5G', media: 'sfp', group: 'PON slot 2' },
      { prefix: 'xgei_1/3/', count: 2, startIndex: 1, speed: '10G', media: 'sfp+', group: 'Uplink 10GE' },
      { prefix: 'gei_1/3/', count: 4, startIndex: 3, speed: '1G', media: 'sfp', group: 'Uplink GE' },
    ],
  },
  {
    id: 'zte-c300',
    vendor: 'zte',
    series: 'ZXA10',
    model: 'C300 (OLT)',
    role: 'olt',
    os: 'other',
    note: 'OLT GPON chassis - contoh 2 board 16 PON + uplink 10GE',
    ports: [
      { prefix: 'gpon-olt_1/1/', count: 16, startIndex: 1, speed: '2.5G', media: 'sfp', group: 'PON slot 1' },
      { prefix: 'gpon-olt_1/2/', count: 16, startIndex: 1, speed: '2.5G', media: 'sfp', group: 'PON slot 2' },
      { prefix: 'xgei_1/9/', count: 2, startIndex: 1, speed: '10G', media: 'sfp+', group: 'Uplink 10GE' },
      { prefix: 'gei_1/9/', count: 4, startIndex: 3, speed: '1G', media: 'sfp', group: 'Uplink GE' },
    ],
  },
  {
    id: 'zte-c650',
    vendor: 'zte',
    series: 'ZXA10',
    model: 'C650 (OLT)',
    role: 'olt',
    os: 'other',
    note: 'OLT kapasitas tinggi - contoh 2 board 16 PON + uplink 100GE',
    ports: [
      { prefix: 'gpon-olt_1/1/', count: 16, startIndex: 1, speed: '2.5G', media: 'sfp', group: 'PON slot 1' },
      { prefix: 'gpon-olt_1/2/', count: 16, startIndex: 1, speed: '2.5G', media: 'sfp', group: 'PON slot 2' },
      { prefix: 'cei_1/9/', count: 4, startIndex: 1, speed: '100G', media: 'qsfp28', group: 'Uplink 100GE' },
    ],
  },
  {
    id: 'zte-c600',
    vendor: 'zte',
    series: 'ZXA10',
    model: 'C600 (OLT)',
    role: 'olt',
    os: 'other',
    note: 'OLT besar — contoh 32 PON + uplink 100GE',
    ports: [
      { prefix: 'gpon-olt_1/1/', count: 16, startIndex: 1, speed: '2.5G', media: 'sfp', group: 'PON slot 1' },
      { prefix: 'gpon-olt_1/2/', count: 16, startIndex: 1, speed: '2.5G', media: 'sfp', group: 'PON slot 2' },
      { prefix: 'cei_1/9/', count: 4, startIndex: 1, speed: '100G', media: 'qsfp28', group: 'Uplink 100GE' },
    ],
  },
  {
    id: 'zte-zxr10-5960',
    vendor: 'zte',
    series: 'ZXR10',
    model: 'ZXR10 5960-56DM',
    role: 'metro-switch',
    os: 'other',
    note: '48× SFP+ 10G + 6× QSFP28 100G',
    ports: [
      { prefix: 'xgei-0/1/1/', count: 48, startIndex: 1, speed: '10G', media: 'sfp+', group: 'SFP+ 10G' },
      { prefix: 'cei-0/1/1/', count: 6, startIndex: 49, speed: '100G', media: 'qsfp28', group: 'QSFP28 100G' },
    ],
  },

  /* ── Cisco ─────────────────────────────────────────────────────────────── */
  {
    id: 'cisco-asr920-24sz-m',
    vendor: 'cisco',
    series: 'ASR920',
    model: 'ASR920-24SZ-M',
    role: 'metro-switch',
    os: 'other',
    note: 'Metro — 24× SFP 1G + 4× SFP+ 10G',
    ports: [
      { prefix: 'GigabitEthernet0/0/', count: 24, startIndex: 1, speed: '1G', media: 'sfp', group: 'GE SFP' },
      { prefix: 'TenGigabitEthernet0/0/', count: 4, startIndex: 25, speed: '10G', media: 'sfp+', group: 'SFP+ 10G' },
    ],
  },
  {
    id: 'cisco-asr1001-x',
    vendor: 'cisco',
    series: 'ASR1000',
    model: 'ASR1001-X',
    role: 'router',
    os: 'other',
    note: '6× GE + 2× SFP+ 10G',
    ports: [
      { prefix: 'GigabitEthernet0/0/', count: 6, startIndex: 0, speed: '1G', media: 'sfp', group: 'GE' },
      { prefix: 'TenGigabitEthernet0/0/', count: 2, startIndex: 6, speed: '10G', media: 'sfp+', group: 'SFP+ 10G' },
    ],
  },
  {
    id: 'cisco-c9300-48p',
    vendor: 'cisco',
    series: 'Catalyst',
    model: 'Catalyst C9300-48P',
    role: 'access-switch',
    os: 'other',
    note: '48× GE PoE + uplink modul 10G',
    ports: [
      { prefix: 'GigabitEthernet1/0/', count: 48, startIndex: 1, speed: '1G', media: 'rj45', group: 'GE PoE' },
      { prefix: 'TenGigabitEthernet1/1/', count: 4, startIndex: 1, speed: '10G', media: 'sfp+', group: 'Uplink' },
    ],
  },

  {
    id: 'mikrotik-crs504-4xq',
    vendor: 'mikrotik',
    series: 'CRS504',
    model: 'CRS504-4XQ',
    role: 'metro-switch',
    os: 'routeros',
    note: '4× QSFP28 100G',
    ports: [
      { prefix: 'qsfp28-', suffix: '-1', count: 4, startIndex: 1, speed: '100G', media: 'qsfp28', group: 'QSFP28 100G' },
    ],
  },
  {
    id: 'mikrotik-crs518-16xs-2xq',
    vendor: 'mikrotik',
    series: 'CRS518',
    model: 'CRS518-16XS-2XQ',
    role: 'metro-switch',
    os: 'routeros',
    note: '16× SFP28 25G + 2× QSFP28 100G',
    ports: [
      { prefix: 'sfp28-', count: 16, startIndex: 1, speed: '25G', media: 'sfp28', group: 'SFP28 25G' },
      { prefix: 'qsfp28-', suffix: '-1', count: 2, startIndex: 1, speed: '100G', media: 'qsfp28', group: 'QSFP28 100G' },
    ],
  },
  {
    id: 'mikrotik-crs326-24sp-2qp',
    vendor: 'mikrotik',
    series: 'CRS326',
    model: 'CRS326-24S+2Q+',
    role: 'metro-switch',
    os: 'routeros',
    note: '24× SFP+ 10G + 2× QSFP+ 40G',
    ports: [
      { prefix: 'sfp-sfpplus', count: 24, startIndex: 1, speed: '10G', media: 'sfp+', group: 'SFP+ 10G' },
      { prefix: 'qsfpplus', suffix: '-1', count: 2, startIndex: 1, speed: '40G', media: 'qsfp+', group: 'QSFP+ 40G' },
    ],
  },
  {
    id: 'mikrotik-crs310-8gp-2sp',
    vendor: 'mikrotik',
    series: 'CRS310',
    model: 'CRS310-8G+2S+',
    role: 'access-switch',
    os: 'routeros',
    note: '8× 2.5G RJ45 + 2× SFP+ 10G',
    ports: [
      { prefix: 'ether', count: 8, startIndex: 1, speed: '2.5G', media: 'rj45', group: '2.5G RJ45' },
      { prefix: 'sfp-sfpplus', count: 2, startIndex: 1, speed: '10G', media: 'sfp+', group: 'SFP+ 10G' },
    ],
  },
  {
    id: 'mikrotik-crs112-8g-4s',
    vendor: 'mikrotik',
    series: 'CRS112',
    model: 'CRS112-8G-4S',
    role: 'switch',
    os: 'routeros',
    note: '8× GE + 4× SFP 1G',
    ports: [
      { prefix: 'ether', count: 8, startIndex: 1, speed: '1G', media: 'rj45', group: 'Ethernet' },
      { prefix: 'sfp', count: 4, startIndex: 1, speed: '1G', media: 'sfp', group: 'SFP 1G' },
    ],
  },
  {
    id: 'mikrotik-css326-24g-2sp',
    vendor: 'mikrotik',
    series: 'CSS326',
    model: 'CSS326-24G-2S+',
    role: 'access-switch',
    os: 'routeros',
    note: '24× GE + 2× SFP+ 10G',
    ports: [
      { prefix: 'ether', count: 24, startIndex: 1, speed: '1G', media: 'rj45', group: 'Ethernet' },
      { prefix: 'sfp-sfpplus', count: 2, startIndex: 1, speed: '10G', media: 'sfp+', group: 'SFP+ 10G' },
    ],
  },
  {
    id: 'mikrotik-css610-8g-2sp',
    vendor: 'mikrotik',
    series: 'CSS610',
    model: 'CSS610-8G-2S+',
    role: 'access-switch',
    os: 'routeros',
    note: '8× GE + 2× SFP+ 10G',
    ports: [
      { prefix: 'ether', count: 8, startIndex: 1, speed: '1G', media: 'rj45', group: 'Ethernet' },
      { prefix: 'sfp-sfpplus', count: 2, startIndex: 1, speed: '10G', media: 'sfp+', group: 'SFP+ 10G' },
    ],
  },
  {
    id: 'mikrotik-netpower-16p',
    vendor: 'mikrotik',
    series: 'netPower',
    model: 'netPower 16P (CSS610-16P-2S+)',
    role: 'access-switch',
    os: 'routeros',
    note: '16× GE PoE-out + 2× SFP+ 10G',
    ports: [
      { prefix: 'ether', count: 16, startIndex: 1, speed: '1G', media: 'rj45', group: 'GE PoE' },
      { prefix: 'sfp-sfpplus', count: 2, startIndex: 1, speed: '10G', media: 'sfp+', group: 'SFP+ 10G' },
    ],
  },

  /* ── Ubiquiti ──────────────────────────────────────────────────────────── */
  {
    id: 'ubiquiti-er-4',
    vendor: 'ubiquiti',
    series: 'EdgeRouter',
    model: 'EdgeRouter 4 (ER-4)',
    role: 'router',
    os: 'other',
    note: '3× GE + 1× SFP 1G',
    ports: [
      { prefix: 'eth', count: 3, startIndex: 0, speed: '1G', media: 'rj45', group: 'Ethernet' },
      { prefix: 'eth', count: 1, startIndex: 3, speed: '1G', media: 'sfp', group: 'SFP 1G' },
    ],
  },
  {
    id: 'ubiquiti-er-x',
    vendor: 'ubiquiti',
    series: 'EdgeRouter',
    model: 'EdgeRouter X (ER-X)',
    role: 'router',
    os: 'other',
    note: '5× GE',
    ports: [{ prefix: 'eth', count: 5, startIndex: 0, speed: '1G', media: 'rj45', group: 'Ethernet' }],
  },
  {
    id: 'ubiquiti-usw-pro-24-poe',
    vendor: 'ubiquiti',
    series: 'UniFi',
    model: 'UniFi USW-Pro-24-PoE',
    role: 'access-switch',
    os: 'other',
    note: '24× GE PoE + 2× SFP+ 10G',
    ports: [
      { prefix: 'port', count: 24, startIndex: 1, speed: '1G', media: 'rj45', group: 'GE PoE' },
      { prefix: 'sfpplus', count: 2, startIndex: 1, speed: '10G', media: 'sfp+', group: 'SFP+ 10G' },
    ],
  },
  {
    id: 'ubiquiti-usw-aggregation',
    vendor: 'ubiquiti',
    series: 'UniFi',
    model: 'UniFi USW-Aggregation',
    role: 'switch',
    os: 'other',
    note: '8× SFP+ 10G',
    ports: [
      { prefix: 'sfpplus', count: 8, startIndex: 1, speed: '10G', media: 'sfp+', group: 'SFP+ 10G' },
    ],
  },
  {
    id: 'ubiquiti-u6-pro',
    vendor: 'ubiquiti',
    series: 'UniFi',
    model: 'UniFi AP U6-Pro',
    role: 'cpe',
    os: 'other',
    note: 'Access point Wi-Fi 6, uplink 1× GE',
    ports: [{ prefix: 'eth', count: 1, startIndex: 0, speed: '1G', media: 'rj45', group: 'Uplink' }],
  },

  /* ── TP-Link ───────────────────────────────────────────────────────────── */
  {
    id: 'tplink-tl-sg3428x',
    vendor: 'tplink',
    series: 'Omada',
    model: 'TL-SG3428X',
    role: 'access-switch',
    os: 'other',
    note: '24× GE + 4× SFP+ 10G',
    ports: [
      { prefix: 'Gi1/0/', count: 24, startIndex: 1, speed: '1G', media: 'rj45', group: 'GE' },
      { prefix: 'Te1/0/', count: 4, startIndex: 1, speed: '10G', media: 'sfp+', group: 'SFP+ 10G' },
    ],
  },
  {
    id: 'tplink-tl-sg2210p',
    vendor: 'tplink',
    series: 'Omada',
    model: 'TL-SG2210P',
    role: 'access-switch',
    os: 'other',
    note: '8× GE PoE + 2× SFP 1G',
    ports: [
      { prefix: 'Gi1/0/', count: 8, startIndex: 1, speed: '1G', media: 'rj45', group: 'GE PoE' },
      { prefix: 'Gi1/0/', count: 2, startIndex: 9, speed: '1G', media: 'sfp', group: 'SFP 1G' },
    ],
  },
  {
    id: 'tplink-mc220l',
    vendor: 'tplink',
    series: 'MediaConverter',
    model: 'MC220L',
    role: 'converter',
    os: 'other',
    note: 'Gigabit, 1× slot SFP + 1× RJ45',
    ports: [
      { prefix: 'sfp', count: 1, startIndex: 1, speed: '1G', media: 'sfp', group: 'Fiber' },
      { prefix: 'utp', count: 1, startIndex: 1, speed: '1G', media: 'rj45', group: 'Tembaga' },
    ],
  },

  /* -- FiberHome ---------------------------------------------------------- */
  {
    id: 'fiberhome-an5516-01',
    vendor: 'fiberhome',
    series: 'AN5516',
    model: 'AN5516-01 (OLT)',
    role: 'olt',
    os: 'other',
    note: 'OLT GPON chassis - contoh 2 board 16 PON + uplink 10GE (penamaan port contoh, cocokkan dengan perangkat Anda)',
    ports: [
      { prefix: 'gpon1/1/', count: 16, startIndex: 1, speed: '2.5G', media: 'sfp', group: 'PON slot 1' },
      { prefix: 'gpon1/2/', count: 16, startIndex: 1, speed: '2.5G', media: 'sfp', group: 'PON slot 2' },
      { prefix: 'xge1/9/', count: 2, startIndex: 1, speed: '10G', media: 'sfp+', group: 'Uplink 10GE' },
      { prefix: 'ge1/9/', count: 4, startIndex: 3, speed: '1G', media: 'sfp', group: 'Uplink GE' },
    ],
  },
  {
    id: 'fiberhome-an5506-04',
    vendor: 'fiberhome',
    series: 'AN5506',
    model: 'AN5506-04-F (ONT)',
    role: 'cpe',
    os: 'other',
    note: 'ONT GPON pelanggan - 1x PON + 4x LAN',
    ports: [
      { prefix: 'pon', count: 1, startIndex: 1, speed: '2.5G', media: 'sfp', group: 'PON' },
      { prefix: 'lan', count: 4, startIndex: 1, speed: '1G', media: 'rj45', group: 'LAN' },
    ],
  },

  /* -- BDCOM -------------------------------------------------------------- */
  {
    id: 'bdcom-p3310b',
    vendor: 'bdcom',
    series: 'P3310',
    model: 'P3310B (OLT EPON)',
    role: 'olt',
    os: 'other',
    note: 'OLT EPON - 8 PON + uplink GE dan 10GE (penamaan port contoh, cocokkan dengan perangkat Anda)',
    ports: [
      { prefix: 'EPON0/', count: 8, startIndex: 1, speed: '1G', media: 'sfp', group: 'EPON' },
      { prefix: 'GigaEthernet0/', count: 4, startIndex: 1, speed: '1G', media: 'sfp', group: 'Uplink GE' },
      { prefix: 'TGigaEthernet0/', count: 2, startIndex: 1, speed: '10G', media: 'sfp+', group: 'Uplink 10GE' },
    ],
  },
  {
    id: 'bdcom-p3608',
    vendor: 'bdcom',
    series: 'P3608',
    model: 'P3608-2TE (OLT GPON)',
    role: 'olt',
    os: 'other',
    note: 'OLT GPON - 8 PON + uplink GE dan 10GE (penamaan port contoh, cocokkan dengan perangkat Anda)',
    ports: [
      { prefix: 'GPON0/', count: 8, startIndex: 1, speed: '2.5G', media: 'sfp', group: 'GPON' },
      { prefix: 'GigaEthernet0/', count: 4, startIndex: 1, speed: '1G', media: 'sfp', group: 'Uplink GE' },
      { prefix: 'TGigaEthernet0/', count: 2, startIndex: 1, speed: '10G', media: 'sfp+', group: 'Uplink 10GE' },
    ],
  },

  /* -- V-SOL -------------------------------------------------------------- */
  {
    id: 'vsol-v1600d',
    vendor: 'vsol',
    series: 'V1600',
    model: 'V1600D (OLT EPON)',
    role: 'olt',
    os: 'other',
    note: 'OLT EPON ringkas - 4 PON + uplink GE dan 10GE (penamaan port contoh, cocokkan dengan perangkat Anda)',
    ports: [
      { prefix: 'epon0/', count: 4, startIndex: 1, speed: '1G', media: 'sfp', group: 'EPON' },
      { prefix: 'ge0/', count: 4, startIndex: 1, speed: '1G', media: 'rj45', group: 'Uplink GE' },
      { prefix: 'xge0/', count: 2, startIndex: 1, speed: '10G', media: 'sfp+', group: 'Uplink 10GE' },
    ],
  },
  {
    id: 'vsol-v1600g2',
    vendor: 'vsol',
    series: 'V1600',
    model: 'V1600G2 (OLT GPON)',
    role: 'olt',
    os: 'other',
    note: 'OLT GPON ringkas - 2 PON + uplink GE dan 10GE (penamaan port contoh, cocokkan dengan perangkat Anda)',
    ports: [
      { prefix: 'gpon0/', count: 2, startIndex: 1, speed: '2.5G', media: 'sfp', group: 'GPON' },
      { prefix: 'ge0/', count: 4, startIndex: 1, speed: '1G', media: 'rj45', group: 'Uplink GE' },
      { prefix: 'xge0/', count: 2, startIndex: 1, speed: '10G', media: 'sfp+', group: 'Uplink 10GE' },
    ],
  },

  /* -- C-Data ------------------------------------------------------------- */
  {
    id: 'cdata-fd1216s',
    vendor: 'cdata',
    series: 'FD1200',
    model: 'FD1216S (OLT GPON)',
    role: 'olt',
    os: 'other',
    note: 'OLT GPON 16 PON + uplink GE dan 10GE (penamaan port contoh, cocokkan dengan perangkat Anda)',
    ports: [
      { prefix: 'gpon0/', count: 16, startIndex: 1, speed: '2.5G', media: 'sfp', group: 'GPON' },
      { prefix: 'ge0/', count: 4, startIndex: 1, speed: '1G', media: 'sfp', group: 'Uplink GE' },
      { prefix: 'xge0/', count: 2, startIndex: 1, speed: '10G', media: 'sfp+', group: 'Uplink 10GE' },
    ],
  },
  {
    id: 'cdata-fd1104s',
    vendor: 'cdata',
    series: 'FD1100',
    model: 'FD1104S (OLT GPON)',
    role: 'olt',
    os: 'other',
    note: 'OLT GPON 4 PON + uplink GE (penamaan port contoh, cocokkan dengan perangkat Anda)',
    ports: [
      { prefix: 'gpon0/', count: 4, startIndex: 1, speed: '2.5G', media: 'sfp', group: 'GPON' },
      { prefix: 'ge0/', count: 4, startIndex: 1, speed: '1G', media: 'rj45', group: 'Uplink GE' },
    ],
  },

  /* ── HTB — media converter ─────────────────────────────────────────────── */
  {
    id: 'htb-gs-03',
    vendor: 'htb',
    series: 'HTB-GS',
    model: 'HTB-GS-03',
    role: 'converter',
    os: 'other',
    note: 'Gigabit, dua serat (SC), 1× fiber + 1× RJ45',
    ports: [
      { prefix: 'fiber', count: 1, startIndex: 1, speed: '1G', media: 'sfp', group: 'Fiber' },
      { prefix: 'utp', count: 1, startIndex: 1, speed: '1G', media: 'rj45', group: 'Tembaga' },
    ],
  },
  {
    id: 'htb-gs-03-ab',
    vendor: 'htb',
    series: 'HTB-GS',
    model: 'HTB-GS-03 A/B',
    role: 'converter',
    os: 'other',
    note: 'Gigabit, serat tunggal (WDM), dipakai sepasang A dan B',
    ports: [
      { prefix: 'fiber', count: 1, startIndex: 1, speed: '1G', media: 'sfp', group: 'Fiber tunggal' },
      { prefix: 'utp', count: 1, startIndex: 1, speed: '1G', media: 'rj45', group: 'Tembaga' },
    ],
  },
  {
    id: 'htb-1100s',
    vendor: 'htb',
    series: 'HTB-1100',
    model: 'HTB-1100S',
    role: 'converter',
    os: 'other',
    note: '10/100M, dua serat (SC)',
    ports: [
      { prefix: 'fiber', count: 1, startIndex: 1, speed: '100M', media: 'sfp', group: 'Fiber' },
      { prefix: 'utp', count: 1, startIndex: 1, speed: '100M', media: 'rj45', group: 'Tembaga' },
    ],
  },
  {
    id: 'htb-3100ab',
    vendor: 'htb',
    series: 'HTB-3100',
    model: 'HTB-3100 A/B',
    role: 'converter',
    os: 'other',
    note: '10/100M, serat tunggal (WDM), dipakai sepasang A dan B',
    ports: [
      { prefix: 'fiber', count: 1, startIndex: 1, speed: '100M', media: 'sfp', group: 'Fiber tunggal' },
      { prefix: 'utp', count: 1, startIndex: 1, speed: '100M', media: 'rj45', group: 'Tembaga' },
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
    id: 'generic-odc',
    vendor: 'generic',
    series: 'Pasif',
    model: 'ODC (Kabinet)',
    role: 'passive',
    os: 'other',
    note: 'Titik distribusi kabel optik',
    ports: [
      { prefix: 'in', count: 2, startIndex: 1, speed: '2.5G', media: 'sfp', group: 'Feeder' },
      { prefix: 'out', count: 12, startIndex: 1, speed: '2.5G', media: 'sfp', group: 'Distribusi' },
    ],
  },
  {
    id: 'generic-odp',
    vendor: 'generic',
    series: 'Pasif',
    model: 'ODP (Tiang)',
    role: 'passive',
    os: 'other',
    note: 'Titik terminasi ke pelanggan',
    ports: [
      { prefix: 'in', count: 1, startIndex: 1, speed: '2.5G', media: 'sfp', group: 'Masuk' },
      { prefix: 'drop', count: 8, startIndex: 1, speed: '2.5G', media: 'sfp', group: 'Drop core' },
    ],
  },
  {
    id: 'generic-splitter',
    vendor: 'generic',
    series: 'Pasif',
    model: 'Splitter 1:8',
    role: 'passive',
    os: 'other',
    note: 'Pembagi daya optik',
    ports: [
      { prefix: 'in', count: 1, startIndex: 1, speed: '2.5G', media: 'sfp', group: 'Masuk' },
      { prefix: 'out', count: 8, startIndex: 1, speed: '2.5G', media: 'sfp', group: 'Keluar' },
    ],
  },
  {
    id: 'generic-ont',
    vendor: 'generic',
    series: 'Umum',
    model: 'ONT / ONU',
    role: 'cpe',
    os: 'other',
    note: 'Perangkat pelanggan FTTH',
    ports: [
      { prefix: 'pon', count: 1, startIndex: 1, speed: '2.5G', media: 'sfp', group: 'PON' },
      { prefix: 'lan', count: 4, startIndex: 1, speed: '1G', media: 'rj45', group: 'LAN' },
    ],
  },
  {
    id: 'generic-ap',
    vendor: 'generic',
    series: 'Umum',
    model: 'Access Point',
    role: 'cpe',
    os: 'other',
    note: 'Titik akses nirkabel',
    ports: [{ prefix: 'eth', count: 1, startIndex: 1, speed: '2.5G', media: 'rj45', group: 'Uplink' }],
  },
  {
    id: 'generic-media-converter',
    vendor: 'generic',
    series: 'Umum',
    model: 'Media Converter',
    role: 'converter',
    os: 'other',
    note: 'Konverter fiber ke tembaga',
    ports: [
      { prefix: 'sfp', count: 1, startIndex: 1, speed: '1G', media: 'sfp', group: 'Fiber' },
      { prefix: 'eth', count: 1, startIndex: 1, speed: '1G', media: 'rj45', group: 'Tembaga' },
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
