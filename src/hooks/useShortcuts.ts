import { useEffect } from 'react'
import { saveProject } from '@/lib/persistence'
import { toTopology } from '@/lib/serialize'
import { useTopologyStore } from '@/store/useTopologyStore'
import { useUiStore } from '@/store/useUiStore'

function inEditable(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null
  if (!el) return false
  const tag = el.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable
}

export function useShortcuts(): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const s = useTopologyStore.getState()
      const mod = e.metaKey || e.ctrlKey

      if (mod && e.key.toLowerCase() === 's') {
        e.preventDefault()
        const ok = saveProject(
          toTopology({ projectId: s.projectId, projectName: s.projectName, site: s.site }, s.nodes, s.edges),
        )
        s.pushToast(ok ? 'Topologi tersimpan.' : 'Gagal menyimpan.', ok ? 'ok' : 'error')
        if (ok) s.markClean()
        return
      }

      if (inEditable(e.target)) return
      // Saat dialog terbuka, tombol seperti Delete tidak boleh menyentuh kanvas
      // di belakangnya. Escape ditangani dialog itu sendiri.
      if (document.querySelector('[role="dialog"]')) return

      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        if (e.shiftKey) s.redo()
        else s.undo()
        return
      }
      if (mod && e.key.toLowerCase() === 'd') {
        e.preventDefault()
        s.duplicateSelected()
        return
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault()
        s.deleteSelected()
        return
      }
      if (e.key === 'Escape') {
        s.clearSelection()
        return
      }
      if (e.key === '?') {
        useUiStore.getState().set('helpOpen', true)
      }
    }

    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
}
