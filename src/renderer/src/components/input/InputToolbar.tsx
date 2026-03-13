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
          className={`p-2 mb-[1px] rounded-lg transition-all h-[44px] w-[36px] flex items-center justify-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] ${workspacePath
              ? 'bg-[var(--color-brand-teal)]/20 text-[var(--color-brand-teal)] hover:bg-[var(--color-brand-teal)]/30'
              : hasAttachments
                ? 'bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30'
                : 'bg-transparent text-white/40 hover:text-white/60 hover:bg-white/5'
            } ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
          title={workspacePath ? `Workspace: ${workspacePath}` : 'Select workspace or files'}
        >
          <Paperclip size={18} />
        </button>

        {/* Dropdown Menu */}
        {showContextMenu && (
          <div className="absolute bottom-full mb-2 -right-4 bg-[var(--color-card-elevated)] border border-white/15 rounded-xl shadow-glass overflow-hidden min-w-[200px] animate-in fade-in slide-in-from-bottom-2 duration-fast z-50">
            {/* Select Workspace */}
            <button
              onClick={() => {
                onSelectFolder()
                setShowContextMenu(false)
              }}
              className="w-full flex items-center gap-3 px-4 py-3 text-sm text-white/80 hover:bg-white/10 hover:text-white transition-colors"
            >
              <FolderOpen
                size={16}
                className={workspacePath ? 'text-[var(--color-brand-teal)]' : 'text-white/50'}
              />
              <div className="flex flex-col items-start">
                <span className="font-medium">Select Workspace</span>
                {workspacePath && (
                  <span className="text-[10px] text-[var(--color-brand-teal)]/70 max-w-[160px] truncate">
                    {workspacePath.split(/[/\\]/).pop()}
                  </span>
                )}
              </div>
            </button>
            <div className="border-t border-white/10" />
            {/* Select Files */}
            <button
              onClick={() => {
                fileInputRef.current?.click()
                setShowContextMenu(false)
              }}
              className="w-full flex items-center gap-3 px-4 py-3 text-sm text-white/80 hover:bg-white/10 hover:text-white transition-colors"
            >
              <FileIcon
                size={16}
                className={hasAttachments ? 'text-emerald-400' : 'text-white/50'}
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
        className={`p-2 mb-[1px] rounded-lg transition-all h-[44px] w-[36px] flex items-center justify-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] ${isHeadless
            ? 'bg-purple-500/20 text-purple-400 hover:bg-purple-500/30'
            : 'bg-transparent text-white/40 hover:text-white/60 hover:bg-white/5'
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
