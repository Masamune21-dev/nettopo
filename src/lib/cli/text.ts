import { formatIp, parseIp } from '@/lib/ip'

/** Satu kata masukan beserta posisinya — posisi dipakai untuk tanda ^ pada pesan galat. */
export interface Token {
  text: string
  start: number
}

/**
 * Pecah satu baris perintah jadi token. Teks bertanda kutip menjadi satu
 * token tanpa kutipnya, termasuk bentuk `comment="ke core"` ala RouterOS.
 * Dengan `brackets`, ekspresi `[find interface=ether1]` dihitung satu token.
 */
export function tokenize(line: string, opts: { brackets?: boolean } = {}): Token[] {
  const out: Token[] = []
  let i = 0
  while (i < line.length) {
    if (/\s/.test(line[i]!)) {
      i += 1
      continue
    }
    const start = i
    let text = ''
    if (opts.brackets && line[i] === '[') {
      let depth = 0
      while (i < line.length) {
        const ch = line[i]!
        if (ch === '[') depth += 1
        if (ch === ']') depth -= 1
        text += ch
        i += 1
        if (depth === 0) break
      }
      out.push({ text, start })
      continue
    }
    while (i < line.length && !/\s/.test(line[i]!)) {
      if (line[i] === '"') {
        i += 1
        while (i < line.length && line[i] !== '"') {
          text += line[i]
          i += 1
        }
        i += 1
        continue
      }
      text += line[i]
      i += 1
    }
    out.push({ text, start })
  }
  return out
}

/** Pisahkan `show run | include ge` jadi perintah dan rangkaian filter pipa. */
export function splitPipe(line: string): { cmd: string; pipes: string[] } {
  const parts: string[] = []
  let cur = ''
  let quoted = false
  for (const ch of line) {
    if (ch === '"') quoted = !quoted
    if (ch === '|' && !quoted) {
      parts.push(cur)
      cur = ''
      continue
    }
    cur += ch
  }
  parts.push(cur)
  const [cmd = '', ...pipes] = parts
  return { cmd, pipes: pipes.map((p) => p.trim()) }
}

/** Isi kolom tabel: teks yang kepanjangan tetap diberi satu spasi pemisah. */
export function col(text: string, width: number): string {
  return text.length >= width ? `${text} ` : text.padEnd(width)
}

export function row(cells: [string, number][]): string {
  return cells
    .map(([t, w]) => col(t, w))
    .join('')
    .trimEnd()
}

/* ── Nama interface ───────────────────────────────────────────────────────── */

/** "GE0/0/1" → { stem: "GE", num: "0/0/1" }; "ether1" → { stem: "ether", num: "1" } */
export function splitIfName(name: string): { stem: string; num: string } {
  const m = /^(.*?)(\d+(?:[/:.\-_]\d+)*)$/.exec(name.replace(/\s+/g, ''))
  if (!m) return { stem: name, num: '' }
  return { stem: m[1] ?? '', num: m[2] ?? '' }
}

/**
 * Cocokkan nama interface yang diketik dengan nama yang ada di perangkat.
 * Menerima nama persis, singkatan (`g0/0/1`, `gig 0/0/1`), dan nama panjang
 * yang dipetakan ke nama pendek lewat `aliases` (`GigabitEthernet` → `GE`).
 */
export function resolveIfaceName(
  input: string,
  names: string[],
  aliases: Record<string, string> = {},
): string | null {
  const typed = input.replace(/\s+/g, '')
  const exact = names.find((n) => n.toLowerCase() === typed.toLowerCase())
  if (exact) return exact

  const { stem, num } = splitIfName(typed)
  if (!num) return null
  const s = stem.toLowerCase()
  const expanded = Object.entries(aliases)
    .filter(([long, short]) => s && (long.startsWith(s) || short === s))
    .map(([, short]) => short)

  const sameNum = names.filter((n) => splitIfName(n).num.toLowerCase() === num.toLowerCase())
  const stemOf = (n: string) => splitIfName(n).stem.toLowerCase()

  const byStem = sameNum.filter((n) => stemOf(n) === s)
  if (byStem.length === 1) return byStem[0]!
  const byAlias = sameNum.filter((n) => expanded.includes(stemOf(n)))
  if (byAlias.length === 1) return byAlias[0]!
  const byPrefix = sameNum.filter((n) => s && stemOf(n).startsWith(s))
  if (byPrefix.length === 1) return byPrefix[0]!
  return null
}

/* ── Alamat ───────────────────────────────────────────────────────────────── */

/** "255.255.255.252" → 30, "30" → 30; null bila bukan mask yang sah. */
export function maskToPrefix(text: string): number | null {
  if (/^\d{1,2}$/.test(text)) {
    const n = Number(text)
    return n <= 32 ? n : null
  }
  const v = parseIp(text)
  if (v === null) return null
  const inverted = ~v >>> 0
  // Mask sah: semua bit 1 di depan, lalu semua 0 — jadi kebalikannya berbentuk 2^k − 1.
  if ((inverted & (inverted + 1)) !== 0) return null
  let bits = 0
  for (let x = v; x; x = (x << 1) >>> 0) bits += 1
  return bits
}

export function prefixToMask(prefix: number): string {
  return formatIp(prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0)
}

/** Hash kecil yang stabil — dipakai membuat MAC dan waktu ping yang tidak berubah-ubah. */
export function hash(text: string): number {
  let h = 2166136261
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

/** MAC tiruan per perangkat: OUI vendor + tiga oktet dari id perangkat. */
export function macOf(deviceId: string, index: number, oui = '00:e0:fc'): string {
  const h = hash(deviceId)
  const bytes = [(h >>> 16) & 255, (h >>> 8) & 255, (h + index) & 255]
  return `${oui}:${bytes.map((b) => b.toString(16).padStart(2, '0')).join(':')}`
}

/** Tanggal gaya log perangkat: 2026-10-12 08:15:03 */
export function stamp(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}
