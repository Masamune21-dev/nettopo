/**
 * Perhitungan alamat IPv4. Alamat disimpan sebagai bilangan bulat 32 bit
 * tak bertanda supaya perbandingan dan perhitungan rentang jadi sederhana.
 *
 * Catatan /31: sesuai RFC 3021, prefix /31 dipakai untuk tautan titik-ke-titik
 * dan KEDUA alamatnya bisa dipakai host — tidak ada alamat jaringan maupun
 * broadcast. /32 berarti satu alamat tunggal.
 */

export interface Cidr {
  /** Alamat sebagaimana ditulis, bukan alamat jaringannya. */
  addr: number
  prefix: number
}

const OCTET = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/

export function parseIp(text: string): number | null {
  const m = OCTET.exec(text.trim())
  if (!m) return null
  let value = 0
  for (let i = 1; i <= 4; i += 1) {
    const octet = Number(m[i])
    if (!Number.isInteger(octet) || octet < 0 || octet > 255) return null
    // Awalan nol seperti "010" ditolak agar tidak rancu dengan notasi oktal.
    if (m[i]!.length > 1 && m[i]!.startsWith('0')) return null
    value = value * 256 + octet
  }
  return value >>> 0
}

export function formatIp(value: number): string {
  const n = value >>> 0
  return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.')
}

/** Baca "10.0.0.1/30". Tanpa prefix dianggap /32. */
export function parseCidr(text: string): Cidr | null {
  const raw = text.trim()
  if (!raw) return null
  const [ipPart, prefixPart, ...rest] = raw.split('/')
  if (rest.length > 0) return null

  const addr = parseIp(ipPart ?? '')
  if (addr === null) return null

  if (prefixPart === undefined) return { addr, prefix: 32 }
  if (!/^\d{1,2}$/.test(prefixPart)) return null
  const prefix = Number(prefixPart)
  if (prefix < 0 || prefix > 32) return null
  return { addr, prefix }
}

export const formatCidr = (c: Cidr): string => `${formatIp(c.addr)}/${c.prefix}`

/** Mask sebagai bilangan; /0 ditangani khusus karena pergeseran 32 bit tidak sah. */
export function maskOf(prefix: number): number {
  return prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0
}

export const networkOf = (c: Cidr): number => (c.addr & maskOf(c.prefix)) >>> 0
export const broadcastOf = (c: Cidr): number => (networkOf(c) | (~maskOf(c.prefix) >>> 0)) >>> 0

/** Jumlah alamat yang bisa dipakai host di dalam prefix ini. */
export function usableCount(prefix: number): number {
  if (prefix >= 31) return 2 ** (32 - prefix)
  return 2 ** (32 - prefix) - 2
}

/** Alamat host pertama dan terakhir yang boleh dipakai. */
export function usableRange(c: Cidr): { first: number; last: number } {
  const net = networkOf(c)
  const bcast = broadcastOf(c)
  if (c.prefix >= 31) return { first: net, last: bcast }
  return { first: (net + 1) >>> 0, last: (bcast - 1) >>> 0 }
}

export function isUsableHost(c: Cidr): boolean {
  if (c.prefix >= 31) return true
  const { first, last } = usableRange(c)
  return c.addr >= first && c.addr <= last
}

/** Dua alamat berada di jaringan yang sama persis (prefix dan network sama). */
export function sameSubnet(a: Cidr, b: Cidr): boolean {
  return a.prefix === b.prefix && networkOf(a) === networkOf(b)
}

/** Dua blok bertumpang tindih, walau prefix-nya berbeda. */
export function overlaps(a: Cidr, b: Cidr): boolean {
  return networkOf(a) <= broadcastOf(b) && networkOf(b) <= broadcastOf(a)
}

export const contains = (outer: Cidr, inner: Cidr): boolean =>
  networkOf(outer) <= networkOf(inner) && broadcastOf(inner) <= broadcastOf(outer)

/**
 * Cari blok berukuran `prefix` pertama di dalam `pool` yang belum dipakai.
 * Blok yang sudah dipakai diberikan lewat `taken`.
 */
export function nextFreeSubnet(pool: Cidr, prefix: number, taken: Cidr[]): Cidr | null {
  if (prefix < pool.prefix || prefix > 32) return null
  const step = 2 ** (32 - prefix)
  const end = broadcastOf(pool)

  for (let net = networkOf(pool); net <= end; net += step) {
    const candidate: Cidr = { addr: net >>> 0, prefix }
    if (!taken.some((t) => overlaps(candidate, t))) return candidate
    // Hindari perulangan tak berujung saat step membuat net melewati 2^32.
    if (net + step > 0xffffffff) break
  }
  return null
}
