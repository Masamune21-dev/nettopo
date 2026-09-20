import { useReactFlow } from '@xyflow/react'
import { FilePlus2, Sparkles, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { Dialog } from '@/components/Dialog'
import { sampleTopology } from '@/data/sampleTopology'
import { uid } from '@/lib/id'
import { deleteProject, listProjects, loadProject } from '@/lib/persistence'
import { fromTopology } from '@/lib/serialize'
import { useTopologyStore } from '@/store/useTopologyStore'
import { useUiStore } from '@/store/useUiStore'

export function ProjectsDialog() {
  const open = useUiStore((s) => s.projectsOpen)
  const setUi = useUiStore((s) => s.set)
  const replaceAll = useTopologyStore((s) => s.replaceAll)
  const pushToast = useTopologyStore((s) => s.pushToast)
  const { fitView } = useReactFlow()
  const [items, setItems] = useState(() => listProjects())

  if (!open) return null

  const close = () => setUi('projectsOpen', false)
  const refit = () => setTimeout(() => fitView({ duration: 450, padding: 0.18 }), 80)

  const openProject = (id: string) => {
    const topo = loadProject(id)
    if (!topo) {
      pushToast('Topologi tersimpan tidak bisa dibaca.', 'error')
      return
    }
    const { nodes, edges, meta } = fromTopology(topo)
    replaceAll({ nodes, edges, ...meta })
    close()
    refit()
  }

  const newProject = () => {
    replaceAll({ nodes: [], edges: [], projectId: uid('prj'), projectName: 'Topologi Baru', site: '' })
    close()
  }

  const loadSample = () => {
    const s = sampleTopology()
    replaceAll({
      nodes: s.nodes,
      edges: s.edges,
      projectId: uid('prj'),
      projectName: s.name,
      site: s.site,
    })
    close()
    refit()
  }

  return (
    <Dialog title="Topologi tersimpan" onClose={close}>
      <div className="mb-3 flex gap-2">
        <button type="button" className="btn btn-primary" onClick={newProject}>
          <FilePlus2 size={13} /> Topologi baru
        </button>
        <button type="button" className="btn" onClick={loadSample}>
          <Sparkles size={13} /> Muat contoh
        </button>
      </div>

      {items.length === 0 ? (
        <p className="py-6 text-center text-[12px]" style={{ color: 'var(--muted)' }}>
          Belum ada topologi tersimpan. Tekan <strong>Simpan</strong> di toolbar untuk menyimpan yang sekarang.
        </p>
      ) : (
        <ul className="space-y-1.5">
          {items.map((p) => (
            <li
              key={p.id}
              className="flex items-center gap-2 rounded-md border px-2.5 py-2"
              style={{ borderColor: 'var(--border)', background: 'var(--panel-2)' }}
            >
              <button type="button" className="min-w-0 flex-1 text-left" onClick={() => openProject(p.id)}>
                <div className="truncate text-[12.5px] font-medium">{p.name}</div>
                <div className="truncate text-[10.5px]" style={{ color: 'var(--muted)' }}>
                  {p.devices} perangkat · {p.links} link
                  {p.site ? ` · ${p.site}` : ''} ·{' '}
                  {new Date(p.updatedAt).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' })}
                </div>
              </button>
              <button
                type="button"
                className="btn px-1.5 py-1"
                style={{ color: '#ef4444' }}
                title="Hapus dari penyimpanan browser"
                onClick={() => {
                  deleteProject(p.id)
                  setItems(listProjects())
                  pushToast(`"${p.name}" dihapus.`, 'info')
                }}
              >
                <Trash2 size={13} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </Dialog>
  )
}
