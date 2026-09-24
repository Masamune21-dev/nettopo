import { getModel } from '@/data/deviceCatalog'
import { ifaceSummary } from '@/lib/iface'
import { summarizeTrunk } from '@/lib/trunks'
import type { Device, Endpoint, Topology } from '@/types/topology'
import { downloadText } from './download'

/**
 * Satu sel CSV. Nilai berawalan = + - @ (atau tab/CR) diawali petik tunggal
 * supaya Excel/Sheets tidak menjalankannya sebagai rumus — isinya bisa berasal
 * dari berkas JSON impor yang tidak dikenal.
 */
export function cell(value: unknown): string {
  let s = String(value ?? '')
  if (typeof value === 'string' && /^[=+\-@\t\r]/.test(s)) s = `'${s}`
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

const toCsv = (rows: unknown[][]) => rows.map((r) => r.map(cell).join(',')).join('\n')

/** Rekap perangkat — untuk BOM / inventaris. */
export function devicesCsv(topo: Topology): string {
  return toCsv([
    [
      'hostname',
      'vendor',
      'model',
      'role',
      'site',
      'mgmt_ip',
      'loopback',
      'jumlah_port',
      'jumlah_trunk',
      'trunk',
      'catatan',
    ],
    ...topo.devices.map((d) => {
      const m = getModel(d.modelId)
      return [
        d.hostname,
        m?.vendor ?? '',
        m?.model ?? d.modelId,
        d.role,
        d.site,
        d.mgmtIp,
        d.loopback,
        d.ports.length,
        d.trunks.length,
        d.trunks.map((t) => `${t.name}(${t.memberIds.length})`).join(' '),
        d.notes,
      ]
    }),
  ])
}

/**
 * Rekap link — untuk dokumentasi kapasitas. Ujung yang berupa trunk
 * dituliskan nama trunk-nya beserta daftar port anggota dan bandwidth total.
 */
export function linksCsv(topo: Topology): string {
  const byId = new Map(topo.devices.map((d) => [d.id, d]))

  const side = (end: Endpoint) => {
    const device: Device | undefined = byId.get(end.deviceId)
    const trunk = end.trunkId ? device?.trunks.find((t) => t.id === end.trunkId) : undefined
    if (trunk && device) {
      const s = summarizeTrunk(trunk, device.ports)
      return {
        host: device.hostname,
        iface: trunk.name,
        members: trunk.memberIds
          .map((id) => device.ports.find((p) => p.id === id)?.name)
          .filter(Boolean)
          .join(' '),
        capacity: s.label,
        config: ifaceSummary(trunk),
      }
    }
    const port = device?.ports.find((p) => p.id === end.portId)
    return {
      host: device?.hostname ?? '',
      iface: port?.name ?? '',
      members: '',
      capacity: port?.speed ?? '',
      config: port ? ifaceSummary(port) : '',
    }
  }

  return toCsv([
    [
      'a_hostname',
      'a_interface',
      'a_anggota',
      'b_hostname',
      'b_interface',
      'b_anggota',
      'kapasitas',
      'a_config',
      'b_config',
      'speed',
      'media',
      'jenis',
      'vlan',
      'label',
    ],
    ...topo.links.map((l) => {
      const a = side(l.a)
      const b = side(l.b)
      return [
        a.host,
        a.iface,
        a.members,
        b.host,
        b.iface,
        b.members,
        a.members || b.members ? a.capacity : l.speed,
        a.config,
        b.config,
        l.speed,
        l.media,
        l.kind,
        l.vlans,
        l.label,
      ]
    }),
  ])
}

/**
 * Rekap seluruh interface beserta link-type, VLAN, dan IP-nya — inilah yang
 * biasanya diminta saat audit konfigurasi.
 */
export function portsCsv(topo: Topology): string {
  const rows: unknown[][] = [
    [
      'hostname',
      'interface',
      'jenis',
      'speed',
      'media',
      'link_type',
      'pvid',
      'vlan_tagged',
      'vlan_untagged',
      'ip',
      'anggota_trunk',
      'ringkasan',
      'deskripsi',
    ],
  ]

  for (const d of topo.devices) {
    const trunkOf = new Map<string, string>()
    for (const t of d.trunks) {
      for (const m of t.memberIds) trunkOf.set(m, t.name)
    }

    for (const t of d.trunks) {
      rows.push([
        d.hostname,
        t.name,
        `agregasi (${t.mode})`,
        summarizeTrunk(t, d.ports).composition,
        '',
        t.linkType,
        t.pvid ?? '',
        t.allowedVlans,
        t.untaggedVlans,
        t.ipAddress,
        t.memberIds.map((m) => d.ports.find((p) => p.id === m)?.name ?? '').join(' '),
        ifaceSummary(t),
        t.description,
      ])
    }

    for (const p of d.ports) {
      rows.push([
        d.hostname,
        p.name,
        trunkOf.has(p.id) ? `anggota ${trunkOf.get(p.id)}` : 'fisik',
        p.speed,
        p.media,
        p.linkType,
        p.pvid ?? '',
        p.allowedVlans,
        p.untaggedVlans,
        p.ipAddress,
        '',
        ifaceSummary(p),
        p.description,
      ])
    }
  }

  return toCsv(rows)
}

export function downloadCsvBundle(topo: Topology, slug: string): void {
  downloadText(devicesCsv(topo), `${slug}-perangkat.csv`, 'text/csv')
  setTimeout(() => downloadText(linksCsv(topo), `${slug}-link.csv`, 'text/csv'), 250)
  setTimeout(() => downloadText(portsCsv(topo), `${slug}-interface.csv`, 'text/csv'), 500)
}
