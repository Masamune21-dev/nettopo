import { Eraser, SquareTerminal, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { DIALECT_LABEL } from '@/lib/cli'
import type { OutLine } from '@/lib/cli/types'
import { type ConsoleSession, dialectOf, promptOf, useConsoleStore, withCtx } from '@/store/useConsoleStore'
import { useTopologyStore } from '@/store/useTopologyStore'
import { isDeviceNode } from '@/store/types'
import { adaptQuick, DIALECT_SHORT, type QuickCommand, QUICK_COMMANDS } from './quickCommands'

/** Warna terminal sengaja tetap gelap di tema terang maupun gelap, seperti terminal sungguhan. */
const TERM_BG = '#0b1020'

const LINE_COLOR: Record<NonNullable<OutLine['kind']>, string> = {
  out: '#d4d4d8',
  echo: '#f4f4f5',
  err: '#fca5a5',
  hint: '#7dd3fc',
}

function Line({ line }: { line: OutLine }) {
  if (line.kind === 'hint') {
    return (
      <div
        className="my-0.5 whitespace-pre-wrap border-l-2 pl-2 font-sans text-[11.5px] leading-snug"
        style={{ color: LINE_COLOR.hint, borderColor: '#0ea5e955' }}
      >
        {line.text}
      </div>
    )
  }
  return <div style={{ color: LINE_COLOR[line.kind ?? 'out'] }}>{line.text || ' '}</div>
}

function Terminal({ session }: { session: ConsoleSession }) {
  const submit = useConsoleStore((s) => s.submit)
  const print = useConsoleStore((s) => s.print)
  const interrupt = useConsoleStore((s) => s.interrupt)
  const clear = useConsoleStore((s) => s.clear)
  // Prompt ikut berubah saat hostname diganti, baik dari CLI maupun dari panel kanan.
  const deviceData = useTopologyStore((s) => s.nodes.find((n) => n.id === session.deviceId)?.data)
  const [value, setValue] = useState('')
  const [histIdx, setHistIdx] = useState<number | null>(null)
  const scroller = useRef<HTMLDivElement>(null)
  const input = useRef<HTMLInputElement>(null)

  const prompt = useMemo(() => (deviceData ? promptOf(session) : ''), [session, deviceData])
  const dialect = useMemo(() => (deviceData ? dialectOf(session.deviceId) : null), [session.deviceId, deviceData])

  useEffect(() => {
    const el = scroller.current
    if (el) el.scrollTop = el.scrollHeight
  }, [session.lines.length, session.busy])

  useEffect(() => {
    if (!session.busy) input.current?.focus()
  }, [session.busy, session.id])

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      const ctrl = e.ctrlKey && !e.metaKey
      if (ctrl && e.key.toLowerCase() === 'c') {
        e.preventDefault()
        if (session.busy) interrupt(session.id)
        else {
          print(session.id, [{ text: `${prompt}${value}^C`, kind: 'echo' }])
          setValue('')
        }
        return
      }
      if (ctrl && e.key.toLowerCase() === 'l') {
        e.preventDefault()
        clear(session.id)
        return
      }
      if (ctrl && e.key.toLowerCase() === 'z' && dialect?.ctrlZ) {
        e.preventDefault()
        submit(session.id, dialect.ctrlZ)
        setValue('')
        return
      }
      if (ctrl && e.key.toLowerCase() === 'u') {
        e.preventDefault()
        setValue('')
        return
      }
      if (session.busy) return

      if (e.key === 'Enter') {
        e.preventDefault()
        submit(session.id, value)
        setValue('')
        setHistIdx(null)
        return
      }
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        e.preventDefault()
        const h = session.history
        if (h.length === 0) return
        let idx = histIdx ?? h.length
        idx = e.key === 'ArrowUp' ? Math.max(0, idx - 1) : idx + 1
        if (idx >= h.length) {
          setHistIdx(null)
          setValue('')
        } else {
          setHistIdx(idx)
          setValue(h[idx] ?? '')
        }
        return
      }
      if (!dialect) return
      if (e.key === 'Tab') {
        e.preventDefault()
        const res = completeLine(session, value)
        if (res.out?.length) print(session.id, [{ text: `${prompt}${value}`, kind: 'echo' }, ...res.out])
        setValue(res.line)
        return
      }
      if (e.key === '?' && dialect.id !== 'linux' && !session.state.confirm) {
        e.preventDefault()
        print(session.id, [{ text: `${prompt}${value}?`, kind: 'echo' }, ...helpLines(session, value)])
      }
    },
    [clear, dialect, histIdx, interrupt, print, prompt, session, submit, value],
  )

  const runQuick = (q: QuickCommand) => {
    if (!dialect) return
    const steps = adaptQuick(dialect.id, session.state.mode, q.cmd)
    const last = steps.at(-1) ?? q.cmd
    for (const c of q.insert ? steps.slice(0, -1) : steps) submit(session.id, c)
    setValue(q.insert ? last : '')
    setHistIdx(null)
    input.current?.focus()
  }
  const locked = session.busy || Boolean(session.state.confirm)

  return (
    <div className="flex min-h-0 flex-1 flex-col" style={{ background: TERM_BG }}>
      {dialect && !session.closed ? (
        <div className="thin-scroll flex shrink-0 items-center gap-1 overflow-x-auto border-b px-3 py-1.5" style={{ borderColor: '#1e293b' }}>
          <span className="mr-1 shrink-0 text-[10.5px]" style={{ color: '#64748b' }}>
            Coba:
          </span>
          {QUICK_COMMANDS[dialect.id].map((q) => (
            <button
              key={q.label}
              type="button"
              disabled={locked}
              className="shrink-0 rounded-full border px-2 py-0.5 text-[11px] transition-colors hover:bg-white/10 disabled:opacity-40"
              style={{ borderColor: '#334155', color: '#cbd5e1' }}
              title={`${q.hint}\n${q.cmd.trim()}`}
              onClick={() => runQuick(q)}
            >
              {q.label}
            </button>
          ))}
        </div>
      ) : null}
      <div
        ref={scroller}
        className="thin-scroll min-h-0 flex-1 overflow-auto px-3 py-2 font-mono text-[12px] leading-[1.45]"
        style={{ whiteSpace: 'pre' }}
        onMouseUp={() => {
          if (!window.getSelection()?.toString()) input.current?.focus()
        }}
      >
        {session.lines.map((l, i) => (
          <Line key={i} line={l} />
        ))}
        {session.closed ? null : (
          <div className="flex items-center" style={{ color: LINE_COLOR.echo, visibility: session.busy ? 'hidden' : 'visible' }}>
            <span>{prompt}</span>
            <input
              ref={input}
              value={value}
              onChange={(e) => {
                const next = e.target.value
                // `?` di akhir baris memunculkan bantuan tanpa ikut masuk ke baris — seperti perangkat asli.
                // Ditangani di sini juga (bukan cuma keydown) agar jalan di keyboard virtual dan IME.
                if (next === `${value}?` && dialect && dialect.id !== 'linux' && !session.state.confirm && !session.busy) {
                  print(session.id, [{ text: `${prompt}${value}?`, kind: 'echo' }, ...helpLines(session, value)])
                  return
                }
                setValue(next)
                setHistIdx(null)
              }}
              onKeyDown={onKeyDown}
              className="min-w-0 flex-1 border-0 bg-transparent p-0 font-mono text-[12px] outline-none"
              style={{ color: LINE_COLOR.echo, caretColor: '#a5b4fc' }}
              spellCheck={false}
              autoComplete="off"
              autoCapitalize="off"
              autoCorrect="off"
              aria-label="Masukan perintah CLI"
            />
          </div>
        )}
      </div>
    </div>
  )
}

