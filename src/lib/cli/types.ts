import type { DeviceModel } from '@/data/deviceCatalog'
import type { DeviceNodeData } from '@/store/types'
import type { Net } from './net'

export type LineKind = 'out' | 'err' | 'hint' | 'echo'

export interface OutLine {
  text: string
  kind?: LineKind
  /** Sambung ke baris sebelumnya — untuk `!!!!!` ping IOS yang muncul satu per satu. */
  append?: boolean
}

/**
 * Galat konfigurasi. `message` ditulis dalam bahasa perangkat (Inggris) dan
 * diberi awalan sesuai dialek; `hint` adalah penjelasan simulator dalam
 * bahasa Indonesia, ditampilkan terpisah supaya tidak tercampur keluaran asli.
 */
export class CliError extends Error {
  hint?: string
  constructor(message: string, hint?: string) {
    super(message)
    this.hint = hint
  }
}

export interface DeviceEnv {
  deviceId: string
  model: DeviceModel | undefined
  /** Id port/trunk yang punya kabel di kanvas. */
  linked: Set<string>
}

/** Perubahan konfigurasi: fungsi murni atas data perangkat. Melempar CliError bila ditolak. */
export type Change = (d: DeviceNodeData, env: DeviceEnv) => DeviceNodeData

export interface Pending {
  /** Bentuk teks perintahnya, untuk `show | compare` dan sejenisnya. */
  text: string
  change: Change
}

export interface Confirm {
  prompt: string
  answer: (input: string, ctx: Ctx) => ExecResult
}

export interface SessionState {
  /** Mode CLI, khas tiap dialek: user / system / interface / config … */
  mode: string
  /** Interface yang sedang dikonfigurasi. */
  iface?: string
  /** Junos: hierarki `edit`; RouterOS: menu aktif. */
  path: string[]
  /** Perubahan yang belum di-commit (Junos, VRP8). */
  pending: Pending[]
  vars: Record<string, string>
  /** Pertanyaan yang sedang menunggu jawaban, mis. `[Y/N]`. */
  confirm?: Confirm
}

export interface ExecResult {
  out?: OutLine[]
  state?: Partial<SessionState>
  change?: Change
  changeText?: string
  /** Terapkan semua perubahan yang tertunda. */
  commit?: boolean
  /** Baris yang muncul bertahap, seperti balasan ping. */
  stream?: { lines: OutLine[]; interval: number }
  save?: boolean
  clear?: boolean
  logout?: boolean
}

export interface Ctx {
  state: SessionState
  /** Konfigurasi kandidat: yang berjalan + perubahan yang belum di-commit. */
  device: DeviceNodeData
  /** Konfigurasi yang sedang berjalan (sama dengan kanvas). */
  active: DeviceNodeData
  env: DeviceEnv
  net: () => Net
  now: Date
}

export type DialectId = 'vrp' | 'ios' | 'junos' | 'routeros' | 'linux'

export interface Dialect {
  id: DialectId
  init: (ctx: Omit<Ctx, 'state'>) => SessionState
  banner: (ctx: Ctx) => OutLine[]
  prompt: (ctx: Ctx) => string
  exec: (ctx: Ctx, line: string) => ExecResult
  /** Bantuan `?` untuk baris yang sedang diketik. */
  help: (ctx: Ctx, line: string) => OutLine[]
  /** Pelengkapan Tab: baris baru, dan daftar pilihan bila rancu. */
  complete: (ctx: Ctx, line: string) => { line: string; out?: OutLine[] }
  /** Perubahan ditampung dulu dan baru berlaku setelah `commit`. */
  twoStage: (ctx: Ctx) => boolean
  /** Awalan pesan galat: "Error: ", "% ", "error: " … */
  errorPrefix: string
  /** Baris tambahan sesudah setiap keluaran — Junos menulis `[edit]` di sini. */
  epilogue?: (ctx: Ctx) => OutLine[]
  /** Perintah yang dikirim Ctrl+Z, bila dialek mengenalnya. */
  ctrlZ?: string
}

export const out = (text: string): OutLine => ({ text })
export const err = (text: string): OutLine => ({ text, kind: 'err' })
export const hint = (text: string): OutLine => ({ text, kind: 'hint' })
export const lines = (text: string): OutLine[] => text.split('\n').map(out)
