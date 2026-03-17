import React, { useState, useEffect, useRef, useCallback } from 'react'
import {
    User,
    Volume2,
    VolumeX,
    Palette,
    Info,
    ChevronRight,
    LogIn,
    LogOut,
    Cpu,
    Loader2,
    Check,
    AlertCircle,
    Flag,
    Download,
    HardDrive,
    Trash2,
    Globe,
    FolderOpen,
    FileText,
    Mic,
    Sparkles,
    Activity,
    Clock,
    Zap
} from 'lucide-react'
import { useLogStore } from '../stores/logStore'
import { useSettingsStore, Theme, LLMProviderType } from '../stores/settingsStore'
import { useAuthStore } from '../stores/authStore'
import { FEATURE_FLAGS, APP_INFO, VOICE_CONFIG } from '../lib/constants'
import { isDevelopmentMode } from '../lib/featureFlags'
import { EnhancedFeatureFlagsPanel } from './EnhancedFeatureFlagsPanel'
import { SystemDependenciesSettings } from './SystemDependenciesSettings'
import { Card, CardContent } from './primitives/Card'
import { StatusBadge } from './primitives/StatusDot'
import { AccountSettings } from './settings/AccountSettings'
import {
    chat,
    subscribeToWebLLMStatus,
    downloadBrowserModel,
    checkWebLLMModelCompatibility,
    testWebLLMConnection, // Kept from original
    WEBLLM_MODELS, // Kept from original
    deleteWebLLMModel // Kept from original
} from '../lib/llm'
import { MemoryPreferencesPanel } from './settings/MemoryPreferencesPanel'
import { ModelSelect } from './ModelSelect'
import { ErrorBoundary } from './ErrorBoundary'
import { LLMProviderSettings } from './settings/llm/LLMProviderSettings'
import { SidebarHeader } from './sidebar/SidebarHeader'
import { ArrowLeft } from 'lucide-react'

type SettingsSection = 'account' | 'llm' | 'voice' | 'memory' | 'browser' | 'appearance' | 'logs' | 'flags' | 'about'

interface SettingsPanelProps {
    onClose: () => void;
}

