import React from 'react'
import { File as FileIcon, XCircle } from 'lucide-react'

interface AttachmentBarProps {
  attachments: File[]
  onRemove: (index: number) => void
}

export function AttachmentBar({ attachments, onRemove }: AttachmentBarProps) {
  if (attachments.length === 0) return null

  return (
    <div className="flex flex-wrap gap-2 mb-1 pl-[50px]">
      {attachments.map((file, index) => (
        <div
          key={`${file.name}-${index}`}
          className="flex items-center gap-2 bg-[var(--color-surface)] rounded-[var(--radius-pill)] px-3 py-1 text-[var(--text-xs)] text-[var(--color-text-primary)] border border-[var(--color-border)] animate-in fade-in zoom-in-95 duration-[var(--duration-fast)]"
        >
          <FileIcon size={12} className="text-[var(--color-success)]" />
          <span
            className="max-w-[200px] truncate"
            title={(file as unknown as { path: string }).path || file.name}
          >
            {file.name}
          </span>
          <button
            onClick={() => onRemove(index)}
            className="text-[var(--color-text-muted)] hover:text-[var(--color-error)] transition-colors"
          >
            <XCircle size={14} />
          </button>
        </div>
      ))}
    </div>
  )
}
