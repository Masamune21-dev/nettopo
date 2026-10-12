import { getModel } from '@/data/deviceCatalog'
import { contains, networkOf, parseIp } from '@/lib/ip'
import type { AppEdge, AppNode, DeviceNodeData } from '@/store/types'
import { isDeviceNode } from '@/store/types'
import { type Args, type CommandSpec, type HelpItem, match, nextOptions, type SynTok } from './match'
import { buildNet, type Net, ping, rtt, traceroute } from './net'
import { hash, splitPipe, type Token, tokenize } from './text'
import {
  CliError,
  type Ctx,
  type DeviceEnv,
  type Dialect,
  err,
  type ExecResult,
  hint,
  type OutLine,
  type SessionState,
} from './types'

export interface World {
  nodes: AppNode[]
  edges: AppEdge[]
}

export function deviceEnv(deviceId: string, world: World): DeviceEnv {
  const node = world.nodes.find((n) => n.id === deviceId)
  const linked = new Set<string>()
  for (const e of world.edges) {
    if (e.source === deviceId && e.sourceHandle) linked.add(e.sourceHandle)
    if (e.target === deviceId && e.targetHandle) linked.add(e.targetHandle)
  }
  return {
    deviceId,
    model: node && isDeviceNode(node) ? getModel(node.data.modelId) : undefined,
    linked,
  }
}

/** Susun konteks eksekusi; null bila perangkatnya sudah dihapus dari kanvas. */
export function makeCtx(state: SessionState, deviceId: string, world: World, now = new Date()): Ctx | null {
  const node = world.nodes.find((n) => n.id === deviceId)
  if (!node || !isDeviceNode(node)) return null
  const env = deviceEnv(deviceId, world)
  const active = node.data
  // Perubahan tertunda yang sudah tidak berlaku (mis. port-nya dihapus lewat kanvas) dibuang diam-diam.
  let device = active
  const pending = state.pending.filter((p) => {
    try {
      device = p.change(device, env)
      return true
    } catch {
      return false
    }
  })
  let net: Net | null = null
  return {
    state: { ...state, pending },
    device,
    active,
    env,
    net: () => (net ??= buildNet(world.nodes, world.edges)),
    now,
  }
}

export interface Outcome {
  out: OutLine[]
  state: SessionState
  /** Data perangkat baru yang harus ditulis ke kanvas. */
  data?: DeviceNodeData
  stream?: ExecResult['stream']
  save?: boolean
  clear?: boolean
  logout?: boolean
}

export function errorLines(dialect: Dialect, e: CliError): OutLine[] {
  return [err(`${dialect.errorPrefix}${e.message}`), ...(e.hint ? [hint(e.hint)] : [])]
}

/** Jalankan satu baris masukan, termasuk jawaban atas pertanyaan [Y/N] yang sedang menunggu. */
export function runLine(dialect: Dialect, ctx: Ctx, line: string): Outcome {
  let res: ExecResult
  const asking = ctx.state.confirm
  const base: Ctx = { ...ctx, state: { ...ctx.state, confirm: undefined } }
  try {
    res = asking ? asking.answer(line.trim(), base) : dialect.exec(base, line)
  } catch (e) {
    if (!(e instanceof CliError)) throw e
    res = { out: errorLines(dialect, e) }
  }

  let state: SessionState = { ...base.state, ...res.state }
  const out = [...(res.out ?? [])]
  let data: DeviceNodeData | undefined

  if (res.change) {
    try {
      if (dialect.twoStage({ ...base, state })) {
        // Uji dulu di kandidat supaya galat langsung terlihat, bukan baru saat commit.
        res.change(base.device, base.env)
        state = { ...state, pending: [...state.pending, { text: res.changeText ?? line.trim(), change: res.change }] }
      } else {
        data = res.change(base.active, base.env)
      }
    } catch (e) {
      if (!(e instanceof CliError)) throw e
      out.push(...errorLines(dialect, e))
    }
  }

  if (res.commit && state.pending.length > 0) {
    try {
      data = state.pending.reduce((d, p) => p.change(d, base.env), base.active)
      state = { ...state, pending: [] }
    } catch (e) {
      if (!(e instanceof CliError)) throw e
      out.push(...errorLines(dialect, e))
    }
  }

  // Baris penutup (Junos `[edit]`) harus muncul paling akhir — sesudah keluaran yang mengalir bila ada.
  const after: Ctx = { ...base, state, active: data ?? base.active, device: data ?? base.device }
  const tail = dialect.epilogue && !res.logout && !state.confirm ? dialect.epilogue(after) : []
  const stream = res.stream && tail.length ? { ...res.stream, lines: [...res.stream.lines, ...tail] } : res.stream
  if (!res.stream) out.push(...tail)

  return { out, state, data, stream, save: res.save, clear: res.clear, logout: res.logout }
}

/* ── Perangkat bantu untuk dialek berbasis pola ────────────────────────────── */

export type Spec = CommandSpec<ExecResult>

