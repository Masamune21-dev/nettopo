import { describe, expect, it } from 'vitest'
import {
  broadcastOf,
  contains,
  formatCidr,
  formatIp,
  isUsableHost,
  maskOf,
  networkOf,
  nextFreeSubnet,
  overlaps,
  parseCidr,
  parseIp,
  sameSubnet,
  usableCount,
  usableRange,
} from './ip'

const cidr = (t: string) => parseCidr(t)!

describe('parseIp & formatIp', () => {
  it('membaca dan menulis kembali alamat yang sah', () => {
    expect(formatIp(parseIp('10.0.0.1')!)).toBe('10.0.0.1')
    expect(formatIp(parseIp('255.255.255.255')!)).toBe('255.255.255.255')
    expect(formatIp(parseIp('0.0.0.0')!)).toBe('0.0.0.0')
  })

  it('menolak yang tidak sah', () => {
    expect(parseIp('256.0.0.1')).toBeNull()
    expect(parseIp('10.0.0')).toBeNull()
    expect(parseIp('10.0.0.1.5')).toBeNull()
    expect(parseIp('a.b.c.d')).toBeNull()
    // Awalan nol ditolak supaya tidak rancu dengan notasi oktal
    expect(parseIp('010.0.0.1')).toBeNull()
  })

  it('menangani alamat di atas 2^31 tanpa jadi negatif', () => {
    expect(formatIp(parseIp('192.168.1.1')!)).toBe('192.168.1.1')
    expect(formatIp(parseIp('224.0.0.1')!)).toBe('224.0.0.1')
  })
})

describe('parseCidr', () => {
  it('membaca prefix', () => {
    expect(formatCidr(cidr('10.0.0.1/30'))).toBe('10.0.0.1/30')
    expect(cidr('10.0.0.1/30').prefix).toBe(30)
  })

  it('tanpa prefix dianggap /32', () => {
    expect(cidr('10.0.0.1').prefix).toBe(32)
  })

  it('menolak prefix di luar 0–32 dan bentuk aneh', () => {
    expect(parseCidr('10.0.0.1/33')).toBeNull()
    expect(parseCidr('10.0.0.1/')).toBeNull()
    expect(parseCidr('10.0.0.1/30/2')).toBeNull()
    expect(parseCidr('')).toBeNull()
  })
})

describe('maskOf', () => {
  it('menghitung mask dengan benar, termasuk /0 dan /32', () => {
    expect(formatIp(maskOf(24))).toBe('255.255.255.0')
    expect(formatIp(maskOf(30))).toBe('255.255.255.252')
    expect(formatIp(maskOf(32))).toBe('255.255.255.255')
    expect(formatIp(maskOf(0))).toBe('0.0.0.0')
  })
})

describe('network & broadcast', () => {
  it('menghitung batas blok', () => {
    expect(formatIp(networkOf(cidr('10.0.0.6/30')))).toBe('10.0.0.4')
    expect(formatIp(broadcastOf(cidr('10.0.0.6/30')))).toBe('10.0.0.7')
    expect(formatIp(networkOf(cidr('192.168.1.130/25')))).toBe('192.168.1.128')
    expect(formatIp(broadcastOf(cidr('192.168.1.130/25')))).toBe('192.168.1.255')
  })
})

describe('usableCount & usableRange', () => {
  it('/30 punya 2 host', () => {
    expect(usableCount(30)).toBe(2)
    const r = usableRange(cidr('10.0.0.4/30'))
    expect([formatIp(r.first), formatIp(r.last)]).toEqual(['10.0.0.5', '10.0.0.6'])
  })

  it('/31 memakai kedua alamat (RFC 3021)', () => {
    expect(usableCount(31)).toBe(2)
    const r = usableRange(cidr('10.0.0.4/31'))
    expect([formatIp(r.first), formatIp(r.last)]).toEqual(['10.0.0.4', '10.0.0.5'])
  })

  it('/24 punya 254 host', () => {
    expect(usableCount(24)).toBe(254)
  })

  it('menolak alamat jaringan dan broadcast pada /30', () => {
    expect(isUsableHost(cidr('10.0.0.4/30'))).toBe(false) // network
    expect(isUsableHost(cidr('10.0.0.7/30'))).toBe(false) // broadcast
    expect(isUsableHost(cidr('10.0.0.5/30'))).toBe(true)
    // Pada /31 keduanya sah
    expect(isUsableHost(cidr('10.0.0.4/31'))).toBe(true)
  })
})

describe('sameSubnet', () => {
  it('kedua ujung /30 yang benar dianggap sama', () => {
    expect(sameSubnet(cidr('10.0.0.5/30'), cidr('10.0.0.6/30'))).toBe(true)
  })

  it('beda blok walau berdekatan', () => {
    expect(sameSubnet(cidr('10.0.0.6/30'), cidr('10.0.0.9/30'))).toBe(false)
  })

  it('prefix berbeda dianggap tidak sama', () => {
    expect(sameSubnet(cidr('10.0.0.5/30'), cidr('10.0.0.5/24'))).toBe(false)
  })
})

describe('overlaps & contains', () => {
  it('menemukan tumpang tindih lintas prefix', () => {
    expect(overlaps(cidr('10.0.0.0/24'), cidr('10.0.0.128/25'))).toBe(true)
    expect(overlaps(cidr('10.0.0.0/24'), cidr('10.0.1.0/24'))).toBe(false)
  })

  it('contains memeriksa blok di dalam blok', () => {
    expect(contains(cidr('10.0.0.0/16'), cidr('10.0.5.0/24'))).toBe(true)
    expect(contains(cidr('10.0.5.0/24'), cidr('10.0.0.0/16'))).toBe(false)
  })
})

describe('nextFreeSubnet', () => {
  const pool = cidr('10.10.0.0/24')

  it('memberi blok pertama saat belum ada yang dipakai', () => {
    expect(formatCidr(nextFreeSubnet(pool, 30, [])!)).toBe('10.10.0.0/30')
  })

  it('melewati blok yang sudah dipakai', () => {
    const taken = [cidr('10.10.0.0/30'), cidr('10.10.0.4/30')]
    expect(formatCidr(nextFreeSubnet(pool, 30, taken)!)).toBe('10.10.0.8/30')
  })

  it('menghindari blok yang tumpang tindih walau beda ukuran', () => {
    const taken = [cidr('10.10.0.0/28')]
    expect(formatCidr(nextFreeSubnet(pool, 30, taken)!)).toBe('10.10.0.16/30')
  })

  it('mengembalikan null kalau pool sudah penuh', () => {
    const taken = [cidr('10.10.0.0/24')]
    expect(nextFreeSubnet(pool, 30, taken)).toBeNull()
  })

  it('menolak blok yang lebih besar dari pool-nya', () => {
    expect(nextFreeSubnet(cidr('10.10.0.0/30'), 24, [])).toBeNull()
  })

  it('bekerja pada pool di atas 2^31', () => {
    expect(formatCidr(nextFreeSubnet(cidr('192.168.0.0/16'), 31, [])!)).toBe('192.168.0.0/31')
  })
})
