import { useEffect, useRef } from 'react'
import { saveProject } from '@/lib/persistence'
import { toTopology } from '@/lib/serialize'
import { useTopologyStore } from '@/store/useTopologyStore'

const DELAY = 1500

/** Simpan otomatis ke localStorage beberapa saat setelah perubahan terakhir. */
export function useAutosave(enabled: boolean): void {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (!enabled) return
    return useTopologyStore.subscribe((state, prev) => {
      if (!state.dirty) return
      if (state.nodes === prev.nodes && state.edges === prev.edges && state.dirty === prev.dirty) return
      if (timer.current) clearTimeout(timer.current)
      timer.current = setTimeout(() => {
        const s = useTopologyStore.getState()
        if (!s.dirty) return
        const ok = saveProject(
          toTopology({ projectId: s.projectId, projectName: s.projectName, site: s.site }, s.nodes, s.edges),
        )
        if (ok) s.markClean()
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
