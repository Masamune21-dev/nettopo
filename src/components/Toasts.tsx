import { AlertTriangle, CheckCircle2, Info, X, XCircle } from 'lucide-react'
import { useTopologyStore } from '@/store/useTopologyStore'

const TONE = {
  info: { icon: Info, color: '#3b82f6' },
  ok: { icon: CheckCircle2, color: '#10b981' },
  warn: { icon: AlertTriangle, color: '#f59e0b' },
  error: { icon: XCircle, color: '#ef4444' },
} as const

export function Toasts() {
  const toasts = useTopologyStore((s) => s.toasts)
  const dismiss = useTopologyStore((s) => s.dismissToast)

  return (
    <div className="pointer-events-none fixed bottom-4 left-1/2 z-[100] flex -translate-x-1/2 flex-col items-center gap-2">
      {toasts.map((t) => {
        const { icon: Icon, color } = TONE[t.tone]
        return (
          <div
            key={t.id}
            className="pointer-events-auto flex max-w-lg items-start gap-2 rounded-lg border px-3 py-2 text-[12px] shadow-lg"
            style={{ background: 'var(--panel)', borderColor: 'var(--border)' }}
          >
            <Icon size={14} style={{ color }} className="mt-px shrink-0" />
            <span className="leading-snug">{t.text}</span>
            <button type="button" onClick={() => dismiss(t.id)} className="ml-1 shrink-0 opacity-60 hover:opacity-100">
              <X size={13} />
            </button>
          </div>
        )
      })}
    </div>
  )
}