export function SettingsPanel({ onClose }: SettingsPanelProps) {
    const [activeSection, setActiveSection] = useState<SettingsSection>('llm')

    const [testingBrowser, setTestingBrowser] = useState(false)
    const [downloadingBrowser, setDownloadingBrowser] = useState(false)
    const [downloadingModelId, setDownloadingModelId] = useState<string | null>(null)
    const [downloadProgress, setDownloadProgress] = useState(0)
    const [testResults, setTestResults] = useState<{ browser?: string }>({})
    const [modelCompatibility, setModelCompatibility] = useState<Record<string, { compatible: boolean; reasons: string[] }>>({})

    const settings = useSettingsStore()
    const auth = useAuthStore()
    const { openLogFolder, getLogPath } = useLogStore()
    const [logPath, setLogPath] = useState<string>('')

    useEffect(() => {
        getLogPath().then(setLogPath)
    }, [getLogPath])


    // Synchronize with global background download status
    useEffect(() => {
        const unsubscribe = subscribeToWebLLMStatus((status) => {
            // Update local state if a background download is active
            if (status.backgroundDownload) {
                setDownloadingModelId(status.backgroundDownload.modelId);
                setDownloadProgress(status.backgroundDownload.progress);
                setDownloadingBrowser(true);
            } else if (status.isLoading) {
                // If main engine is loading, it's the preferred browser model
                setDownloadingModelId(settings.browserModel);
                setDownloadProgress(status.loadingProgress);
                setDownloadingBrowser(true);
            } else {
                // No active loading/downloading in global state
                // If our local state says we ARE downloading, check if it's actually finished
                setDownloadingModelId(null);
                setDownloadProgress(0);
                setDownloadingBrowser(false);
            }
        });
        return () => unsubscribe();
    }, [settings.browserModel]);


    const sections: { id: SettingsSection; label: string; icon: React.ReactNode }[] = [
        ...(FEATURE_FLAGS.AUTH_ENABLED ? [{ id: 'account' as const, label: 'Account', icon: <User size={20} /> }] : []),
        { id: 'llm', label: 'LLM Provider', icon: <Cpu size={20} /> },
        { id: 'voice', label: 'Speech Recognition', icon: <Mic size={20} /> },
        { id: 'memory', label: 'Memory', icon: <HardDrive size={20} /> },
        { id: 'browser', label: 'Browser Automation', icon: <Globe size={20} /> },
        { id: 'appearance', label: 'Appearance', icon: <Palette size={20} /> },
        { id: 'logs', label: 'Auditing', icon: <FileText size={20} /> },
        ...(isDevelopmentMode() ? [{ id: 'flags' as const, label: 'Feature Flags', icon: <Flag size={20} /> }] : []),
        { id: 'about', label: 'About', icon: <Info size={20} /> },
    ]

    return (
        <div className="flex-1 flex overflow-hidden">
            {/* Sidebar styling matched exactly to Co-Worker Hub */}
            <div className="w-64 flex-shrink-0 bg-[var(--color-card-dark)] flex flex-col h-full border-r border-[var(--color-border)] transition-all duration-300">
                <SidebarHeader />

                <div className="flex-1 overflow-y-auto px-5 py-4">
                    <h3 className="text-[10px] font-[var(--font-weight-bold)] text-[var(--color-text-dim)] tracking-wider uppercase mb-3">
                        Settings
                    </h3>
                    <nav className="flex flex-col gap-1">
                        {sections.map((section) => (
                            <button
                                key={section.id}
                                onClick={() => setActiveSection(section.id)}
                                className={`w-full flex items-center gap-3 px-2 py-2 -mx-2 rounded-lg text-xs font-medium transition-colors ${activeSection === section.id
                                    ? 'bg-[var(--color-surface)] text-[var(--color-text-primary)]'
                                    : 'text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-surface)]'
                                    }`}
                            >
                                <span className={activeSection === section.id ? 'text-[var(--color-primary)]' : 'text-[var(--color-text-dim)]'}>
                                    {section.icon}
                                </span>
                                {section.label}
                            </button>
                        ))}
                    </nav>
                </div>

                <div className="px-5 py-4 border-t border-[var(--color-border)]">
                    <button
                        onClick={onClose}
                        title="Chat"
                        className="w-full flex items-center justify-between py-2 px-2 -mx-2 rounded-lg transition-colors group cursor-pointer text-[var(--color-text-muted)] hover:bg-[var(--color-surface)] hover:text-[var(--color-text-primary)]"
                    >
                        <div className="flex items-center gap-3">
                            <ArrowLeft size={16} className="text-[var(--color-text-dim)] group-hover:text-[var(--color-text-primary)]" />
                            <span className="text-xs font-medium">Back to Hub</span>
                        </div>
                    </button>
                </div>
            </div>

            {/* Content pane with darker background for contrast with the Settings panel elements */}
            <div className="flex-1 min-w-0 overflow-y-auto p-10 bg-[var(--color-bg-dark)]">
                {/* Account Section */}
                {activeSection === 'account' && FEATURE_FLAGS.AUTH_ENABLED && (
                    <AccountSettings />
                )}

                {/* Memory Section */}
                {activeSection === 'memory' && (
                    <ErrorBoundary>
                        <MemoryPreferencesPanel />
                    </ErrorBoundary>
                )}

                {/* LLM Provider Section */}
                {activeSection === 'llm' && (
                    <ErrorBoundary>
                        <LLMProviderSettings />
                    </ErrorBoundary>
                )}

                {/* Voice Section */}
                {
                    activeSection === 'voice' && (
                        <div>
                            <h3 className="text-xl font-bold mb-6">Speech Recognition</h3>

                            {/* Speech Recognition Settings */}
                            <div className="bg-[var(--color-card-elevated)] border border-[var(--color-border)] rounded-xl p-4">
                                <div className="flex items-center justify-between mb-4">
                                    <div>
                                        <p className="font-medium text-[var(--color-text-primary)]">Speech Recognition Engine</p>
                                        <p className="text-xs text-[var(--color-text-muted)]">
                                            Using Native Vosk (Offline/Local) - WebAssembly
                                        </p>
                                    </div>
                                    <div className="px-3 py-1 rounded-full text-xs font-medium bg-[var(--color-success)]/20 text-[var(--color-success)] border border-[var(--color-success)]/30">
                                        Offline Mode
                                    </div>
                                </div>

                                <div className="mb-4">
                                    <label className="block text-sm text-[var(--color-text-secondary)] mb-2">Language Model</label>
                                    <select
                                        value={settings.voskModel}
                                        onChange={(e) => settings.setVoskModel(e.target.value)}
                                        className="w-full bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg px-3 py-2 text-sm text-[var(--color-text-primary)] focus:border-[var(--color-primary)] focus:outline-none appearance-none"
                                    >
                                        <option value="auto">Auto-Detect (System Default)</option>
                                        <option disabled>──────────</option>
                                        {VOICE_CONFIG.VOSK_MODELS.map((model) => (
                                            <option key={model.id} value={model.id}>
                                                {model.name}
                                            </option>
                                        ))}
                                    </select>
                                    <p className="text-xs text-[var(--color-text-dim)] mt-2">
                                        Selected: {settings.voskModel === 'auto' ? 'Auto (based on system locale)' : VOICE_CONFIG.VOSK_MODELS.find(m => m.id === settings.voskModel)?.name || settings.voskModel}
                                    </p>
                                </div>

                                <p className="text-xs text-[var(--color-text-dim)]">
                                    Runs locally using Vosk engine. Changing the model will trigger a new download (~50MB) on next use.
                                </p>
                            </div>
                        </div>
                    )
                }

                {/* Browser Automation Section */}
                {
                    activeSection === 'browser' && (
                        <div>
                            <h3 className="text-xl font-bold mb-6 text-[var(--color-text-primary)]">Browser Automation</h3>
                            <p className="text-[var(--color-text-secondary)] text-sm mb-6">
                                Configure the browser used by the AI agent for web automation tasks.
                            </p>

                            {/* Browser Selection */}
                            <div className="bg-[var(--color-card-elevated)] border border-[var(--color-border)] rounded-xl p-4 mb-4">
                                <label className="block text-sm text-[var(--color-text-secondary)] mb-3">Browser Engine</label>
                                <select
                                    value={settings.playwrightBrowser || 'auto'}
                                    onChange={(e) => settings.setPlaywrightBrowser(e.target.value as any)}
                                    className="w-full bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg px-4 py-2 text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-brand-teal)]"
                                >
                                    <option value="auto">Auto (OS Default)</option>
                                    <option value="chrome">Google Chrome</option>
                                    <option value="msedge">Microsoft Edge</option>
                                    <option value="firefox">Mozilla Firefox</option>
                                    <option value="webkit">Safari (WebKit)</option>
                                    <option value="chromium">Chromium (Bundled)</option>
                                </select>
                                <p className="text-xs text-[var(--color-text-dim)] mt-2">
                                    Auto selects the best browser for your OS: Windows uses Edge, macOS/Linux use Chrome.
                                </p>
                            </div>

                            {/* Headless Mode */}
                            <div className="bg-[var(--color-card-elevated)] border border-[var(--color-border)] rounded-xl p-4 mb-4">
                                <div className="flex items-center justify-between">
                                    <div>
                                        <label className="block text-sm text-[var(--color-text-primary)] mb-1">Show Browser Window</label>
                                        <p className="text-xs text-[var(--color-text-muted)]">
                                            When enabled, you can see what the AI is doing in the browser.
                                        </p>
                                    </div>
                                    <input
                                        type="checkbox"
                                        className="toggle toggle-success"
                                        checked={!settings.playwrightHeadless}
                                        onChange={() => settings.setPlaywrightHeadless(!settings.playwrightHeadless)}
                                    />
                                </div>
                            </div>

                            {/* Info Box */}
                            <div className="bg-[var(--color-brand-teal)]/10 border border-[var(--color-brand-teal)]/30 rounded-xl p-4">
                                <div className="flex items-start gap-3">
                                    <Info size={20} className="text-[var(--color-brand-teal)] flex-shrink-0 mt-0.5" />
                                    <div className="text-sm text-[var(--color-text-secondary)]">
                                        <p className="font-medium text-[var(--color-text-primary)] mb-1">Session Persistence</p>
                                        <p>
                                            The browser maintains a dedicated profile for the AI agent.
                                            Login sessions and cookies are preserved between automation runs.
                                        </p>
                                    </div>
                                </div>
                            </div>
                        </div>
                    )
                }

                {/* Appearance Section */}
                {
                    activeSection === 'appearance' && (
                        <div>
                            <h3 className="text-xl font-bold mb-6 text-[var(--color-text-primary)]">Appearance</h3>

                            <div className="bg-[var(--color-card-elevated)] border border-[var(--color-border)] rounded-xl p-4">
                                <label className="block text-sm text-[var(--color-text-secondary)] mb-3">Theme</label>
                                <div className="flex gap-2">
                                    {(['dark', 'light', 'system'] as Theme[]).map((theme) => (
                                        <button
                                            key={theme}
                                            onClick={() => settings.setTheme(theme)}
                                            className={`flex-1 py-2 px-4 rounded-lg text-sm capitalize transition-colors ${settings.theme === theme
                                                ? 'bg-[var(--color-brand-teal)] text-[var(--color-text-inverse)]'
                                                : 'bg-[var(--color-surface)] text-[var(--color-text-secondary)] hover:bg-[var(--color-border)]'
                                                }`}
                                        >
                                            {theme}
                                        </button>
                                    ))}
                                </div>
                                <p className="text-xs text-[var(--color-text-muted)] mt-2">
                                    Choose your preferred color scheme. System follows your OS preference.
                                </p>
                            </div>
                        </div>
                    )
                }

                {/* Audit Logs Section */}
                {
                    activeSection === 'logs' && (
                        <div>
                            <h3 className="text-xl font-bold mb-6 text-[var(--color-text-primary)]">Audit Logs</h3>
                            <div className="bg-[var(--color-card-elevated)] border border-[var(--color-border)] rounded-xl p-6">
                                <div className="flex items-start gap-4 mb-6">
                                    <div className="p-3 bg-blue-500/10 rounded-lg">
                                        <FileText className="text-blue-400" size={24} />
                                    </div>
                                    <div>
                                        <h4 className="font-medium mb-1 text-[var(--color-text-primary)]">Corporate Logging Enabled</h4>
                                        <p className="text-sm text-[var(--color-text-secondary)]">
                                            All chat sessions, prompts, and tool executions are logged to the local file system for auditing purposes.
                                            Logs are strictly append-only.
                                        </p>
                                    </div>
                                </div>

                                <div className="bg-[var(--color-surface)] rounded-lg p-4 mb-4">
                                    <label className="text-[10px] uppercase font-bold text-[var(--color-text-dim)] mb-2 block">Local Log Path</label>
                                    <code className="text-xs text-[var(--color-text-primary)] font-mono break-all block select-all">
                                        {logPath || 'Loading...'}
                                    </code>
                                </div>

                                <button
                                    onClick={() => openLogFolder()}
                                    className="flex items-center gap-2 px-4 py-2 bg-[var(--color-surface)] hover:bg-[var(--color-border)] text-[var(--color-text-primary)] rounded-lg transition-colors text-sm"
                                >
                                    <FolderOpen size={16} />
                                    Reveal in File Explorer
                                </button>
                            </div>
                        </div>
                    )
                }

                {/* Feature Flags Section */}
                {
                    activeSection === 'flags' && isDevelopmentMode() && (
                        <EnhancedFeatureFlagsPanel isDevMode={true} />
                    )
                }

                {/* About Section */}
                {
                    activeSection === 'about' && (
                        <div className="space-y-6">
                            <h3 className="text-[var(--text-xl)] font-[var(--font-weight-bold)] text-[var(--color-text-primary)]">About</h3>

                            <Card variant="glass" padding="lg" className="text-center">
                                <div className="w-20 h-20 bg-[var(--color-primary)] rounded-[var(--radius-xl)] flex items-center justify-center mx-auto mb-[var(--space-4)] shadow-lg">
                                    <Sparkles className="w-10 h-10 text-[var(--color-text-inverse)]" />
                                </div>
                                <h4 className="text-[var(--text-2xl)] font-[var(--font-weight-bold)] text-[var(--color-text-primary)]">{APP_INFO.NAME}</h4>
                                <p className="text-[var(--text-sm)] text-[var(--color-text-muted)] mt-[var(--space-1)]">Version {APP_INFO.VERSION}</p>
                                <p className="text-[var(--text-sm)] text-[var(--color-text-secondary)] mt-[var(--space-4)] max-w-sm mx-auto">
                                    Voice-first desktop workspace with MCP integration. Built for AI-assisted productivity.
                                </p>
                                <div className="mt-[var(--space-6)] pt-[var(--space-4)] border-t border-[var(--color-border)]">
                                    <p className="text-[var(--text-xs)] text-[var(--color-text-dim)]">
                                        Built with Electron, React, and TypeScript
                                    </p>
                                </div>
                            </Card>

                            <div className="grid grid-cols-2 gap-[var(--space-3)]">
                                <Card variant="default" padding="md" className="flex items-center gap-3">
                                    <div className="w-10 h-10 rounded-[var(--radius-md)] bg-[var(--color-success)]/15 flex items-center justify-center">
                                        <Activity className="w-5 h-5 text-[var(--color-success)]" />
                                    </div>
                                    <div>
                                        <p className="text-[var(--text-xs)] text-[var(--color-text-dim)]">Status</p>
                                        <StatusBadge variant="success" label="Active" animated />
                                    </div>
                                </Card>
                                <Card variant="default" padding="md" className="flex items-center gap-3">
                                    <div className="w-10 h-10 rounded-[var(--radius-md)] bg-[var(--color-primary)]/15 flex items-center justify-center">
                                        <Zap className="w-5 h-5 text-[var(--color-primary)]" />
                                    </div>
                                    <div>
                                        <p className="text-[var(--text-xs)] text-[var(--color-text-dim)]">Platform</p>
                                        <p className="text-[var(--text-sm)] font-[var(--font-weight-medium)] text-[var(--color-text-primary)]">Electron</p>
                                    </div>
                                </Card>
                                <Card variant="default" padding="md" className="flex items-center gap-3">
                                    <div className="w-10 h-10 rounded-[var(--radius-md)] bg-[var(--color-accent)]/15 flex items-center justify-center">
                                        <Clock className="w-5 h-5 text-[var(--color-accent)]" />
                                    </div>
                                    <div>
                                        <p className="text-[var(--text-xs)] text-[var(--color-text-dim)]">Launch</p>
                                        <p className="text-[var(--text-sm)] font-[var(--font-weight-medium)] text-[var(--color-text-primary)]">Ready</p>
                                    </div>
                                </Card>
                                <Card variant="default" padding="md" className="flex items-center gap-3">
                                    <div className="w-10 h-10 rounded-[var(--radius-md)] bg-[var(--color-brand-teal)]/15 flex items-center justify-center">
                                        <Cpu className="w-5 h-5 text-[var(--color-brand-teal)]" />
                                    </div>
                                    <div>
                                        <p className="text-[var(--text-xs)] text-[var(--color-text-dim)]">Engine</p>
                                        <p className="text-[var(--text-sm)] font-[var(--font-weight-medium)] text-[var(--color-text-primary)]">React</p>
                                    </div>
                                </Card>
                            </div>

                            <SystemDependenciesSettings />
                        </div>
                    )
                }
            </div>
        </div>
    )
}