/** Bantuan `?` dan Tab selalu dihitung dari keadaan kanvas terkini. */
const helpLines = (session: ConsoleSession, line: string): OutLine[] =>
  withCtx(session, (ctx, d) => d.help(ctx, line)) ?? []

const completeLine = (session: ConsoleSession, line: string): { line: string; out?: OutLine[] } =>
  withCtx(session, (ctx, d) => d.complete(ctx, line)) ?? { line }

function Tab({ session, active }: { session: ConsoleSession; active: boolean }) {
  const setActive = useConsoleStore((s) => s.setActive)
  const closeSession = useConsoleStore((s) => s.closeSession)
  const host = useTopologyStore((s) => {
    const n = s.nodes.find((x) => x.id === session.deviceId)
    return n && isDeviceNode(n) ? n.data.hostname : null
  })
  const id = dialectOf(session.deviceId)?.id
  const label = id ? DIALECT_LABEL[id] : undefined
  return (
    <div
      className="group flex shrink-0 items-center gap-1 rounded-t-md border border-b-0 px-2 py-1 text-[11px]"
      style={{
        background: active ? TERM_BG : 'transparent',
        borderColor: active ? '#1e293b' : 'transparent',
        color: active ? '#e2e8f0' : 'var(--muted)',
      }}
    >
      <button type="button" className="flex items-center gap-1.5" onClick={() => setActive(session.id)} title={label}>
        <span className="size-1.5 rounded-full" style={{ background: session.closed ? '#ef4444' : '#22c55e' }} />
        <span className={`font-mono ${session.closed ? 'line-through' : ''}`}>{host ?? 'terputus'}</span>
        {id ? (
          <span className="rounded px-1 text-[9.5px] font-semibold" style={{ background: '#ffffff14', color: '#94a3b8' }}>
            {DIALECT_SHORT[id]}
          </span>
        ) : null}
      </button>
      <button
        type="button"
        className="rounded p-0.5 opacity-60 hover:bg-white/10 hover:opacity-100"
        onClick={() => closeSession(session.id)}
        title="Tutup sesi"
      >
        <X size={11} />
      </button>
    </div>
  )
}

