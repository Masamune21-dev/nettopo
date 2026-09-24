import { useReactFlow } from '@xyflow/react'
import { AlertTriangle, Copy, Download, RefreshCw, Sparkles, StopCircle } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Dialog } from '@/components/Dialog'
import { aiDefaultModel, aiReady, AiError, chat, extractJson, listModels, type AiModel } from '@/lib/ai'
import { applyBuildPlan, applyTidyPlan } from '@/lib/aiApply'
import { AI_TASKS, buildPlanSchema, getTask, type TaskId, tidyPlanSchema } from '@/lib/aiTasks'
import { downloadText, slugify } from '@/lib/download'
import { fitViewWhenReady } from '@/lib/fitView'
import { uid } from '@/lib/id'
import { toTopology } from '@/lib/serialize'
import { useTopologyStore } from '@/store/useTopologyStore'
import { useUiStore } from '@/store/useUiStore'
import { isDeviceNode } from '@/store/types'

const MODEL_KEY = 'nettopo:ai-model'

// localStorage bisa melempar (mode privat Safari, penyimpanan diblokir).
function readSavedModel(): string {
  try {
    return localStorage.getItem(MODEL_KEY) ?? ''
  } catch {
    return ''
  }
}

function saveModel(model: string): void {
  try {
    localStorage.setItem(MODEL_KEY, model)
  } catch {
    /* abaikan — hanya kenyamanan */
  }
}

function NotConfigured() {
  return (
    <div className="space-y-3 text-[12px] leading-relaxed">
      <p>Sambungan AI belum diatur. Dua langkah:</p>
      <ol className="list-decimal space-y-2 pl-5">
        <li>
          Salin berkas contohnya:
          <pre
            className="mt-1 rounded border px-2 py-1 font-mono text-[11px]"
            style={{ borderColor: 'var(--border)', background: 'var(--panel-2)' }}
          >
            cp .env.example .env
          </pre>
        </li>
        <li>
          Buka <code>.env</code>, isi <code>AI_API_KEY</code> dengan kunci dari halaman
          “Endpoint &amp; Key” di 9Router, lalu jalankan ulang <code>npm run dev</code>.
        </li>
      </ol>
      <p style={{ color: 'var(--muted)' }}>
        Kunci itu hanya dibaca dev server dan disisipkan sebagai header di sisi server —
        tidak pernah dikirim ke browser, dan <code>.env</code> tidak ikut masuk git.
      </p>
    </div>
  )
}

