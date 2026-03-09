import React from 'react'
import { File as FileIcon, XCircle } from 'lucide-react'

interface AttachmentBarProps {
  /** Currently attached files */
  attachments: File[]
  /** Remove an attachment by index */
  onRemove: (index: number) => void
}

/**
 * Horizontal pill list showing attached files with remove buttons.
 * Extracted from VoiceInput for independent rendering and tracking.
 */
export function AttachmentBar({ attachments, onRemove }: AttachmentBarProps) {
  if (attachments.length === 0) return null

  return (
    <div className="flex flex-wrap gap-2 mb-1 pl-[50px]">
      {attachments.map((file, index) => (
        <div
          key={`${file.name}-${index}`}
          className="flex items-center gap-2 bg-white/10 rounded-full px-3 py-1 text-xs text-white/90 border border-white/10 animate-in fade-in zoom-in-95 duration-200"
        >
          <FileIcon size={12} className="text-emerald-400" />
          <span
            className="max-w-[200px] truncate"
            title={(file as unknown as { path: string }).path || file.name}
          >
            {file.name}
          </span>
          <button
            onClick={() => onRemove(index)}
            className="hover:text-red-400 transition-colors"
          >
            <XCircle size={14} />
          </button>
        </div>
      ))}
    </div>
  )
}
