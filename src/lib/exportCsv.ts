import { getModel } from '@/data/deviceCatalog'
import type { Topology } from '@/types/topology'
import { downloadText } from './download'

function cell(value: unknown): string {
  const s = String(value ?? '')
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

const toCsv = (rows: unknown[][]) => rows.map((r) => r.map(cell).join(',')).join('\n')

/** Rekap perangkat — untuk BOM / inventaris. */
export function devicesCsv(topo: Topology): string {
  return toCsv([
    ['hostname', 'vendor', 'model', 'role', 'site', 'mgmt_ip', 'loopback', 'jumlah_port', 'catatan'],
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
        d.notes,
      ]
    }),
  ])
}

/** Rekap link port-ke-port — untuk dokumentasi kapasitas. */
export function linksCsv(topo: Topology): string {
  const byId = new Map(topo.devices.map((d) => [d.id, d]))
  const portName = (deviceId: string, portId: string) =>
    byId.get(deviceId)?.ports.find((p) => p.id === portId)?.name ?? ''
  return toCsv([
    ['a_hostname', 'a_port', 'b_hostname', 'b_port', 'speed', 'media', 'jenis', 'vlan', 'label'],
    ...topo.links.map((l) => [
      byId.get(l.a.deviceId)?.hostname ?? '',
      portName(l.a.deviceId, l.a.portId),
      byId.get(l.b.deviceId)?.hostname ?? '',
      portName(l.b.deviceId, l.b.portId),
      l.speed,
      l.media,
      l.kind,
      l.vlans,
      l.label,
    ]),
  ])
}

export function downloadCsvBundle(topo: Topology, slug: string): void {
  downloadText(devicesCsv(topo), `${slug}-perangkat.csv`, 'text/csv')
  setTimeout(() => downloadText(linksCsv(topo), `${slug}-link.csv`, 'text/csv'), 250)
}
