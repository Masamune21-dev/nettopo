import { X } from 'lucide-react'
import type { ReactNode } from 'react'

export function Dialog({
  title,
  onClose,
  children,
  width = 560,
}: {
  title: string
  onClose: () => void
  children: ReactNode
  width?: number
}) {
  return (
    <div
      className="fixed inset-0 z-[90] flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="max-h-[80vh] w-full overflow-hidden rounded-xl border shadow-2xl"
        style={{ background: 'var(--panel)', borderColor: 'var(--border)', maxWidth: width }}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div
          className="flex items-center justify-between border-b px-4 py-2.5"
          style={{ borderColor: 'var(--border)' }}
        >
          <h2 className="text-[13px] font-semibold">{title}</h2>
          <button type="button" className="btn border-0 px-1 py-0.5" onClick={onClose}>
            <X size={14} />
          </button>
        </div>
        <div className="thin-scroll max-h-[70vh] overflow-y-auto p-4">{children}</div>
      </div>
    </div>
  )
}
