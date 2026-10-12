import { parseCidr, parseIp } from '@/lib/ip'
import { maskToPrefix, type Token } from './text'

/**
 * Pencocok perintah bergaya CLI perangkat jaringan.
 *
 * Setiap perintah ditulis sebagai pola, mis. `ip address <ip:ip> <mask:mask>`.
 * Kata kunci boleh disingkat selama tidak rancu (`dis ip int br`), dan
 * pencocok yang sama dipakai untuk bantuan `?` dan pelengkapan Tab — jadi
 * ketiganya selalu sepakat soal perintah mana yang sah.
 */

export type ParamType =
  | 'word' // satu kata apa saja
  | 'int' // bilangan bulat, opsional dengan rentang
  | 'ip' // 10.0.0.1
  | 'mask' // 255.255.255.252 atau 30
  | 'cidr' // 10.0.0.1/30
  | 'ipcidr' // salah satu dari dua di atas
  | 'iface' // nama interface; "GigabitEthernet 0/0/1" (dua kata) juga diterima
  | 'text' // sisa baris
  | 'list' // sisa baris, dibaca sendiri oleh perintahnya (daftar VLAN dsb.)

export type SynTok =
  | { kw: string }
  | { param: string; type: ParamType; min?: number; max?: number; label?: string }

export type Args = Record<string, string>

export interface CommandSpec<R> {
  syntax: string
  help?: string
  /** Tidak ditampilkan di bantuan `?` — untuk alias dan perintah tersembunyi. */
  hidden?: boolean
  run: (args: Args) => R
}

const cache = new Map<string, SynTok[]>()

/** `<vlan:int:1-4094>` → param bertipe int dengan rentang; kata lain → kata kunci. */
export function parseSyntax(syntax: string): SynTok[] {
  const hit = cache.get(syntax)
  if (hit) return hit
  const toks = syntax
    .trim()
    .split(/\s+/)
    .map((w): SynTok => {
      const m = /^<([\w-]+)(?::(\w+))?(?::(\d+)-(\d+))?(?::([^>]+))?>$/.exec(w)
      if (!m) return { kw: w.toLowerCase() }
      return {
        param: m[1]!,
        type: (m[2] as ParamType | undefined) ?? 'word',
        min: m[3] !== undefined ? Number(m[3]) : undefined,
        max: m[4] !== undefined ? Number(m[4]) : undefined,
        label: m[5],
      }
    })
  cache.set(syntax, toks)
  return toks
}

/** Berapa token yang dimakan param ini di posisi i; 0 berarti tidak cocok. */
function consume(tok: Extract<SynTok, { param: string }>, tokens: Token[], i: number): number {
  const t = tokens[i]?.text ?? ''
  switch (tok.type) {
    case 'word':
      return 1
    case 'int': {
      if (!/^\d+$/.test(t)) return 0
      const n = Number(t)
      if (tok.min !== undefined && n < tok.min) return 0
      if (tok.max !== undefined && n > tok.max) return 0
      return 1
    }
    case 'ip':
      return parseIp(t) !== null ? 1 : 0
    case 'mask':
      return maskToPrefix(t) !== null ? 1 : 0
    case 'cidr':
      return t.includes('/') && parseCidr(t) !== null ? 1 : 0
    case 'ipcidr':
      return parseCidr(t) !== null ? 1 : 0
    case 'iface': {
      if (/\d/.test(t)) return 1
      // "GigabitEthernet 0/0/1" — nama dan nomor dipisah spasi.
      const next = tokens[i + 1]?.text ?? ''
      return /^[a-z][\w-]*$/i.test(t) && /^\d/.test(next) ? 2 : 0
    }
    case 'text':
    case 'list':
      return tokens.length - i
  }
}

interface Cand<R> {
  spec: CommandSpec<R>
  toks: SynTok[]
  si: number
  ii: number
  args: Args
}

export type Walk<R> =
  | { ok: true; alive: Cand<R>[] }
  | { ok: false; error: 'unrecognized' | 'ambiguous'; at: number; options: string[] }

/**
 * Jalankan semua pola terhadap token secara serentak. Pada tiap posisi:
 * kata kunci yang persis menang, lalu singkatan yang tidak rancu, baru param.
 */
