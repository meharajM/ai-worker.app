import React, { useState, useRef, useEffect } from 'react'
import { Eye, EyeOff, Paperclip, FolderOpen, File as FileIcon } from 'lucide-react'

interface InputToolbarProps {
  /** Current workspace path (null = none selected) */
  workspacePath: string | null
  /** Whether headless mode is active */
  isHeadless: boolean
  /** Toggle headless mode */
  onToggleHeadless: () => void
  /** Open folder picker */
  onSelectFolder: () => void
  /** Handle multiple file selection */
  onSelectFiles: (files: File[]) => void
  /** Whether attachments currently exist in ChatInput */
  hasAttachments: boolean
  /** Whether the input is disabled */
  disabled?: boolean
}

/**
 * Toolbar buttons alongside the input: unified workspace/file selector + headless toggle.
 */
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

  // Handle basic file selection from the hidden input
  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      onSelectFiles(Array.from(e.target.files))
      // Reset input so the same files can be chosen again
      e.target.value = ''
    }
  }

  // Close dropdown when clicking outside
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
          className={`p-2 mb-[1px] rounded-lg transition-all h-[44px] w-[36px] flex items-center justify-center ${workspacePath
              ? 'bg-[var(--color-accent-muted)] text-[var(--color-accent)] hover:bg-[var(--color-accent)]/20'
              : hasAttachments
                ? 'bg-[var(--color-success-muted)] text-[var(--color-success)] hover:bg-[var(--color-success)]/20'
                : 'bg-transparent text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-bg-surface)]'
            } ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
          title={workspacePath ? `Workspace: ${workspacePath}` : 'Select workspace or files'}
        >
          <Paperclip size={18} />
        </button>

        {/* Dropdown Menu */}
        {showContextMenu && (
          <div className="absolute bottom-full mb-2 -right-4 bg-[var(--color-bg-elevated)] border border-[var(--color-border-hover)] rounded-lg shadow-lg overflow-hidden min-w-[200px] animate-in fade-in slide-in-from-bottom-2 duration-150 z-50">
            {/* Select Workspace */}
            <button
              onClick={() => {
                onSelectFolder()
                setShowContextMenu(false)
              }}
              className="w-full flex items-center gap-3 px-4 py-3 text-sm text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-surface)] hover:text-[var(--color-text-primary)] transition-colors"
            >
              <FolderOpen
                size={16}
                className={workspacePath ? 'text-[var(--color-accent)]' : 'text-[var(--color-text-tertiary)]'}
              />
              <div className="flex flex-col items-start">
                <span className="font-medium">Select Workspace</span>
                {workspacePath && (
                  <span className="text-[10px] text-[var(--color-accent)]/70 max-w-[160px] truncate">
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
              className="w-full flex items-center gap-3 px-4 py-3 text-sm text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-surface)] hover:text-[var(--color-text-primary)] transition-colors"
            >
              <FileIcon
                size={16}
                className={hasAttachments ? 'text-[var(--color-success)]' : 'text-[var(--color-text-tertiary)]'}
              />
              <span className="font-medium">Select Files</span>
            </button>
          </div>
        )}
      </div>

      {/* Headless Toggle */}
      <button
        onClick={onToggleHeadless}
        disabled={disabled}
        className={`p-2 mb-[1px] rounded-lg transition-all h-[44px] w-[36px] flex items-center justify-center ${isHeadless
            ? 'bg-[var(--color-accent-muted)] text-[var(--color-accent)] hover:bg-[var(--color-accent)]/20'
            : 'bg-transparent text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-bg-surface)]'
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
