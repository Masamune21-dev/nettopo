import { getModel } from '@/data/deviceCatalog'
import { summarizeTrunk } from '@/lib/trunks'
import type { Device, Endpoint, Topology } from '@/types/topology'
import { downloadText } from './download'

function cell(value: unknown): string {
  const s = String(value ?? '')
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
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
      }
    }
    const port = device?.ports.find((p) => p.id === end.portId)
    return {
      host: device?.hostname ?? '',
      iface: port?.name ?? '',
      members: '',
      capacity: port?.speed ?? '',
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
        l.speed,
        l.media,
        l.kind,
        l.vlans,
        l.label,
      ]
    }),
  ])
}

export function downloadCsvBundle(topo: Topology, slug: string): void {
  downloadText(devicesCsv(topo), `${slug}-perangkat.csv`, 'text/csv')
  setTimeout(() => downloadText(linksCsv(topo), `${slug}-link.csv`, 'text/csv'), 250)
}
