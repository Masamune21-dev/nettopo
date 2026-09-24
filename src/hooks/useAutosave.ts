import { useEffect, useRef } from 'react'
import { saveProject } from '@/lib/persistence'
import { toTopology } from '@/lib/serialize'
import { useTopologyStore } from '@/store/useTopologyStore'

const DELAY = 1500

type TopologyState = ReturnType<typeof useTopologyStore.getState>

/** Simpan otomatis ke localStorage beberapa saat setelah perubahan terakhir. */
export function useAutosave(enabled: boolean): void {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Supaya peringatan gagal simpan muncul sekali, bukan di tiap perubahan.
  const failed = useRef(false)

  useEffect(() => {
    if (!enabled) return

    const persist = (s: TopologyState) => {
      const ok = saveProject(
        toTopology({ projectId: s.projectId, projectName: s.projectName, site: s.site }, s.nodes, s.edges),
      )
      const current = useTopologyStore.getState()
      if (ok) {
        failed.current = false
        if (current.projectId === s.projectId) current.markClean()
      } else if (!failed.current) {
        failed.current = true
        current.pushToast(
          'Simpan otomatis gagal — penyimpanan browser mungkin penuh. Ekspor ke JSON supaya pekerjaan tidak hilang.',
          'error',
        )
      }
    }

    return useTopologyStore.subscribe((state, prev) => {
      // Proyek diganti (buka, impor, baru) sebelum timer sempat jalan: simpan
      // proyek lama sekarang juga, jangan sampai editan terakhirnya hilang.
      if (state.projectId !== prev.projectId && prev.dirty) {
        if (timer.current) clearTimeout(timer.current)
        timer.current = null
        persist(prev)
      }

      if (!state.dirty) return
      if (state.nodes === prev.nodes && state.edges === prev.edges && state.dirty === prev.dirty) return
      if (timer.current) clearTimeout(timer.current)
      timer.current = setTimeout(() => {
        const s = useTopologyStore.getState()
        if (s.dirty) persist(s)
      }, DELAY)
    })
  }, [enabled])

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current)
    },
    [],
  )
}