export function walk<R>(specs: CommandSpec<R>[], tokens: Token[], abbrev = true): Walk<R> {
  let cands: Cand<R>[] = specs.map((spec) => ({ spec, toks: parseSyntax(spec.syntax), si: 0, ii: 0, args: {} }))
  let furthest = 0

  for (;;) {
    const pending = cands.filter((c) => c.ii < tokens.length)
    if (pending.length === 0) break
    const ii = Math.min(...pending.map((c) => c.ii))
    const group = pending.filter((c) => c.ii === ii)
    const word = tokens[ii]!.text.toLowerCase()

    const live = group.filter((c) => c.si < c.toks.length)
    const kwOf = (c: Cand<R>) => {
      const t = c.toks[c.si]
      return t && 'kw' in t ? t.kw : null
    }
    const exact = live.filter((c) => kwOf(c) === word)
    const prefix = abbrev ? live.filter((c) => kwOf(c)?.startsWith(word)) : []
    const params = live.filter((c) => {
      const t = c.toks[c.si]
      return t && 'param' in t && consume(t, tokens, ii) > 0
    })

    let keep: Cand<R>[]
    if (exact.length > 0) keep = exact
    else if (prefix.length > 0) {
      const distinct = [...new Set(prefix.map((c) => kwOf(c)!))]
      if (distinct.length > 1) return { ok: false, error: 'ambiguous', at: ii, options: distinct.sort() }
      keep = prefix
    } else keep = params

    const kept = new Set(keep)
    cands = cands.filter((c) => c.ii !== ii || kept.has(c))
    // Posisi ^ pada pesan galat: token terjauh tempat sebuah pola gugur.
    if (keep.length < group.length) furthest = Math.max(furthest, ii)

    for (const c of keep) {
      const t = c.toks[c.si]!
      if ('kw' in t) {
        c.ii += 1
      } else {
        const n = consume(t, tokens, c.ii)
        c.args[t.param] = tokens
          .slice(c.ii, c.ii + n)
          .map((x) => x.text)
          .join(t.type === 'iface' ? '' : ' ')
        c.ii += n
      }
      c.si += 1
    }
    if (cands.length === 0) return { ok: false, error: 'unrecognized', at: furthest, options: [] }
  }
  return { ok: true, alive: cands }
}

export type Match<R> =
  | { ok: true; spec: CommandSpec<R>; args: Args }
  | { ok: false; error: 'unrecognized' | 'incomplete' | 'ambiguous'; at: number; options: string[] }

export function match<R>(specs: CommandSpec<R>[], tokens: Token[], abbrev = true): Match<R> {
  const w = walk(specs, tokens, abbrev)
  if (!w.ok) return w
  const done = w.alive.find((c) => c.si === c.toks.length)
  if (done) return { ok: true, spec: done.spec, args: done.args }
  return { ok: false, error: 'incomplete', at: tokens.length, options: [] }
}

export interface HelpItem {
  word: string
  help: string
  /** Param: label tampilannya, mis. INTEGER<1-4094> */
  param?: Extract<SynTok, { param: string }>
}

/**
 * Pilihan berikutnya untuk bantuan `?`. Bila baris berakhir di tengah kata,
 * yang dicari adalah kata kunci berawalan kata itu; bila berakhir dengan
 * spasi, yang dicari adalah kata apa saja yang boleh datang sesudahnya.
 */
export function nextOptions<R>(
  specs: CommandSpec<R>[],
  tokens: Token[],
  partial: string | null,
  kwHelp: Record<string, string>,
  abbrev = true,
): { items: HelpItem[]; cr: boolean } | null {
  const w = walk(
    specs.filter((s) => !s.hidden),
    tokens,
    abbrev,
  )
  if (!w.ok) return null
  const at = w.alive.filter((c) => c.ii === tokens.length)
  const seen = new Map<string, HelpItem>()
  let cr = false
  for (const c of at) {
    const t = c.toks[c.si]
    if (!t) {
      cr = true
      continue
    }
    if ('kw' in t) {
      if (partial !== null && !t.kw.startsWith(partial.toLowerCase())) continue
      if (!seen.has(t.kw)) {
        const last = c.si === c.toks.length - 1
        seen.set(t.kw, { word: t.kw, help: (last ? c.spec.help : kwHelp[t.kw]) ?? kwHelp[t.kw] ?? c.spec.help ?? '' })
      }
    } else if (partial === null) {
      const key = `<${t.param}>`
      if (!seen.has(key)) seen.set(key, { word: key, help: t.label ?? c.spec.help ?? '', param: t })
    }
  }
  return { items: [...seen.values()], cr: partial === null && cr }
}
