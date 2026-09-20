import { describe, expect, it } from 'vitest'
import { buildPorts, expandTemplate } from '@/lib/ports'
import { ROLE_LABEL, SPEEDS, MEDIA } from '@/types/topology'
import { DEVICE_CATALOG, VENDOR_META, VENDOR_ORDER } from './deviceCatalog'

describe('integritas katalog', () => {
  it('setiap id unik', () => {
    const ids = DEVICE_CATALOG.map((m) => m.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('setiap nama model unik', () => {
    const names = DEVICE_CATALOG.map((m) => m.model)
    expect(new Set(names).size).toBe(names.length)
  })

  it('setiap vendor dikenali dan punya keterangan', () => {
    for (const m of DEVICE_CATALOG) {
      expect(VENDOR_ORDER, `vendor ${m.vendor} tidak ada di urutan`).toContain(m.vendor)
      expect(VENDOR_META[m.vendor]).toBeDefined()
    }
  })

  it('setiap peran punya label', () => {
    for (const m of DEVICE_CATALOG) {
      expect(ROLE_LABEL[m.role], `peran ${m.role} pada ${m.id}`).toBeTruthy()
    }
  })

  it('setiap model punya minimal satu port', () => {
    for (const m of DEVICE_CATALOG) {
      expect(buildPorts(m).length, `${m.id} tidak punya port`).toBeGreaterThan(0)
    }
  })

  // Nama port yang bentrok membuat konfigurasi hasil AI dan ekspor CSV
  // jadi ambigu, jadi ini diperiksa untuk SEMUA model, bukan sebagian.
  it('tidak ada nama port ganda di dalam satu model', () => {
    for (const m of DEVICE_CATALOG) {
      const names = buildPorts(m).map((p) => p.name)
      const duplikat = names.filter((n, i) => names.indexOf(n) !== i)
      expect(duplikat, `nama port ganda di ${m.id}: ${duplikat.join(', ')}`).toEqual([])
    }
  })

  it('speed dan media setiap template sah', () => {
    for (const m of DEVICE_CATALOG) {
      for (const t of m.ports) {
        expect(SPEEDS, `speed ${t.speed} pada ${m.id}`).toContain(t.speed)
        expect(MEDIA, `media ${t.media} pada ${m.id}`).toContain(t.media)
        expect(t.count, `count pada ${m.id}`).toBeGreaterThan(0)
        expect(t.startIndex, `startIndex pada ${m.id}`).toBeGreaterThanOrEqual(0)
        expect(t.group, `group pada ${m.id}`).toBeTruthy()
      }
    }
  })

  it('penomoran Juniper berbasis 0, MikroTik berbasis 1', () => {
    for (const m of DEVICE_CATALOG) {
      // Pada Juniper nomor port berlanjut antar template di PIC yang sama
      // (mis. xe-0/0/0..47 lalu et-0/0/48..55), jadi yang diperiksa adalah
      // nomor terkecilnya, bukan tiap template.
      if (m.vendor === 'juniper') {
        expect(Math.min(...m.ports.map((t) => t.startIndex)), `${m.id}`).toBe(0)
      }
      if (m.vendor === 'mikrotik') {
        for (const t of m.ports) expect(t.startIndex, `${m.id}`).toBeGreaterThanOrEqual(1)
      }
    }
  })

  it('nama port tidak mengandung spasi', () => {
    for (const m of DEVICE_CATALOG) {
      for (const p of buildPorts(m)) {
        expect(p.name, `${m.id} punya port berspasi: "${p.name}"`).not.toMatch(/\s/)
      }
    }
  })

  it('setiap vendor punya minimal satu model', () => {
    for (const v of VENDOR_ORDER) {
      expect(
        DEVICE_CATALOG.some((m) => m.vendor === v),
        `vendor ${v} tidak punya model`,
      ).toBe(true)
    }
  })

  it('expandTemplate menghasilkan jumlah port sesuai count', () => {
    for (const m of DEVICE_CATALOG) {
      for (const t of m.ports) {
        expect(expandTemplate(t)).toHaveLength(t.count)
      }
    }
  })

  it('katalog cukup banyak untuk dipakai sehari-hari', () => {
    expect(DEVICE_CATALOG.length).toBeGreaterThanOrEqual(85)
  })
})
