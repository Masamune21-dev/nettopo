import { useReactFlow } from '@xyflow/react'
import {
  Check,
  ChevronDown,
  Download,
  Eye,
  FolderOpen,
  HelpCircle,
  LayoutGrid,
  Moon,
  PanelRight,
  Plus,
  Redo2,
  Save,
  Search,
  Network,
  Sparkles,
  SquareTerminal,
  StickyNote,
  Sun,
  Undo2,
  Upload,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { downloadCsvBundle } from '@/lib/exportCsv'
import { fitViewWhenReady } from '@/lib/fitView'
import { downloadText, slugify } from '@/lib/download'
import { exportPng, exportSvg } from '@/lib/exportImage'
import type { AlignMode, DistributeMode, LayoutDirection } from '@/lib/layout'
import { uid } from '@/lib/id'
import { listProjects, saveProject } from '@/lib/persistence'
import { fromTopology, parseTopology, toTopology } from '@/lib/serialize'
import { useConsoleStore } from '@/store/useConsoleStore'
import { useTopologyStore } from '@/store/useTopologyStore'
import { useUiStore } from '@/store/useUiStore'
import { isDeviceNode } from '@/store/types'

function Menu({
  label,
  icon,
  title,
  align = 'left',
  children,
}: {
  label: string
  icon: React.ReactNode
  /** Keterangan saat disorot; bawaannya sama dengan label. */
  title?: string
  /** Menu di ujung kanan toolbar dibuka rata kanan supaya tidak keluar layar. */
  align?: 'left' | 'right'
  children: (close: () => void) => React.ReactNode
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  return (
    <div className="relative" ref={ref}>
      <button type="button" className="btn" onClick={() => setOpen((v) => !v)} title={title ?? label} aria-expanded={open}>
        {icon}
        <span className="hidden xl:inline">{label}</span>
        <ChevronDown size={12} />
      </button>
      {open ? (
        <div
          className={`absolute ${align === 'right' ? 'right-0' : 'left-0'} top-full z-50 mt-1 min-w-[190px] overflow-hidden rounded-md border py-1 shadow-lg`}
          style={{ background: 'var(--panel)', borderColor: 'var(--border)' }}
        >
          {children(() => setOpen(false))}
        </div>
      ) : null}
    </div>
  )
}

function MenuItem({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-2 whitespace-nowrap px-3 py-1.5 text-left text-[12px] hover:bg-black/5 dark:hover:bg-white/5"
    >
      {children}
    </button>
  )
}

/** Pilihan hidup/mati di menu: tanda centang di kiri supaya statusnya terbaca sekilas. */
function ToggleItem({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <MenuItem onClick={onClick}>
      <span className="flex w-3.5 justify-center" style={{ color: '#4f46e5' }}>
        {on ? <Check size={13} /> : null}
      </span>
      {children}
    </MenuItem>
  )
}

function MenuHeading({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-3 pb-0.5 pt-1 text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--muted)' }}>
      {children}
    </div>
  )
}

const MenuDivider = () => <div className="my-1 border-t" style={{ borderColor: 'var(--border)' }} />

function DeviceSearch() {
  const [q, setQ] = useState('')
  const nodes = useTopologyStore((s) => s.nodes)
  const selectOnly = useTopologyStore((s) => s.selectOnly)
  const { setCenter } = useReactFlow()

  const matches = q.trim()
    ? nodes.filter(isDeviceNode).filter((n) => {
        const needle = q.toLowerCase()
        return (
          n.data.hostname.toLowerCase().includes(needle) ||
          n.data.mgmtIp.includes(needle) ||
          n.data.site.toLowerCase().includes(needle) ||
          n.data.ports.some((p) => p.name.toLowerCase().includes(needle))
        )
      })
    : []

  const go = (id: string) => {
    const n = nodes.find((x) => x.id === id)
    selectOnly(id)
    if (n) {
      setCenter(n.position.x + (n.measured?.width ?? 240) / 2, n.position.y + (n.measured?.height ?? 140) / 2, {
        zoom: 1.2,
        duration: 400,
      })
    }
    setQ('')
  }

  return (
    <div className="relative w-52 min-w-[150px] shrink">
      <Search
        size={13}
        className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2"
        style={{ color: 'var(--muted)' }}
      />
      <input
        className="field pl-7"
        placeholder="Cari host / IP / port…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && matches[0]) go(matches[0].id)
          if (e.key === 'Escape') setQ('')
        }}
      />
      {matches.length > 0 ? (
        <ul
          className="thin-scroll absolute left-0 top-full z-50 mt-1 max-h-64 w-72 overflow-y-auto rounded-md border py-1 shadow-lg"
          style={{ background: 'var(--panel)', borderColor: 'var(--border)' }}
        >
          {matches.slice(0, 12).map((n) => (
            <li key={n.id}>
              <button
                type="button"
                className="flex w-full flex-col items-start px-3 py-1 text-left hover:bg-black/5 dark:hover:bg-white/5"
                onClick={() => go(n.id)}
              >
                <span className="text-[12px] font-medium">{n.data.hostname}</span>
                <span className="text-[10px]" style={{ color: 'var(--muted)' }}>
                  {n.data.mgmtIp || '—'} · {n.data.ports.length} port
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}

export function Toolbar() {
  const store = useTopologyStore()
  const ui = useUiStore()
  const { getNodes, fitView } = useReactFlow()
  const fileRef = useRef<HTMLInputElement>(null)

  const meta = { projectId: store.projectId, projectName: store.projectName, site: store.site }
  const snapshot = () => toTopology(meta, store.nodes, store.edges)
  const slug = () => slugify(store.projectName)

  const doSave = () => {
    const ok = saveProject(snapshot())
    store.pushToast(ok ? 'Topologi tersimpan di browser.' : 'Gagal menyimpan (storage penuh?).', ok ? 'ok' : 'error')
    if (ok) store.markClean()
  }

  /**
   * Memindahkan port ke sisi lain mengubah tinggi node; sebelum pengukuran
   * ulang selesai, fitView tidak melakukan apa-apa. Karena itu dicoba ulang.
   */
  const fitSoon = () => void fitViewWhenReady(fitView, { padding: 0.18, duration: 400 })

  const doLayout = (direction: LayoutDirection) => {
    store.tidyUp(direction)
    fitSoon()
  }

  const onImportFile = async (file: File) => {
    const parsed = parseTopology(await file.text())
    if (!parsed.ok) {
      store.pushToast(parsed.error, 'error')
      return
    }
    const { nodes, edges, meta: m } = fromTopology(parsed.data)
    // Berkas lama dari proyek yang masih dipakai membawa id yang sama; kalau
    // dipakai apa adanya, simpan otomatis berikutnya menimpa versi terbaru.
    const taken = m.projectId === store.projectId || listProjects().some((p) => p.id === m.projectId)
    if (taken) m.projectId = uid('prj')
    store.replaceAll({ nodes, edges, ...m })
    store.pushToast(`"${m.projectName}" dimuat — ${nodes.length} objek.`, 'ok')
    if (parsed.fixes.length > 0) {
      store.pushToast(
        `${parsed.fixes.length} rujukan rusak di berkas dibuang, mis.: ${parsed.fixes[0]}`,
        'warn',
      )
    }
    fitSoon()
  }

  const exportImage = async (kind: 'png' | 'svg') => {
    try {
      const fn = kind === 'png' ? exportPng : exportSvg
      await fn(getNodes(), `${slug()}.${kind}`)
      store.pushToast(`Gambar ${kind.toUpperCase()} diunduh.`, 'ok')
    } catch (err) {
      store.pushToast(`Gagal membuat ${kind.toUpperCase()}: ${(err as Error).message}`, 'error')
    }
  }

  return (
    <header
      className="flex h-[52px] shrink-0 items-center gap-1.5 border-b px-3"
      style={{ background: 'var(--panel)', borderColor: 'var(--border)' }}
    >
      <div className="mr-1 flex min-w-0 shrink items-center gap-2">
        <span
          className="flex size-7 items-center justify-center rounded-md text-[13px] font-black text-white"
          style={{ background: '#4f46e5' }}
        >
          N
        </span>
        <div className="min-w-0 leading-none">
          <div className="truncate text-[13px] font-semibold">
            {store.projectName}
            {store.dirty ? <span style={{ color: '#f59e0b' }}> •</span> : null}
          </div>
          <div className="truncate text-[10px]" style={{ color: 'var(--muted)' }}>
            {store.nodes.filter(isDeviceNode).length} perangkat · {store.edges.length} link
          </div>
        </div>
      </div>

      <span className="mx-1 h-6 w-px" style={{ background: 'var(--border)' }} />

      <button type="button" className="btn" onClick={doSave} title="Simpan (Cmd/Ctrl+S)">
        <Save size={13} /> <span className="hidden xl:inline">Simpan</span>
      </button>

      <Menu label="Buka" icon={<FolderOpen size={13} />} title="Buka topologi tersimpan, buat baru, atau impor file JSON">
        {(close) => (
          <>
            <MenuItem
              onClick={() => {
                ui.set('projectsOpen', true)
                close()
              }}
            >
              <FolderOpen size={13} /> Topologi tersimpan / baru…
            </MenuItem>
            <MenuItem
              onClick={() => {
                fileRef.current?.click()
                close()
              }}
            >
              <Upload size={13} /> Impor file JSON…
            </MenuItem>
          </>
        )}
      </Menu>
      <input
        ref={fileRef}
        type="file"
        accept="application/json,.json"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) void onImportFile(f)
          e.target.value = ''
        }}
      />

      <Menu label="Ekspor" icon={<Download size={13} />}>
        {(close) => (
          <>
            <MenuItem
              onClick={() => {
                downloadText(JSON.stringify(snapshot(), null, 2), `${slug()}.json`)
                close()
              }}
            >
              JSON (bisa diimpor lagi)
            </MenuItem>
            <MenuItem
              onClick={() => {
                void exportImage('png')
                close()
              }}
            >
              Gambar PNG (2×)
            </MenuItem>
            <MenuItem
              onClick={() => {
                void exportImage('svg')
                close()
              }}
            >
              Gambar SVG (vektor)
            </MenuItem>
            <MenuItem
              onClick={() => {
                downloadCsvBundle(snapshot(), slug())
                close()
              }}
            >
              CSV perangkat + link + interface
            </MenuItem>
          </>
        )}
      </Menu>

      <span className="mx-1 h-6 w-px" style={{ background: 'var(--border)' }} />

      <button type="button" className="btn" onClick={store.undo} disabled={store.past.length === 0} title="Undo (Cmd/Ctrl+Z)">
        <Undo2 size={13} />
      </button>
      <button type="button" className="btn" onClick={store.redo} disabled={store.future.length === 0} title="Redo (Shift+Cmd/Ctrl+Z)">
        <Redo2 size={13} />
      </button>

      <Menu label="Rapikan" icon={<LayoutGrid size={13} />}>
        {(close) => (
          <>
            <MenuItem
              onClick={() => {
                doLayout('TB')
                close()
              }}
            >
              Berjenjang atas → bawah
            </MenuItem>
            <MenuItem
              onClick={() => {
                doLayout('LR')
                close()
              }}
            >
              Berjenjang kiri → kanan
            </MenuItem>
            <MenuItem
              onClick={() => {
                fitView({ duration: 450, padding: 0.18 })
                close()
              }}
            >
              Paskan ke layar
            </MenuItem>

            <MenuDivider />
            <MenuHeading>Objek terpilih</MenuHeading>
            {(
              [
                ['left', 'Rata kiri'],
                ['hcenter', 'Rata tengah (mendatar)'],
                ['right', 'Rata kanan'],
                ['top', 'Rata atas'],
                ['vcenter', 'Rata tengah (tegak)'],
                ['bottom', 'Rata bawah'],
              ] as [AlignMode, string][]
            ).map(([mode, label]) => (
              <MenuItem
                key={mode}
                onClick={() => {
                  store.alignSelected(mode)
                  close()
                }}
              >
                {label}
              </MenuItem>
            ))}
            {(
              [
                ['horizontal', 'Sebar merata mendatar'],
                ['vertical', 'Sebar merata tegak'],
              ] as [DistributeMode, string][]
            ).map(([mode, label]) => (
              <MenuItem
                key={mode}
                onClick={() => {
                  store.distributeSelected(mode)
                  close()
                }}
              >
                {label}
              </MenuItem>
            ))}
          </>
        )}
      </Menu>

      <button
        type="button"
        className="btn"
        onClick={() => ui.set('aiOpen', true)}
        title="Asisten AI: konfigurasi, audit, dokumentasi, rapikan, buat dari deskripsi"
        style={{ color: '#818cf8' }}
      >
        <Sparkles size={13} /> <span className="hidden xl:inline">AI</span>
      </button>

      <button
        type="button"
        className="btn"
        onClick={() => ui.set('ipamOpen', true)}
        title="Alamat IP: daftar subnet, pemberian alamat otomatis, ekspor rencana"
      >
        <Network size={13} /> <span className="hidden xl:inline">IP</span>
      </button>

      <button
        type="button"
        className="btn"
        onClick={() => {
          // Perangkat yang sedang dipilih langsung dibuka; selain itu panel konsol ditampilkan/disembunyikan.
          const picked = store.nodes.find((n) => n.selected && isDeviceNode(n))
          const con = useConsoleStore.getState()
          if (picked) con.openFor(picked.id)
          else con.setOpen(!con.open)
        }}
        title="CLI perangkat seperti di Packet Tracer — klik ganda perangkat untuk membuka konsolnya"
      >
        <SquareTerminal size={13} /> <span className="hidden xl:inline">CLI</span>
      </button>

      <Menu label="Tambah" icon={<Plus size={13} />}>
        {(close) => (
          <>
            <MenuItem
              onClick={() => {
                store.addGroup({ x: 40, y: 40 })
                close()
              }}
            >
              <LayoutGrid size={13} /> Area / POP
            </MenuItem>
            <MenuItem
              onClick={() => {
                store.addNote({ x: 80, y: 80 })
                close()
              }}
            >
              <StickyNote size={13} /> Catatan
            </MenuItem>
          </>
        )}
      </Menu>

      <div className="flex-1" />

      <DeviceSearch />

      <Menu label="Tampilan" icon={<Eye size={13} />} title="Label port, grid, dan tema" align="right">
        {(close) => (
          <>
            <ToggleItem
              on={ui.showPortLabels}
              onClick={() => {
                ui.set('showPortLabels', !ui.showPortLabels)
                close()
              }}
            >
              Nama port di ujung kabel
            </ToggleItem>
            <ToggleItem
              on={ui.snapToGrid}
              onClick={() => {
                ui.set('snapToGrid', !ui.snapToGrid)
                close()
              }}
            >
              Tempel ke grid saat digeser
            </ToggleItem>
            <MenuDivider />
            <MenuHeading>Ukuran grid</MenuHeading>
            {[8, 16, 24, 32].map((size) => (
              <ToggleItem
                key={size}
                on={ui.gridSize === size}
                onClick={() => {
                  ui.set('gridSize', size)
                  close()
                }}
              >
                {size} px{size === 16 ? ' (bawaan)' : ''}
              </ToggleItem>
            ))}
            <MenuDivider />
            <MenuItem
              onClick={() => {
                ui.toggleTheme()
                close()
              }}
            >
              <span className="flex w-3.5 justify-center">{ui.theme === 'dark' ? <Sun size={13} /> : <Moon size={13} />}</span>
              {ui.theme === 'dark' ? 'Tema terang' : 'Tema gelap'}
            </MenuItem>
          </>
        )}
      </Menu>
      <button
        type="button"
        className="btn"
        onClick={() => ui.set('inspectorOpen', !ui.inspectorOpen)}
        title="Panel properti"
      >
        <PanelRight size={13} />
      </button>
      <button type="button" className="btn" onClick={() => ui.set('helpOpen', true)} title="Bantuan & pintasan">
        <HelpCircle size={13} />
      </button>
    </header>
  )
}
