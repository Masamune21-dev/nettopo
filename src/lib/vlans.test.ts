import { describe, expect, it } from 'vitest'
import { ifaceBadge, ifaceSummary, ifaceVlanLabel, ifaceVlans } from './iface'
import { formatVlanList, parseVlanList, summarizeVlans, vlansMissingFrom } from './vlans'

describe('parseVlanList', () => {
  it('membaca angka, rentang, dan campuran pemisah', () => {
    expect(parseVlanList('100')).toEqual({ ok: true, vlans: [100] })
    expect(parseVlanList('100,200')).toEqual({ ok: true, vlans: [100, 200] })
    expect(parseVlanList('10-12')).toEqual({ ok: true, vlans: [10, 11, 12] })
    expect(parseVlanList('100, 10-12  200')).toEqual({ ok: true, vlans: [10, 11, 12, 100, 200] })
  })

  it('daftar kosong tetap sah', () => {
    expect(parseVlanList('')).toEqual({ ok: true, vlans: [] })
    expect(parseVlanList('   ')).toEqual({ ok: true, vlans: [] })
  })

  it('membuang duplikat dan mengurutkan', () => {
    const r = parseVlanList('200,100,100,150')
    expect(r.ok && r.vlans).toEqual([100, 150, 200])
  })

  it('menolak VLAN di luar 1–4094', () => {
    const r = parseVlanList('4095')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain('4094')
    expect(parseVlanList('0').ok).toBe(false)
  })

  it('menolak rentang terbalik dan token ngawur', () => {
    expect(parseVlanList('200-100').ok).toBe(false)
    expect(parseVlanList('abc').ok).toBe(false)
    expect(parseVlanList('10--12').ok).toBe(false)
  })
})

describe('formatVlanList', () => {
  it('memadatkan angka berurutan jadi rentang', () => {
    expect(formatVlanList([100, 101, 102, 200])).toBe('100-102,200')
    expect(formatVlanList([1, 2])).toBe('1,2')
    expect(formatVlanList([5])).toBe('5')
  })

  it('bolak-balik dengan parseVlanList', () => {
    const text = '1,100,200,300-305'
    const parsed = parseVlanList(text)
    expect(parsed.ok && formatVlanList(parsed.vlans)).toBe('1,100,200,300-305')
  })
})

describe('summarizeVlans', () => {
  it('meringkas kalau daftarnya panjang', () => {
    expect(summarizeVlans('100,200')).toBe('100,200')
    expect(summarizeVlans('100-110')).toBe('11 vlan')
  })
})

describe('vlansMissingFrom', () => {
  it('menemukan VLAN yang hanya ada di satu sisi', () => {
    expect(vlansMissingFrom('100,200,300', '100,300')).toEqual([200])
    expect(vlansMissingFrom('100', '100,200')).toEqual([])
  })
})

const iface = (patch: Partial<Parameters<typeof ifaceSummary>[0]>) => ({
  linkType: 'none' as const,
  pvid: null,
  allowedVlans: '',
  untaggedVlans: '',
  ipAddress: '',
  ...patch,
})

describe('ringkasan interface', () => {
  it('access menampilkan VLAN-nya di badge', () => {
    const cfg = iface({ linkType: 'access', pvid: 100 })
    expect(ifaceBadge(cfg)).toBe('A100')
    expect(ifaceSummary(cfg)).toBe('access vlan 100')
    expect(ifaceVlanLabel(cfg)).toBe('vl 100')
    expect(ifaceVlans(cfg)).toEqual([100])
  })

  it('trunk menggabungkan pvid dan daftar tagged', () => {
    const cfg = iface({ linkType: 'trunk', pvid: 1, allowedVlans: '1,100,200' })
    expect(ifaceBadge(cfg)).toBe('T')
    expect(ifaceSummary(cfg)).toBe('trunk · pvid 1 · tagged 1,100,200')
    expect(ifaceVlans(cfg)).toEqual([1, 100, 200])
  })

  it('hybrid memisahkan tagged dan untagged', () => {
    const cfg = iface({ linkType: 'hybrid', pvid: 1, allowedVlans: '100', untaggedVlans: '200' })
    expect(ifaceSummary(cfg)).toContain('untagged 200')
    expect(ifaceVlans(cfg)).toEqual([1, 100, 200])
  })

  it('routed memakai alamat IP, bukan VLAN', () => {
    const cfg = iface({ linkType: 'routed', ipAddress: '10.0.0.1/30' })
    expect(ifaceBadge(cfg)).toBe('L3')
    expect(ifaceSummary(cfg)).toBe('routed 10.0.0.1/30')
    expect(ifaceVlans(cfg)).toEqual([])
  })

  it('label kabel diringkas kalau VLAN-nya banyak', () => {
    const few = iface({ linkType: 'trunk', pvid: 1, allowedVlans: '1,100,200' })
    expect(ifaceVlanLabel(few)).toBe('vl 1,100,200')
    const many = iface({ linkType: 'trunk', pvid: 1, allowedVlans: '1,100,200,300-305' })
    expect(ifaceVlanLabel(many)).toBe('9 vlan')
  })

  it('interface belum diatur tidak memberi badge', () => {
    expect(ifaceBadge(iface({}))).toBe('')
    expect(ifaceSummary(iface({}))).toBe('')
  })

  it('menandai konfigurasi yang belum lengkap', () => {
    expect(ifaceSummary(iface({ linkType: 'access' }))).toContain('belum diisi')
    expect(ifaceSummary(iface({ linkType: 'routed' }))).toContain('belum diisi')
  })
})
