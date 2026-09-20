import { create } from 'zustand'

type Theme = 'light' | 'dark'

interface UiState {
  theme: Theme
  showPortLabels: boolean
  snapToGrid: boolean
  paletteOpen: boolean
  inspectorOpen: boolean
  search: string
  helpOpen: boolean
  projectsOpen: boolean
  setTheme: (t: Theme) => void
  toggleTheme: () => void
  set: <K extends keyof UiState>(key: K, value: UiState[K]) => void
}

function initialTheme(): Theme {
  try {
    const saved = localStorage.getItem('nettopo:theme')
    if (saved === 'light' || saved === 'dark') return saved
  } catch {
    /* abaikan */
  }
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

function applyTheme(t: Theme) {
  document.documentElement.classList.toggle('dark', t === 'dark')
  try {
    localStorage.setItem('nettopo:theme', t)
  } catch {
    /* abaikan */
  }
}

export const useUiStore = create<UiState>()((set, get) => {
  const theme = initialTheme()
  applyTheme(theme)
  return {
    theme,
    showPortLabels: true,
    snapToGrid: true,
    paletteOpen: true,
    inspectorOpen: true,
    search: '',
    helpOpen: false,
    projectsOpen: false,
    setTheme: (t) => {
      applyTheme(t)
      set({ theme: t })
    },
    toggleTheme: () => get().setTheme(get().theme === 'dark' ? 'light' : 'dark'),
    set: (key, value) => set({ [key]: value } as unknown as Partial<UiState>),
  }
})
