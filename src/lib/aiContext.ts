import { DEVICE_CATALOG, getModel } from '@/data/deviceCatalog'
import { ifaceSummary } from '@/lib/iface'
import { summarizeTrunk } from '@/lib/trunks'
import type { Topology } from '@/types/topology'
import { ROLE_LABEL } from '@/types/topology'

/**
 * Ringkasan topologi dalam bentuk teks padat untuk dikirim ke model.
 *
 * Sengaja tidak memakai JSON mentah: dokumen JSON penuh berisi id acak,
 * koordinat, dan warna yang tidak ada gunanya bagi model tetapi memakan
 * banyak token. Bentuk ini memakai hostname sebagai pengenal agar jawaban
 * model bisa langsung dibaca manusia.
 */
export function describeTopology(topo: Topology, opts: { withIds?: boolean } = {}): string {
  const lines: string[] = []
  const byId = new Map(topo.devices.map((d) => [d.id, d]))

  lines.push(`TOPOLOGI: ${topo.project.name}${topo.project.site ? ` (site utama ${topo.project.site})` : ''}`)
  lines.push(`Jumlah: ${topo.devices.length} perangkat, ${topo.links.length} link`)
  lines.push('')
  lines.push('PERANGKAT:')

  for (const d of topo.devices) {
    const m = getModel(d.modelId)
    const head = [
      `- ${d.hostname}`,
      opts.withIds ? `[id=${d.id}]` : '',
      `| ${m ? `${m.vendor} ${m.model}` : d.modelId}`,
      `| peran: ${ROLE_LABEL[d.role]}`,
      d.site ? `| site: ${d.site}` : '',
      d.mgmtIp ? `| mgmt: ${d.mgmtIp}` : '',
      d.loopback ? `| loopback: ${d.loopback}` : '',
    ]
      .filter(Boolean)
      .join(' ')
    lines.push(head)
    if (d.notes) lines.push(`    catatan: ${d.notes}`)

    for (const t of d.trunks) {
      const s = summarizeTrunk(t, d.ports)
      const members = t.memberIds
        .map((id) => d.ports.find((p) => p.id === id)?.name)
        .filter(Boolean)
        .join(', ')
      lines.push(
        `    trunk ${t.name} (${t.mode}) anggota: ${members} = ${s.label}` +
          (ifaceSummary(t) ? ` | ${ifaceSummary(t)}` : ''),
      )
    }

    // Hanya port yang sudah dikonfigurasi atau punya deskripsi yang disebut,
    // supaya switch 48 port tidak membanjiri konteks.
    const notable = d.ports.filter((p) => p.linkType !== 'none' || p.description)
    for (const p of notable) {
      lines.push(
        `    port ${p.name} (${p.speed}/${p.media})` +
          (ifaceSummary(p) ? ` | ${ifaceSummary(p)}` : '') +
          (p.description ? ` | ${p.description}` : ''),
      )
    }
    const rest = d.ports.length - notable.length
    if (rest > 0) lines.push(`    (+${rest} port lain belum dikonfigurasi)`)
  }

  lines.push('')
  lines.push('LINK:')
  const ifaceName = (deviceId: string, portId: string, trunkId: string | null) => {
    const dev = byId.get(deviceId)
    if (!dev) return '?'
    if (trunkId) return dev.trunks.find((t) => t.id === trunkId)?.name ?? '?'
    return dev.ports.find((p) => p.id === portId)?.name ?? '?'
  }

  for (const l of topo.links) {
    const a = byId.get(l.a.deviceId)?.hostname ?? '?'
    const b = byId.get(l.b.deviceId)?.hostname ?? '?'
    lines.push(
      `- ${a} ${ifaceName(l.a.deviceId, l.a.portId, l.a.trunkId)}` +
        ` <-> ${b} ${ifaceName(l.b.deviceId, l.b.portId, l.b.trunkId)}` +
        ` | ${l.speed} ${l.media}${l.kind !== 'single' ? ` ${l.kind}` : ''}` +
        (l.vlans ? ` | vlan ${l.vlans}` : '') +
        (l.label ? ` | ${l.label}` : ''),
    )
  }

  if (topo.groups.length) {
    lines.push('')
    lines.push('AREA:')
    for (const g of topo.groups) lines.push(`- ${g.label}`)
  }

  return lines.join('\n')
}

/** Daftar model perangkat yang tersedia, untuk fitur "buat dari deskripsi". */
export function describeCatalog(): string {
  return DEVICE_CATALOG.map(
    (m) => `- ${m.id} = ${m.vendor} ${m.model} (${ROLE_LABEL[m.role]})${m.note ? ` — ${m.note}` : ''}`,
  ).join('\n')
}
