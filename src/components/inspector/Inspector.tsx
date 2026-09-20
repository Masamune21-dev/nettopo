import { useReactFlow } from '@xyflow/react'
import { AlertTriangle, Info, PanelRightClose } from 'lucide-react'
import { useMemo } from 'react'
import { validateTopology } from '@/lib/validate'
import { useTopologyStore } from '@/store/useTopologyStore'
import { useUiStore } from '@/store/useUiStore'
import { isDeviceNode, isGroupNode, isNoteNode } from '@/store/types'
import { DeviceInspector } from './DeviceInspector'
import { LinkInspector } from './LinkInspector'

const SWATCHES = ['#6366f1', '#0ea5e9', '#10b981', '#f59e0b', '#ef4444', '#a855f7', '#64748b']
const NOTE_COLORS = ['#fde68a', '#bbf7d0', '#bfdbfe', '#fecaca', '#e9d5ff', '#e2e8f0']

function ProjectPanel() {
  const { projectName, site, nodes, edges, setProjectMeta, selectOnly } = useTopologyStore()
  const { setCenter } = useReactFlow()
  const issues = useMemo(() => validateTopology(nodes, edges), [nodes, edges])
  const deviceCount = nodes.filter(isDeviceNode).length

  const focus = (nodeId?: string, edgeId?: string) => {
    if (nodeId) {
      const n = nodes.find((x) => x.id === nodeId)
      selectOnly(nodeId)
      if (n) {
        setCenter(n.position.x + (n.measured?.width ?? 240) / 2, n.position.y + (n.measured?.height ?? 140) / 2, {
          zoom: 1.1,
          duration: 400,
        })
      }
    } else if (edgeId) {
      selectOnly(edgeId)
    }
  }

  return (
    <div className="space-y-3.5">
      <div>
        <label className="label" htmlFor="prj-name">
          Nama topologi
        </label>
        <input
          id="prj-name"
          className="field"
          value={projectName}
          onChange={(e) => setProjectMeta({ projectName: e.target.value })}
        />
      </div>
      <div>
        <label className="label" htmlFor="prj-site">
          Site / POP default
        </label>
        <input
          id="prj-site"
          className="field"
          placeholder="POP-JKT-1"
          value={site}
          onChange={(e) => setProjectMeta({ site: e.target.value })}
        />
      </div>

      <div className="grid grid-cols-2 gap-2 text-center">
        {[
          { label: 'Perangkat', value: deviceCount },
          { label: 'Link', value: edges.length },
        ].map((s) => (
          <div
            key={s.label}
            className="rounded-md border py-2"
            style={{ borderColor: 'var(--border)', background: 'var(--panel-2)' }}
          >
            <div className="text-lg font-semibold leading-none">{s.value}</div>
            <div className="mt-0.5 text-[10px]" style={{ color: 'var(--muted)' }}>
              {s.label}
            </div>
          </div>
        ))}
      </div>

      <section>
        <span className="label">Pemeriksaan ({issues.length})</span>
        {issues.length === 0 ? (
          <p
            className="rounded-md border px-2 py-3 text-center text-[11px]"
            style={{ borderColor: 'var(--border)', color: 'var(--muted)' }}
          >
            Tidak ada yang perlu diperiksa.
          </p>
        ) : (
          <ul className="thin-scroll max-h-[38vh] space-y-1 overflow-y-auto">
            {issues.map((i) => (
              <li key={i.id}>
                <button
                  type="button"
                  onClick={() => focus(i.nodeId, i.edgeId)}
                  className="flex w-full items-start gap-1.5 rounded-md border px-2 py-1.5 text-left text-[11px] leading-snug"
                  style={{
                    borderColor: 'var(--border)',
                    background: 'var(--panel-2)',
                    cursor: i.nodeId || i.edgeId ? 'pointer' : 'default',
                  }}
                >
                  {i.level === 'warn' ? (
                    <AlertTriangle size={12} className="mt-px shrink-0" style={{ color: '#f59e0b' }} />
                  ) : (
                    <Info size={12} className="mt-px shrink-0" style={{ color: 'var(--muted)' }} />
                  )}
                  <span>{i.text}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <p className="text-[10.5px] leading-relaxed" style={{ color: 'var(--muted)' }}>
        Pilih sebuah perangkat atau kabel di kanvas untuk mengubah propertinya di panel ini.
      </p>
    </div>
  )
}

export function Inspector() {
  const nodes = useTopologyStore((s) => s.nodes)
  const edges = useTopologyStore((s) => s.edges)
  const updateNodeData = useTopologyStore((s) => s.updateNodeData)
  const setUi = useUiStore((s) => s.set)

  const selectedNode = nodes.find((n) => n.selected)
  const selectedEdge = edges.find((e) => e.selected)

  return (
    <aside
      className="flex h-full w-[340px] shrink-0 flex-col border-l"
      style={{ background: 'var(--panel)', borderColor: 'var(--border)' }}
    >
      <div
        className="flex items-center justify-between border-b px-3 py-2"
        style={{ borderColor: 'var(--border)' }}
      >
        <span className="text-[11px] font-bold uppercase tracking-wider" style={{ color: 'var(--muted)' }}>
          {selectedNode && isDeviceNode(selectedNode)
            ? 'Properti perangkat'
            : selectedEdge
              ? 'Properti link'
              : selectedNode && isGroupNode(selectedNode)
                ? 'Properti area'
                : selectedNode && isNoteNode(selectedNode)
                  ? 'Properti catatan'
                  : 'Topologi'}
        </span>
        <button
          type="button"
          className="btn border-0 px-1 py-0.5"
          onClick={() => setUi('inspectorOpen', false)}
          title="Tutup panel"
        >
          <PanelRightClose size={14} />
        </button>
      </div>

      <div className="thin-scroll flex-1 overflow-y-auto p-3">
        {selectedNode && isDeviceNode(selectedNode) ? (
          <DeviceInspector device={selectedNode} />
        ) : selectedEdge ? (
          <LinkInspector edge={selectedEdge} />
        ) : selectedNode && isGroupNode(selectedNode) ? (
          <div className="space-y-3">
            <div>
              <label className="label" htmlFor="grp-label">
                Nama area
              </label>
              <input
                id="grp-label"
                className="field"
                value={selectedNode.data.label}
                onChange={(e) => updateNodeData(selectedNode.id, { label: e.target.value })}
              />
            </div>
            <div>
              <span className="label">Warna</span>
              <div className="flex flex-wrap gap-1.5">
                {SWATCHES.map((c) => (
                  <button
                    key={c}
                    type="button"
                    aria-label={`Warna ${c}`}
                    className="size-6 rounded border-2"
                    style={{
                      background: c,
                      borderColor: selectedNode.data.color === c ? 'var(--text)' : 'transparent',
                    }}
                    onClick={() => updateNodeData(selectedNode.id, { color: c })}
                  />
                ))}
              </div>
            </div>
          </div>
        ) : selectedNode && isNoteNode(selectedNode) ? (
          <div className="space-y-3">
            <div>
              <label className="label" htmlFor="note-text">
                Teks
              </label>
              <textarea
                id="note-text"
                className="field h-24 resize-none"
                value={selectedNode.data.text}
                onChange={(e) => updateNodeData(selectedNode.id, { text: e.target.value })}
              />
            </div>
            <div>
              <span className="label">Warna</span>
              <div className="flex flex-wrap gap-1.5">
                {NOTE_COLORS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    aria-label={`Warna ${c}`}
                    className="size-6 rounded border-2"
                    style={{
                      background: c,
                      borderColor: selectedNode.data.color === c ? 'var(--text)' : 'transparent',
                    }}
                    onClick={() => updateNodeData(selectedNode.id, { color: c })}
                  />
                ))}
              </div>
            </div>
          </div>
        ) : (
          <ProjectPanel />
        )}
      </div>
    </aside>
  )
}
