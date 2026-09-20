import type { DeviceModel, PortTemplate } from '@/data/deviceCatalog'
import type { Media, Port, Speed } from '@/types/topology'
import { uid } from './id'

export interface ExpandedPort {
  name: string
  speed: Speed
  media: Media
  group: string
}

/** Ubah satu template jadi daftar nama interface konkret. */
export function expandTemplate(t: PortTemplate): ExpandedPort[] {
  const out: ExpandedPort[] = []
  for (let i = 0; i < t.count; i += 1) {
    out.push({
      name: `${t.prefix}${t.startIndex + i}${t.suffix ?? ''}`,
      speed: t.speed,
      media: t.media,
      group: t.group,
    })
  }
  return out
}

/**
 * Bangun daftar port lengkap untuk sebuah model.
 * Port ganjil ditaruh di kolom kiri, genap di kanan — meniru penomoran
 * faceplate perangkat asli sekaligus menyeimbangkan tampilan node.
 */
export function buildPorts(model: DeviceModel): Port[] {
  return model.ports.flatMap(expandTemplate).map((p, index) => ({
    id: uid('p'),
    name: p.name,
    speed: p.speed,
    media: p.media,
    description: '',
    side: index % 2 === 0 ? ('left' as const) : ('right' as const),
  }))
}

/** Kelompokkan port berdasarkan template asalnya, untuk ditampilkan di Inspector. */
export function groupsOf(model: DeviceModel): string[] {
  return [...new Set(model.ports.map((t) => t.group))]
}

/** Nama port berikutnya yang belum dipakai, untuk tombol "tambah port". */
export function nextPortName(ports: Port[], prefix = 'port'): string {
  const used = new Set(ports.map((p) => p.name))
  let i = 1
  while (used.has(`${prefix}${i}`)) i += 1
  return `${prefix}${i}`
}

/** Urutkan nama interface secara natural: ether2 sebelum ether10. */
export function comparePortName(a: string, b: string): number {
  const re = /(\d+)|(\D+)/g
  const ta = a.match(re) ?? []
  const tb = b.match(re) ?? []
  for (let i = 0; i < Math.max(ta.length, tb.length); i += 1) {
    const x = ta[i]
    const y = tb[i]
    if (x === undefined) return -1
    if (y === undefined) return 1
    const nx = Number(x)
    const ny = Number(y)
    if (!Number.isNaN(nx) && !Number.isNaN(ny)) {
      if (nx !== ny) return nx - ny
    } else if (x !== y) {
      return x < y ? -1 : 1
    }
  }
  return 0
}
