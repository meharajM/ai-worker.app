import React, { useRef } from 'react'
import { Eye, EyeOff, Paperclip, FolderOpen, ShieldCheck, ShieldAlert } from 'lucide-react'

interface InputToolbarProps {
  workspacePath: string | null
  isHeadless: boolean
  fileWriteAutoApprove: boolean
  onToggleHeadless: () => void
  onToggleFileWriteAutoApprove: () => void
  onSelectFolder: () => void
  onSelectFiles: (files: File[]) => void
  hasAttachments: boolean
  disabled?: boolean
}

export function InputToolbar({
  workspacePath,
  isHeadless,
  fileWriteAutoApprove,
  onToggleHeadless,
  onToggleFileWriteAutoApprove,
  onSelectFolder,
  onSelectFiles,
  hasAttachments,
  disabled = false,
}: InputToolbarProps) {
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      onSelectFiles(Array.from(e.target.files))
      e.target.value = ''
    }
  }

  return (
    <>
      <input
        type="file"
        multiple
        ref={fileInputRef}
        onChange={handleFileSelect}
        style={{ display: 'none' }}
      />

      <button
        id="workspace-select-button"
        data-testid="workspace-select-button"
        type="button"
        onClick={onSelectFolder}
        disabled={disabled}
        className={`inline-flex h-[36px] items-center gap-1.5 rounded-[var(--radius-lg)] border px-2 text-[10px] font-semibold tracking-wide transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] ${workspacePath
            ? 'border-[var(--color-brand-teal)]/40 bg-[var(--color-brand-teal)]/15 text-[var(--color-brand-teal)] hover:bg-[var(--color-brand-teal)]/25'
            : 'border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]'
          } ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
        title={workspacePath ? `Workspace: ${workspacePath}` : 'Select Workspace'}
      >
        <FolderOpen size={12} />
        <span className="max-w-[180px] truncate">
          {workspacePath ? `Workspace: ${workspacePath.split(/[/\\]/).pop()}` : 'Select Workspace'}
        </span>
      </button>

      <button
        id="attachment-select-button"
        data-testid="attachment-select-button"
        type="button"
        onClick={() => fileInputRef.current?.click()}
        disabled={disabled}
        className={`p-2 mb-[1px] rounded-[var(--radius-lg)] transition-all h-[44px] w-[36px] flex items-center justify-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] ${hasAttachments
            ? 'bg-[var(--color-success)]/20 text-[var(--color-success)] hover:bg-[var(--color-success)]/30'
            : 'bg-transparent text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] hover:bg-[var(--color-surface)]'
          } ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
        title="Select Files"
      >
        <Paperclip size={18} />
      </button>

      <button
        id="workspace-auto-file-write-approval-toggle"
        data-testid="workspace-auto-file-write-approval-toggle"
        type="button"
        aria-pressed={fileWriteAutoApprove}
        onClick={onToggleFileWriteAutoApprove}
        disabled={disabled}
        className={`inline-flex h-[36px] items-center gap-1.5 rounded-[var(--radius-lg)] border px-2 text-[10px] font-semibold tracking-wide transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] ${fileWriteAutoApprove
            ? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/25'
            : 'border-amber-500/40 bg-amber-500/15 text-amber-300 hover:bg-amber-500/25'
          } ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
        title={fileWriteAutoApprove ? 'Auto File Write Approval: ON' : 'Auto File Write Approval: OFF'}
      >
        {fileWriteAutoApprove ? <ShieldCheck size={12} /> : <ShieldAlert size={12} />}
        <span>Auto File Write Approval: {fileWriteAutoApprove ? 'ON' : 'OFF'}</span>
      </button>

      {/* Headless Toggle */}
      <button
        onClick={onToggleHeadless}
        disabled={disabled}
        className={`p-2 mb-[1px] rounded-[var(--radius-lg)] transition-all h-[44px] w-[36px] flex items-center justify-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] ${isHeadless
            ? 'bg-[var(--color-accent)]/20 text-[var(--color-accent)] hover:bg-[var(--color-accent)]/30'
            : 'bg-transparent text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] hover:bg-[var(--color-surface)]'
          } ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
        title={
          isHeadless
            ? 'Run in Background (Headless Mode Active)'
            : 'Run Visibly (Headed Mode Active)'
        }
      >
        {isHeadless ? <EyeOff size={18} /> : <Eye size={18} />}
      </button>
    </>
  )
}