export interface SpecStyle {
  abbrev: boolean
  kwHelp: Record<string, string>
  paramLabel: (p: Extract<SynTok, { param: string }>) => string
  /** Pesan galat sintaks; `col` adalah kolom karakter (sudah termasuk panjang prompt). */
  syntaxError: (kind: 'unrecognized' | 'incomplete' | 'ambiguous', col: number, word: string, options: string[], line: string) => OutLine[]
  helpHeader?: string[]
  crLabel: string
}

export function runSpecs(specs: Spec[], tokens: Token[], style: SpecStyle, promptLen: number): ExecResult {
  if (tokens.length === 0) return {}
  const m = match(specs, tokens, style.abbrev)
  if (m.ok) return m.spec.run(m.args)
  const tok = tokens[m.at]
  const lastEnd = tokens.at(-1)!.start + tokens.at(-1)!.text.length
  const col = promptLen + (tok ? tok.start : lastEnd + 1)
  return { out: style.syntaxError(m.error, col, tok?.text ?? '', m.options, tokens.map((t) => t.text).join(' ')) }
}

/** Daftar bantuan `?` gaya VRP/IOS/Junos: kata di kiri, penjelasan di kanan. */
export function specHelp(specs: Spec[], line: string, style: SpecStyle): OutLine[] {
  const tokens = tokenize(line)
  const trailing = line.length === 0 || /\s$/.test(line)
  const partial = trailing ? null : (tokens.pop()?.text ?? '')
  const opts = nextOptions(specs, tokens, partial, style.kwHelp, style.abbrev)
  if (!opts || (opts.items.length === 0 && !opts.cr)) {
    return style.syntaxError('unrecognized', 0, partial ?? '', [], line).filter((l) => !l.text.trim().startsWith('^'))
  }
  if (partial !== null) {
    // Bantuan di tengah kata: cukup daftar kata yang cocok, berderet.
    return [{ text: opts.items.map((i) => i.word).join('  ') }]
  }
  const items: HelpItem[] = [...opts.items].sort((a, b) => {
    if (a.param && !b.param) return 1
    if (!a.param && b.param) return -1
    return a.word.localeCompare(b.word)
  })
  const label = (i: HelpItem) => (i.param ? style.paramLabel(i.param) : i.word)
  const width = Math.max(20, ...items.map((i) => label(i).length + 2))
  const outLines = (style.helpHeader ?? []).map((t) => ({ text: t }))
  for (const i of items) outLines.push({ text: `  ${label(i).padEnd(width)}${i.help}` })
  if (opts.cr) outLines.push({ text: `  ${style.crLabel}` })
  return outLines
}

/** Pelengkapan Tab: kata kunci yang unik dilengkapi, nama interface juga. */
export function specComplete(
  specs: Spec[],
  line: string,
  style: SpecStyle,
  ifaceNames: string[],
): { line: string; out?: OutLine[] } {
  if (line.length === 0 || /\s$/.test(line)) return { line }
  const tokens = tokenize(line)
  const last = tokens.pop()!
  const words = new Set<string>()
  const kw = nextOptions(specs, tokens, last.text, style.kwHelp, style.abbrev)
  for (const i of kw?.items ?? []) words.add(i.word)
  const params = nextOptions(specs, tokens, null, style.kwHelp, style.abbrev)
  if (params?.items.some((i) => i.param?.type === 'iface')) {
    for (const n of ifaceNames) if (n.toLowerCase().startsWith(last.text.toLowerCase())) words.add(n)
  }
  const list = [...words]
  if (list.length === 0) return { line }
  const head = line.slice(0, last.start)
  if (list.length === 1) return { line: `${head}${list[0]} ` }
  const common = commonPrefix(list)
  if (common.length > last.text.length) return { line: `${head}${common}` }
  return { line, out: [{ text: list.join('  ') }] }
}

function commonPrefix(words: string[]): string {
  let p = words[0] ?? ''
  for (const w of words) {
    while (!w.toLowerCase().startsWith(p.toLowerCase())) p = p.slice(0, -1)
  }
  return p
}

/* ── Filter pipa ─────────────────────────────────────────────────────────── */

type Filter = (lines: OutLine[], arg: string) => OutLine[]

