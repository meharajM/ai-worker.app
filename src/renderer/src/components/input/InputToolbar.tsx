import React, { useState, useRef, useEffect } from 'react'
import { Eye, EyeOff, Paperclip, FolderOpen, File as FileIcon } from 'lucide-react'
import { Button } from '../primitives/Button'

interface InputToolbarProps {
  workspacePath: string | null
  isHeadless: boolean
  onToggleHeadless: () => void
  onSelectFolder: () => void
  onSelectFiles: (files: File[]) => void
  hasAttachments: boolean
  disabled?: boolean
}

export function InputToolbar({
  workspacePath,
  isHeadless,
  onToggleHeadless,
  onSelectFolder,
  onSelectFiles,
  hasAttachments,
  disabled = false,
}: InputToolbarProps) {
  const [showContextMenu, setShowContextMenu] = useState(false)
  const contextMenuRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      onSelectFiles(Array.from(e.target.files))
      e.target.value = ''
    }
  }

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (contextMenuRef.current && !contextMenuRef.current.contains(e.target as Node)) {
        setShowContextMenu(false)
      }
    }
    if (showContextMenu) {
      document.addEventListener('mousedown', handleClickOutside)
    }
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [showContextMenu])

  return (
    <>
      <input
        type="file"
        multiple
        ref={fileInputRef}
        onChange={handleFileSelect}
        style={{ display: 'none' }}
      />

      {/* Unified Workspace / File Selector */}
      <div className="relative" ref={contextMenuRef}>
        <button
          onClick={() => setShowContextMenu(!showContextMenu)}
          disabled={disabled}
          className={`p-2 mb-[1px] rounded-[var(--radius-lg)] transition-all h-[44px] w-[36px] flex items-center justify-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] ${workspacePath
              ? 'bg-[var(--color-brand-teal)]/20 text-[var(--color-brand-teal)] hover:bg-[var(--color-brand-teal)]/30'
              : hasAttachments
                ? 'bg-[var(--color-success)]/20 text-[var(--color-success)] hover:bg-[var(--color-success)]/30'
                : 'bg-transparent text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] hover:bg-[var(--color-surface)]'
            } ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
          title={workspacePath ? `Workspace: ${workspacePath}` : 'Select workspace or files'}
        >
          <Paperclip size={18} />
        </button>

        {/* Dropdown Menu */}
        {showContextMenu && (
          <div className="absolute bottom-full mb-2 -right-4 bg-[var(--color-card-elevated)] border border-[var(--color-border)] rounded-[var(--radius-xl)] shadow-[var(--shadow-glass)] overflow-hidden min-w-[200px] animate-in fade-in slide-in-from-bottom-2 duration-[var(--duration-fast)] z-50">
            {/* Select Workspace */}
            <button
              onClick={() => {
                onSelectFolder()
                setShowContextMenu(false)
              }}
              className="w-full flex items-center gap-3 px-4 py-3 text-[var(--text-sm)] text-[var(--color-text-primary)] hover:bg-[var(--color-surface)] hover:text-[var(--color-primary)] transition-colors"
            >
              <FolderOpen
                size={16}
                className={workspacePath ? 'text-[var(--color-brand-teal)]' : 'text-[var(--color-text-muted)]'}
              />
              <div className="flex flex-col items-start">
                <span className="font-[var(--font-weight-medium)]">Select Workspace</span>
                {workspacePath && (
                  <span className="text-[10px] text-[var(--color-brand-teal)]/70 max-w-[160px] truncate">
                    {workspacePath.split(/[/\\]/).pop()}
                  </span>
                )}
              </div>
            </button>
            <div className="border-t border-[var(--color-border)]" />
            {/* Select Files */}
            <button
              onClick={() => {
                fileInputRef.current?.click()
                setShowContextMenu(false)
              }}
              className="w-full flex items-center gap-3 px-4 py-3 text-[var(--text-sm)] text-[var(--color-text-primary)] hover:bg-[var(--color-surface)] hover:text-[var(--color-primary)] transition-colors"
            >
              <FileIcon
                size={16}
                className={hasAttachments ? 'text-[var(--color-success)]' : 'text-[var(--color-text-muted)]'}
              />
              <span className="font-[var(--font-weight-medium)]">Select Files</span>
            </button>
          </div>
        )}
      </div>

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
