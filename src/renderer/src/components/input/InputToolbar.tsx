import React from 'react'
import { Folder, Eye, EyeOff } from 'lucide-react'

interface InputToolbarProps {
  /** Current workspace path (null = none selected) */
  workspacePath: string | null
  /** Whether headless mode is active */
  isHeadless: boolean
  /** Toggle headless mode */
  onToggleHeadless: () => void
  /** Open folder picker */
  onSelectFolder: () => void
  /** Whether the input is disabled */
  disabled?: boolean
}

/**
 * Toolbar buttons alongside the input: workspace selector + headless toggle.
 * Extracted from VoiceInput for independent experiment control.
 */
export function InputToolbar({
  workspacePath,
  isHeadless,
  onToggleHeadless,
  onSelectFolder,
  disabled = false,
}: InputToolbarProps) {
  return (
    <>
      {/* Workspace Folder Button */}
      <button
        onClick={onSelectFolder}
        disabled={disabled}
        className={`p-2 mb-[1px] rounded-lg transition-all h-[44px] w-[36px] flex items-center justify-center ${
          workspacePath
            ? 'bg-[var(--color-accent)]/20 text-[var(--color-accent)] hover:bg-[var(--color-accent)]/30'
            : 'bg-transparent text-white/40 hover:text-white/60 hover:bg-white/5'
        } ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
        title={
          workspacePath
            ? `Workspace: ${workspacePath}`
            : 'Select workspace folder'
        }
      >
        <Folder size={18} />
      </button>

      {/* Headless Toggle */}
      <button
        onClick={onToggleHeadless}
        disabled={disabled}
        className={`p-2 mb-[1px] rounded-lg transition-all h-[44px] w-[36px] flex items-center justify-center ${
          isHeadless
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