export function AiDialog() {
  const open = useUiStore((s) => s.aiOpen)
  const setUi = useUiStore((s) => s.set)
  const store = useTopologyStore()
  const { fitView } = useReactFlow()

  const [taskId, setTaskId] = useState<TaskId>('audit')
  const [instruction, setInstruction] = useState('')
  const [models, setModels] = useState<AiModel[]>([])
  const [model, setModel] = useState('')
  const [loadingModels, setLoadingModels] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState('')
  const [warnings, setWarnings] = useState<string[]>([])
  const abort = useRef<AbortController | null>(null)

  const task = getTask(taskId)
  const ready = aiReady()

  const refreshModels = useCallback(async () => {
    setLoadingModels(true)
    setError('')
    try {
      const list = await listModels()
      setModels(list)
      setModel((current) => {
        if (current && list.some((m) => m.id === current)) return current
        const saved = readSavedModel()
        if (saved && list.some((m) => m.id === saved)) return saved
        const preset = aiDefaultModel()
        if (preset && list.some((m) => m.id === preset)) return preset
        return list[0]?.id ?? ''
      })
    } catch (e) {
      setError(e instanceof AiError ? e.message : String(e))
    } finally {
      setLoadingModels(false)
    }
  }, [])

  useEffect(() => {
    if (open && ready && models.length === 0) void refreshModels()
  }, [open, ready, models.length, refreshModels])

  useEffect(() => {
    if (model) saveModel(model)
  }, [model])

  if (!open) return null
  const close = () => {
    abort.current?.abort()
    setUi('aiOpen', false)
  }

  const deviceCount = store.nodes.filter(isDeviceNode).length
  const meta = { projectId: store.projectId, projectName: store.projectName, site: store.site }

  const run = async () => {
    if (!model) {
      setError('Pilih model dulu.')
      return
    }
    if (task.needsTopology && deviceCount === 0) {
      setError('Topologi masih kosong — tidak ada yang bisa dianalisis.')
      return
    }
    if (!task.needsTopology && !instruction.trim()) {
      setError('Tulis dulu rancangan jaringannya di kotak perintah.')
      return
    }

    setBusy(true)
    setError('')
    setResult('')
    setWarnings([])
    abort.current = new AbortController()

    try {
      const topo = toTopology(meta, store.nodes, store.edges)
      const answer = await chat({
        model,
        system: task.system,
        user: task.buildUser(topo, instruction.trim()),
        json: task.output === 'json',
        signal: abort.current.signal,
        // Teks panjang (konfigurasi, dokumentasi) tampil bertahap sambil
        // datang, jadi tidak terasa menggantung.
        onChunk: task.output === 'text' ? setResult : undefined,
      })

      if (task.output === 'text') {
        setResult(answer)
        return
      }

      const raw = extractJson(answer)

      if (taskId === 'tidy') {
        const parsed = tidyPlanSchema.safeParse(raw)
        if (!parsed.success) throw new AiError(`Rencana dari AI tidak sesuai bentuk: ${parsed.error.issues[0]?.message}`)
        // Ambil keadaan terbaru: selama menunggu jawaban, kanvas bisa sudah berubah.
        const now = useTopologyStore.getState()
        const applied = applyTidyPlan(parsed.data, now.nodes, now.edges)
        store.setNodesEdges(applied.nodes, applied.edges)
        setWarnings(applied.warnings)
        setResult(
          `Diterapkan: ${parsed.data.groups.length} kelompok, arah ${parsed.data.direction}.\n\n${parsed.data.alasan}`,
        )
        void fitViewWhenReady(fitView, { padding: 0.18, duration: 400 })
      } else {
        const parsed = buildPlanSchema.safeParse(raw)
        if (!parsed.success) throw new AiError(`Rancangan dari AI tidak sesuai bentuk: ${parsed.error.issues[0]?.message}`)
        const applied = applyBuildPlan(parsed.data)
        // Rancangan baru jadi proyek baru, bukan menimpa proyek yang sedang
        // dibuka — proyek lama tetap ada di menu Buka (disimpan otomatis).
        store.replaceAll({
          nodes: applied.nodes,
          edges: applied.edges,
          projectId: uid('prj'),
          projectName: parsed.data.name,
          site: parsed.data.site,
        })
        // Tandai belum tersimpan supaya proyek baru ini ikut disimpan otomatis.
        store.setProjectMeta({})
        setWarnings(applied.warnings)
        setResult(
          `Dibuat: ${applied.nodes.filter(isDeviceNode).length} perangkat, ${applied.edges.length} link.\n\n${parsed.data.catatan}`,
        )
        void fitViewWhenReady(fitView, { padding: 0.18, duration: 400 })
        store.pushToast('Rancangan AI dibuat sebagai proyek baru — proyek sebelumnya ada di menu Buka.', 'ok')
        return
      }
      store.pushToast('Hasil AI diterapkan — tekan Cmd/Ctrl+Z kalau mau dibatalkan.', 'ok')
    } catch (e) {
      if ((e as Error).name === 'AbortError') return
      setError(e instanceof AiError ? e.message : String(e))
    } finally {
      setBusy(false)
      abort.current = null
    }
  }

  return (
    <Dialog title="Asisten AI" onClose={close} width={760}>
      {!ready ? (
        <NotConfigured />
      ) : (
        <div className="space-y-3">
          {/* Pilihan tugas */}
          <div className="flex flex-wrap gap-1.5">
            {AI_TASKS.map((t) => (
              <button
                key={t.id}
                type="button"
                className="btn px-2 py-1 text-[11.5px]"
                style={
                  t.id === taskId
                    ? { borderColor: '#4f46e5', background: '#4f46e514', color: '#818cf8' }
                    : undefined
                }
                onClick={() => {
                  setTaskId(t.id)
                  setResult('')
                  setWarnings([])
                  setError('')
                }}
              >
                {t.label}
              </button>
            ))}
          </div>
          <p className="text-[11px]" style={{ color: 'var(--muted)' }}>
            {task.blurb}
            {task.needsTopology ? ` · memakai ${deviceCount} perangkat & ${store.edges.length} link yang ada` : ''}
          </p>

          {/* Model */}
          <div className="flex items-end gap-1.5">
            <div className="min-w-0 flex-1">
              <label className="label" htmlFor="ai-model">
                Model
              </label>
              <select
                id="ai-model"
                className="field"
                value={model}
                disabled={loadingModels || models.length === 0}
                onChange={(e) => setModel(e.target.value)}
              >
                {models.length === 0 ? <option value="">(belum ada daftar model)</option> : null}
                {models.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.id}
                  </option>
                ))}
              </select>
            </div>
            <button
              type="button"
              className="btn shrink-0"
              onClick={() => void refreshModels()}
              disabled={loadingModels}
              title="Muat ulang daftar model dari 9Router"
            >
              <RefreshCw size={13} className={loadingModels ? 'animate-spin' : ''} />
            </button>
          </div>

          {/* Perintah */}
          <div>
            <label className="label" htmlFor="ai-instruction">
              Perintah {task.needsTopology ? '(boleh dikosongkan)' : ''}
            </label>
            <textarea
              id="ai-instruction"
              className="field h-20 resize-none"
              placeholder={task.placeholder}
              value={instruction}
              onChange={(e) => setInstruction(e.target.value)}
            />
          </div>

          <div className="flex items-center gap-2">
            <button type="button" className="btn btn-primary" onClick={() => void run()} disabled={busy}>
              <Sparkles size={13} /> {busy ? 'Sedang diproses…' : 'Jalankan'}
            </button>
            {busy ? (
              <button type="button" className="btn" onClick={() => abort.current?.abort()}>
                <StopCircle size={13} /> Batalkan
              </button>
            ) : null}
            {result && task.output === 'text' ? (
              <>
                <button
                  type="button"
                  className="btn"
                  onClick={() => void navigator.clipboard.writeText(result)}
                >
                  <Copy size={13} /> Salin
                </button>
                <button
                  type="button"
                  className="btn"
                  onClick={() =>
                    downloadText(result, `${slugify(store.projectName)}-${taskId}.md`, 'text/markdown')
                  }
                >
                  <Download size={13} /> Unduh
                </button>
              </>
            ) : null}
          </div>

          {error ? (
            <div
              role="alert"
              className="rounded-md border px-2.5 py-2 text-[11.5px]"
              style={{ borderColor: '#ef4444', background: '#ef444414' }}
            >
              {error}
            </div>
          ) : null}

          {warnings.length > 0 ? (
            <ul
              className="space-y-1 rounded-md border px-2.5 py-2 text-[11px]"
              style={{ borderColor: '#f59e0b', background: '#f59e0b10' }}
            >
              {warnings.map((w, i) => (
                <li key={i} className="flex items-start gap-1.5">
                  <AlertTriangle size={12} className="mt-px shrink-0" style={{ color: '#f59e0b' }} />
                  <span>{w}</span>
                </li>
              ))}
            </ul>
          ) : null}

          {result ? (
            <pre
              className="thin-scroll max-h-[46vh] overflow-auto whitespace-pre-wrap rounded-md border p-2.5 text-[11.5px] leading-relaxed"
              style={{ borderColor: 'var(--border)', background: 'var(--panel-2)' }}
            >
              {result}
            </pre>
          ) : null}
        </div>
      )}
    </Dialog>
  )
}
