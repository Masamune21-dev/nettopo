import { create } from 'zustand'
import { getModel } from '@/data/deviceCatalog'
import { type CliRuntime, dialectIdFor, loadCli } from '@/lib/cli'
import type { Ctx, Dialect, OutLine, SessionState } from '@/lib/cli/types'
import type { World } from '@/lib/cli/engine'
import { saveProject } from '@/lib/persistence'
import { toTopology } from '@/lib/serialize'
import { uid } from '@/lib/id'
import { isDeviceNode } from './types'
import { useTopologyStore } from './useTopologyStore'

/**
 * Sesi konsol CLI per perangkat. Setiap perintah dijalankan terhadap data
 * kanvas saat itu juga, dan perubahan konfigurasi ditulis balik lewat
 * `replaceDeviceData` — jadi satu perintah = satu langkah undo.
 */

export interface ConsoleSession {
  id: string
  deviceId: string
  state: SessionState
  lines: OutLine[]
  history: string[]
  /** Keluaran sedang mengalir (ping/traceroute); masukan dikunci sampai selesai. */
  busy: boolean
  /** Perangkatnya sudah dihapus dari kanvas. */
  closed: boolean
}

interface ConsoleState {
  open: boolean
  height: number
  sessions: ConsoleSession[]
  activeId: string | null
  openFor: (deviceId: string) => void
  closeSession: (id: string) => void
  setActive: (id: string) => void
  setOpen: (open: boolean) => void
  setHeight: (height: number) => void
  submit: (id: string, line: string) => void
  /** Tampilkan baris tanpa menjalankan apa pun — dipakai bantuan `?` dan Tab. */
  print: (id: string, lines: OutLine[]) => void
  interrupt: (id: string) => void
  clear: (id: string) => void
}

const MAX_LINES = 3000

/** Timer keluaran bertahap per sesi, supaya Ctrl+C bisa menghentikannya. */
const timers = new Map<string, ReturnType<typeof setTimeout>[]>()

/** Mesin CLI, dimuat saat konsol pertama kali dibuka. Sebelum itu belum ada sesi sama sekali. */
let cli: CliRuntime | null = null

function world(): World {
  const s = useTopologyStore.getState()
  return { nodes: s.nodes, edges: s.edges }
}

export function dialectOf(deviceId: string): Dialect | null {
  const n = useTopologyStore.getState().nodes.find((x) => x.id === deviceId)
  if (!cli || !n || !isDeviceNode(n)) return null
  const id = dialectIdFor(getModel(n.data.modelId), n.data.role)
  return id ? cli.dialectById(id) : null
}

/** Jalankan `fn` dengan konteks dari keadaan kanvas terkini; null bila perangkatnya sudah tidak ada. */
export function withCtx<T>(session: ConsoleSession, fn: (ctx: Ctx, dialect: Dialect) => T): T | null {
  const dialect = dialectOf(session.deviceId)
  const ctx = dialect && cli ? cli.makeCtx(session.state, session.deviceId, world()) : null
  return dialect && ctx ? fn(ctx, dialect) : null
}

/** Prompt yang sedang berlaku — termasuk pertanyaan [Y/N] yang menunggu jawaban. */
export function promptOf(session: ConsoleSession): string {
  return withCtx(session, (ctx, d) => (session.state.confirm ? session.state.confirm.prompt : d.prompt(ctx))) ?? ''
}

function freshState(dialect: Dialect, deviceId: string): { state: SessionState; banner: OutLine[] } | null {
  const blank: SessionState = { mode: '', path: [], pending: [], vars: {} }
  const ctx = cli?.makeCtx(blank, deviceId, world())
  if (!ctx) return null
  const state = dialect.init(ctx)
  return { state, banner: dialect.banner({ ...ctx, state }) }
}

const trim = (lines: OutLine[]) => (lines.length > MAX_LINES ? lines.slice(-MAX_LINES) : lines)

/** Gabungkan baris; baris `append` disambung ke baris sebelumnya (`!!!!!` ping IOS). */
function appendLines(cur: OutLine[], add: OutLine[]): OutLine[] {
  const next = [...cur]
  for (const l of add) {
    const last = next.at(-1)
    if (l.append && last) next[next.length - 1] = { ...last, text: last.text + l.text }
    else next.push({ text: l.text, kind: l.kind })
  }
  return trim(next)
}

