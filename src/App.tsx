import { ReactFlowProvider, useNodesInitialized, useReactFlow } from '@xyflow/react'
import { PanelLeft } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { AiDialog } from '@/components/AiDialog'
import { Canvas } from '@/components/Canvas'
import { DevicePalette } from '@/components/DevicePalette'
import { HelpDialog } from '@/components/HelpDialog'
import { IpamDialog } from '@/components/IpamDialog'
import { Inspector } from '@/components/inspector/Inspector'
import { ProjectsDialog } from '@/components/ProjectsDialog'
import { Toasts } from '@/components/Toasts'
import { Toolbar } from '@/components/Toolbar'
import { sampleTopology } from '@/data/sampleTopology'
import { useAutosave } from '@/hooks/useAutosave'
import { fitViewWhenReady } from '@/lib/fitView'
import { useShortcuts } from '@/hooks/useShortcuts'
import { uid } from '@/lib/id'
import { lastProjectId, loadProject } from '@/lib/persistence'
import { fromTopology } from '@/lib/serialize'
import { useTopologyStore } from '@/store/useTopologyStore'
import { useUiStore } from '@/store/useUiStore'

function Workspace() {
  const replaceAll = useTopologyStore((s) => s.replaceAll)
  const paletteOpen = useUiStore((s) => s.paletteOpen)
  const inspectorOpen = useUiStore((s) => s.inspectorOpen)
  const setUi = useUiStore((s) => s.set)
  const { fitView } = useReactFlow()
  const nodesInitialized = useNodesInitialized()
  const booted = useRef(false)
  const fitted = useRef(false)

  useShortcuts()
  useAutosave(true)

  // Muat pekerjaan terakhir, atau tampilkan contoh saat pertama kali dibuka.
  useEffect(() => {
    const loadInitial = () => {
      const id = lastProjectId()
      const topo = id ? loadProject(id) : null
      if (topo) {
        const { nodes, edges, meta } = fromTopology(topo)
        replaceAll({ nodes, edges, ...meta })
        return
      }
      const s = sampleTopology()
      replaceAll({
        nodes: s.nodes,
        edges: s.edges,
        projectId: uid('prj'),
        projectName: s.name,
        site: s.site,
      })
      if (id) {
        useTopologyStore
          .getState()
          .pushToast('Topologi terakhir tidak bisa dibaca — contoh dimuat. Coba buka dari menu Buka.', 'warn')
      }
    }

    // StrictMode memanggil efek dua kali — pemuatan hanya boleh sekali.
    if (booted.current) return
    booted.current = true
    loadInitial()
  }, [replaceAll])

  // Paskan tampilan begitu semua node selesai diukur. Kalau kanvas masih
  // berukuran nol saat itu, fitView tidak berefek — makanya dicoba ulang.
  useEffect(() => {
    if (!nodesInitialized || fitted.current) return
    fitted.current = true
    void fitViewWhenReady(fitView, { padding: 0.18, duration: 300 })
  }, [nodesInitialized, fitView])

  return (
    <div className="flex h-full flex-col">
      <Toolbar />
      <div className="relative flex min-h-0 flex-1">
        {paletteOpen ? <DevicePalette /> : null}
        <button
          type="button"
          className="btn absolute left-2 top-2 z-20 px-1.5 py-1"
          style={{ left: paletteOpen ? 272 : 8 }}
          onClick={() => setUi('paletteOpen', !paletteOpen)}
          title={paletteOpen ? 'Sembunyikan katalog' : 'Tampilkan katalog'}
        >
          <PanelLeft size={14} />
        </button>
        <Canvas />
        {inspectorOpen ? <Inspector /> : null}
      </div>
      <ProjectsDialog />
      <HelpDialog />
      <AiDialog />
      <IpamDialog />
      <Toasts />
    </div>
  )
}

export default function App() {
  return (
    <ReactFlowProvider>
      <Workspace />
    </ReactFlowProvider>
  )
}