export function ConsolePanel() {
  const open = useConsoleStore((s) => s.open)
  const height = useConsoleStore((s) => s.height)
  const sessions = useConsoleStore((s) => s.sessions)
  const activeId = useConsoleStore((s) => s.activeId)
  const setOpen = useConsoleStore((s) => s.setOpen)
  const setHeight = useConsoleStore((s) => s.setHeight)
  const clear = useConsoleStore((s) => s.clear)
  const active = sessions.find((s) => s.id === activeId) ?? null

  const startResize = (e: React.PointerEvent) => {
    e.preventDefault()
    const startY = e.clientY
    const startH = height
    const onMove = (ev: PointerEvent) => {
      const max = Math.round(window.innerHeight * 0.75)
      setHeight(Math.min(max, Math.max(140, startH + (startY - ev.clientY))))
    }
    const onUp = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  if (!open) return null

  return (
    <section className="relative flex shrink-0 flex-col border-t" style={{ height, borderColor: 'var(--border)', background: 'var(--panel)' }} aria-label="Konsol CLI">
      <div
        className="absolute inset-x-0 -top-1 z-10 h-2 cursor-row-resize"
        onPointerDown={startResize}
        title="Seret untuk mengubah tinggi konsol"
      />
      <header className="flex items-end gap-1 px-2 pt-1.5">
        <span className="mb-1 mr-1 flex items-center gap-1 text-[11px] font-semibold" style={{ color: 'var(--muted)' }}>
          <SquareTerminal size={13} /> CLI
        </span>
        <div className="thin-scroll flex min-w-0 flex-1 items-end gap-0.5 overflow-x-auto">
          {sessions.map((s) => (
            <Tab key={s.id} session={s} active={s.id === activeId} />
          ))}
        </div>
        {active ? (
          <button type="button" className="btn mb-1 px-1.5 py-0.5" onClick={() => clear(active.id)} title="Bersihkan layar (Ctrl+L)">
            <Eraser size={12} />
          </button>
        ) : null}
        <button type="button" className="btn mb-1 px-1.5 py-0.5" onClick={() => setOpen(false)} title="Sembunyikan konsol">
          <X size={12} />
        </button>
      </header>
      {active ? (
        <Terminal key={active.id} session={active} />
      ) : (
        <div className="flex flex-1 items-center justify-center text-[12px]" style={{ background: TERM_BG, color: '#94a3b8' }}>
          Klik ganda perangkat di kanvas untuk membuka CLI-nya.
        </div>
      )}
    </section>
  )
}