export const useConsoleStore = create<ConsoleState>()((set, get) => {
  const patch = (id: string, fn: (s: ConsoleSession) => Partial<ConsoleSession>) =>
    set((st) => ({ sessions: st.sessions.map((s) => (s.id === id ? { ...s, ...fn(s) } : s)) }))

  const stopTimers = (id: string) => {
    for (const t of timers.get(id) ?? []) clearTimeout(t)
    timers.delete(id)
  }

  return {
    open: false,
    height: 300,
    sessions: [],
    activeId: null,

    openFor: (deviceId) => {
      const existing = get().sessions.find((s) => s.deviceId === deviceId && !s.closed)
      if (existing) {
        set({ open: true, activeId: existing.id })
        return
      }
      const node = useTopologyStore.getState().nodes.find((n) => n.id === deviceId)
      if (!node || !isDeviceNode(node)) return
      if (!dialectIdFor(getModel(node.data.modelId), node.data.role)) {
        useTopologyStore.getState().pushToast(`${node.data.hostname} adalah perangkat pasif — tidak punya CLI.`, 'info')
        return
      }
      if (!cli) {
        loadCli()
          .then((m) => {
            cli = m
            get().openFor(deviceId)
          })
          .catch(() => useTopologyStore.getState().pushToast('Gagal memuat CLI — periksa koneksi lalu coba lagi.', 'error'))
        return
      }
      const dialect = dialectOf(deviceId)
      if (!dialect) return
      const fresh = freshState(dialect, deviceId)
      if (!fresh) return
      const session: ConsoleSession = {
        id: uid('con'),
        deviceId,
        state: fresh.state,
        lines: fresh.banner,
        history: [],
        busy: false,
        closed: false,
      }
      set((st) => ({ sessions: [...st.sessions, session], activeId: session.id, open: true }))
    },

    closeSession: (id) => {
      stopTimers(id)
      set((st) => {
        const sessions = st.sessions.filter((s) => s.id !== id)
        const activeId = st.activeId === id ? (sessions.at(-1)?.id ?? null) : st.activeId
        return { sessions, activeId }
      })
    },

    setActive: (id) => set({ activeId: id }),
    setOpen: (open) => set({ open }),
    setHeight: (height) => set({ height }),

    print: (id, lines) => patch(id, (s) => ({ lines: appendLines(s.lines, lines) })),

    clear: (id) => patch(id, () => ({ lines: [] })),

    interrupt: (id) => {
      const s = get().sessions.find((x) => x.id === id)
      if (!s?.busy) return
      stopTimers(id)
      patch(id, (cur) => ({ busy: false, lines: appendLines(cur.lines, [{ text: '^C' }]) }))
    },

    submit: (id, line) => {
      const session = get().sessions.find((s) => s.id === id)
      if (!session || session.busy || session.closed) return
      const dialect = dialectOf(session.deviceId)
      const ctx = dialect && cli ? cli.makeCtx(session.state, session.deviceId, world()) : null
      if (!dialect || !ctx || !cli) {
        patch(id, (s) => ({ closed: true, lines: appendLines(s.lines, [{ text: 'Connection closed by foreign host.', kind: 'err' }]) }))
        return
      }

      const echo: OutLine = { text: `${promptOf(session)}${line}`, kind: 'echo' }
      const answering = Boolean(session.state.confirm)
      const history =
        !answering && line.trim() && session.history.at(-1) !== line ? [...session.history, line].slice(-200) : session.history

      let outcome
      try {
        outcome = cli.runLine(dialect, ctx, line)
      } catch (e) {
        console.error(e)
        patch(id, (s) => ({
          history,
          lines: appendLines(s.lines, [echo, { text: `% Galat simulator: ${(e as Error).message}`, kind: 'err' }]),
        }))
        return
      }

      const topo = useTopologyStore.getState()
      if (outcome.data) topo.replaceDeviceData(session.deviceId, outcome.data)
      if (outcome.save) {
        const t = useTopologyStore.getState()
        const ok = saveProject(toTopology({ projectId: t.projectId, projectName: t.projectName, site: t.site }, t.nodes, t.edges))
        if (ok) t.markClean()
      }

      let state = outcome.state
      let shown = outcome.clear ? [] : appendLines(session.lines, [echo, ...outcome.out])
      if (outcome.logout) {
        const fresh = freshState(dialect, session.deviceId)
        if (fresh) {
          state = fresh.state
          shown = appendLines(shown, [{ text: '' }, ...fresh.banner])
        }
      }

      const stream = outcome.stream
      patch(id, () => ({ state, history, lines: shown, busy: Boolean(stream?.lines.length) }))
      if (!stream?.lines.length) return

      const handles = stream.lines.map((l, i) =>
        setTimeout(() => {
          const last = i === stream.lines.length - 1
          patch(id, (s) => ({ lines: appendLines(s.lines, [l]), busy: !last }))
          if (last) timers.delete(id)
        }, (i + 1) * stream.interval),
      )
      timers.set(id, handles)
    },
  }
})

// Sesi milik perangkat yang dihapus dari kanvas ditandai tertutup.
useTopologyStore.subscribe((s, prev) => {
  if (s.nodes === prev.nodes) return
  const ids = new Set(s.nodes.map((n) => n.id))
  const stale = useConsoleStore.getState().sessions.filter((x) => !x.closed && !ids.has(x.deviceId))
  if (stale.length === 0) return
  useConsoleStore.setState((st) => ({
    sessions: st.sessions.map((x) =>
      stale.includes(x) ? { ...x, closed: true, busy: false, lines: appendLines(x.lines, [{ text: '' }, { text: 'Connection closed by foreign host.', kind: 'err' }]) } : x,
    ),
  }))
})