const regexOf = (arg: string): RegExp => {
  try {
    return new RegExp(arg)
  } catch {
    return new RegExp(arg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  }
}

export const FILTERS: Record<string, Filter> = {
  include: (ls, a) => ls.filter((l) => regexOf(a).test(l.text)),
  exclude: (ls, a) => ls.filter((l) => !regexOf(a).test(l.text)),
  begin: (ls, a) => {
    const i = ls.findIndex((l) => regexOf(a).test(l.text))
    return i < 0 ? [] : ls.slice(i)
  },
  section: (ls, a) => {
    const out: OutLine[] = []
    let on = false
    for (const l of ls) {
      if (!/^\s/.test(l.text)) on = regexOf(a).test(l.text)
      if (on) out.push(l)
    }
    return out
  },
  count: (ls) => [{ text: `Count: ${ls.length} lines` }],
  'no-more': (ls) => ls,
}

/** Terapkan rangkaian pipa; nama filter boleh disingkat (`| i GE`). */
export function applyPipes(
  lines: OutLine[],
  pipes: string[],
  allowed: Record<string, string>,
): { ok: true; lines: OutLine[] } | { ok: false; bad: string } {
  let cur = lines
  for (const p of pipes) {
    const [name = '', ...rest] = p.split(/\s+/)
    const keys = Object.keys(allowed).filter((k) => k.startsWith(name.toLowerCase()))
    const key = keys.includes(name.toLowerCase()) ? name.toLowerCase() : keys.length === 1 ? keys[0]! : null
    if (!key) return { ok: false, bad: name }
    const f = FILTERS[allowed[key]!]
    if (!f) return { ok: false, bad: name }
    cur = f(cur, rest.join(' '))
  }
  return { ok: true, lines: cur }
}

export { splitPipe, tokenize }

/* ── Ping & traceroute ───────────────────────────────────────────────────── */

export interface PingRun {
  /** Interface sendiri yang menuju subnet tujuan tapi sedang mati — penjelasan paling berguna saat ping gagal. */
  downIface: string | null
  dst: number
  replies: (number | null)[]
  /** Jumlah hop sampai tujuan. */
  hops: number
  /** TTL di paket balasan: TTL awal OS tujuan dikurangi hop yang dilewati. */
  ttl: number
  src: number | null
  noRoute: boolean
}

/** TTL awal paket balasan: Huawei & Cisco 255, Junos/RouterOS/Linux 64. */
function initialTtl(ctx: Ctx, deviceId: string | null): number {
  const os = deviceId ? ctx.net().devices.get(deviceId)?.model?.os : undefined
  return os === 'vrp' || os === 'ios' ? 255 : 64
}

/** Jalankan ping simulasi: daftar waktu balasan (ms) atau null untuk timeout. */
export function simulatePing(ctx: Ctx, dstText: string, count: number, source?: string): PingRun {
  const dst = parseIp(dstText)
  if (dst === null) throw new CliError(`Invalid address ${dstText}.`)
  const srcIp = source ? parseIp(source) : null
  if (source && srcIp === null) throw new CliError(`Invalid source address ${source}.`)
  const r = ping(ctx.net(), ctx.env.deviceId, dst, srcIp ?? undefined)
  const seed = hash(`${ctx.env.deviceId}${dstText}`)
  const replies = Array.from({ length: count }, (_, i) => (r.ok ? rtt(r.hops, i, seed) : null))
  const ttl = initialTtl(ctx, r.target) - Math.max(0, r.hops - 1)
  const me = ctx.net().devices.get(ctx.env.deviceId)
  const down = r.ok
    ? null
    : (me?.ifaces.find((i) => i.addr && !i.up && i.kind !== 'loopback' && contains({ addr: networkOf(i.addr), prefix: i.addr.prefix }, { addr: dst, prefix: 32 })) ?? null)
  return { dst, replies, hops: r.hops, ttl, src: r.src, noRoute: r.noRoute, downIface: down ? down.name : null }
}

export function simulateTrace(ctx: Ctx, dstText: string) {
  const dst = parseIp(dstText)
  if (dst === null) throw new CliError(`Invalid address ${dstText}.`)
  return { dst, ...traceroute(ctx.net(), ctx.env.deviceId, dst) }
}

/** Penjelasan simulator saat ping gagal total. */
export function pingHint(run: Pick<PingRun, 'noRoute' | 'downIface'>): OutLine[] {
  if (run.downIface) {
    return [hint(`Interface ${run.downIface} yang menuju subnet ini sedang down (shutdown, kabel tidak ada, atau ujung lawannya mati), jadi rutenya ikut hilang.`)]
  }
  return [
    hint(
      run.noRoute
        ? 'Tidak ada rute ke tujuan ini. Simulasi hanya mengenal jaringan yang tersambung langsung dan rute statis — tambahkan rute statis bila tujuannya beberapa hop jauhnya.'
        : 'Paket tidak sampai atau balasannya tidak bisa pulang. Periksa kabel, shutdown, VLAN di sepanjang jalur, dan rute balik di perangkat tujuan.',
    ),
  ]
}

export const TRACE_STOP = 'Jejak dihentikan simulasi: tidak ada hop berikutnya yang membalas.'

export const ms = (v: number): string => String(Math.max(1, Math.round(v)))

export function stats(replies: (number | null)[]) {
  const got = replies.filter((r): r is number => r !== null)
  const min = got.length ? Math.min(...got) : 0
  const max = got.length ? Math.max(...got) : 0
  const avg = got.length ? got.reduce((a, b) => a + b, 0) / got.length : 0
  return { sent: replies.length, got: got.length, loss: replies.length ? ((replies.length - got.length) / replies.length) * 100 : 0, min, max, avg }
}

export type { Args }
