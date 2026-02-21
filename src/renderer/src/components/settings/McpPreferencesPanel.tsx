import React, { useEffect, useState } from 'react'
import { Monitor, Cpu, Shield, HardDrive, Database, Check, AlertCircle, Loader2, Download } from 'lucide-react'
import { useSettingsStore, PlaywrightBrowserType } from '../../stores/settingsStore'
import { isElectron, electron } from '../../lib/electron'

interface BrowserStatus {
    browser: string
    installed: boolean
    version?: string
    error?: string
}

export const McpPreferencesPanel: React.FC = () => {
    const { 
        playwrightBrowser, 
        setPlaywrightBrowser, 
        playwrightHeadless, 
        setPlaywrightHeadless,
        fileSystemSafeMode,
        setFileSystemSafeMode
    } = useSettingsStore()

    const [browserStatuses, setBrowserStatuses] = useState<Record<string, BrowserStatus>>({})
    const [checkingStatus, setCheckingStatus] = useState(false)
    const [installing, setInstalling] = useState(false)
    const [installError, setInstallError] = useState('')

    const browsers: { value: PlaywrightBrowserType; label: string }[] = [
        { value: 'auto', label: 'Auto-Detect (Recommended)' },
        { value: 'chrome', label: 'Google Chrome' },
        { value: 'msedge', label: 'Microsoft Edge' },
        { value: 'firefox', label: 'Mozilla Firefox' },
        { value: 'chromium', label: 'Chromium (Bundled)' },
    ]

    useEffect(() => {
        checkAllStatuses()
    }, [])

    // Re-check when browser selection changes
    useEffect(() => {
        if (playwrightBrowser !== 'auto') {
            checkAllStatuses()
        }
    }, [playwrightBrowser])

    const checkAllStatuses = async () => {
        if (!isElectron()) return
        setCheckingStatus(true)
        try {
            const statuses = await electron.browser.checkAllStatuses()
            const statusMap: Record<string, BrowserStatus> = {}
            statuses.forEach((status) => {
                statusMap[status.browser] = status
            })
            setBrowserStatuses(statusMap)
        } catch (error) {
            console.error('Failed to check browser statuses:', error)
        } finally {
            setCheckingStatus(false)
        }
    }

    const handleInstall = async () => {
        if (!isElectron() || playwrightBrowser === 'auto') return
        setInstalling(true)
        setInstallError('')
        try {
            const result = await electron.browser.install(playwrightBrowser as 'chrome' | 'msedge' | 'firefox' | 'webkit' | 'chromium')
            if (result.success) {
                await checkAllStatuses()
            } else {
                setInstallError(result.error || 'Installation failed')
            }
        } catch (err) {
            setInstallError(err instanceof Error ? err.message : 'Unknown error')
        } finally {
            setInstalling(false)
        }
    }

    const selectedStatus = playwrightBrowser !== 'auto' ? browserStatuses[playwrightBrowser] : null
    const selectedLabel = browsers.find(b => b.value === playwrightBrowser)?.label ?? playwrightBrowser

    return (
        <div className="space-y-8">
            {/* Header */}
            <div>
                <h2 className="text-lg font-medium text-foreground flex items-center gap-2">
                    <Cpu className="w-5 h-5 text-primary" />
                    Browser & Agent Capabilities
                </h2>
                <p className="text-sm text-muted-foreground mt-1">
                    Configure the underlying engines that power your AI agent's ability to browse the web and interact with your system.
                </p>
            </div>

            {/* Browser Automation Section */}
            <div className="space-y-4 border rounded-lg p-4 bg-card/50">
                <div className="flex items-center gap-2 mb-2">
                    <Monitor className="w-4 h-4 text-primary" />
                    <h3 className="font-medium text-foreground">Browser Engine</h3>
                </div>
                
                <div className="space-y-4">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="space-y-2">
                            <label className="text-sm font-medium text-foreground">Browser Provider</label>
                            <select
                                className="w-full flex h-10 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                                value={playwrightBrowser}
                                onChange={(e) => setPlaywrightBrowser(e.target.value as PlaywrightBrowserType)}
                            >
                                {browsers.map((b) => (
                                    <option key={b.value} value={b.value}>
                                        {b.label}
                                    </option>
                                ))}
                            </select>
                            <p className="text-xs text-muted-foreground">
                                The actual browser instance used for web tasks. "Auto" picks the best installed browser.
                            </p>
                        </div>

                        <div className="flex items-center justify-between space-x-2 border rounded-md p-3">
                            <div className="space-y-0.5">
                                <label className="text-sm font-medium text-foreground">Headless Mode</label>
                                <p className="text-xs text-muted-foreground">
                                    Hide the browser window while the agent works
                                </p>
                            </div>
                            <input
                                type="checkbox"
                                className="toggle"
                                checked={playwrightHeadless}
                                onChange={(e) => setPlaywrightHeadless(e.target.checked)}
                            />
                        </div>
                    </div>

                    {/* Browser Status + Install Section */}
                    {playwrightBrowser !== 'auto' && (
                        <div className="border rounded-md p-4 bg-muted/50 space-y-3">
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-3">
                                    {checkingStatus ? (
                                        <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
                                    ) : selectedStatus?.installed ? (
                                        <Check className="w-5 h-5 text-green-500" />
                                    ) : (
                                        <AlertCircle className="w-5 h-5 text-amber-500" />
                                    )}
                                    <div>
                                        <p className="text-sm font-medium">
                                            {checkingStatus
                                                ? 'Checking...'
                                                : selectedStatus?.installed
                                                    ? `${selectedLabel} is installed and ready`
                                                    : `${selectedLabel} is not installed`
                                            }
                                        </p>
                                        {!checkingStatus && selectedStatus && !selectedStatus.installed && (
                                            <p className="text-xs text-muted-foreground">
                                                Required for web automation tasks
                                            </p>
                                        )}
                                    </div>
                                </div>

                                {!checkingStatus && selectedStatus && !selectedStatus.installed && (
                                    <button
                                        onClick={handleInstall}
                                        disabled={installing}
                                        className="flex items-center gap-2 px-3 py-1.5 bg-primary text-primary-foreground rounded-md text-sm font-medium hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                                    >
                                        {installing ? (
                                            <><Loader2 className="w-3 h-3 animate-spin" />Installing...</>
                                        ) : (
                                            <><Download className="w-3 h-3" />Install</>
                                        )}
                                    </button>
                                )}
                            </div>
                            {installError && (
                                <p className="text-xs text-destructive">{installError}</p>
                            )}
                        </div>
                    )}
                </div>
            </div>

            {/* Filesystem Safety Section */}
            <div className="space-y-4 border rounded-lg p-4 bg-card/50">
                <div className="flex items-center gap-2 mb-2">
                    <HardDrive className="w-4 h-4 text-green-500" />
                    <h3 className="font-medium text-foreground">Filesystem & Safety</h3>
                </div>

                <div className="flex items-center justify-between space-x-2 border rounded-md p-3 bg-green-500/5 border-green-500/20">
                    <div className="space-y-0.5">
                        <label className="text-sm font-medium text-foreground flex items-center gap-2">
                            <Shield className="w-3 h-3 text-green-500" />
                            Safe Mode (Shadow Writes)
                        </label>
                        <p className="text-xs text-muted-foreground">
                            When enabled, the agent cannot write to files directly. Changes are staged in a temporary area and require your approval.
                        </p>
                    </div>
                    <input
                        type="checkbox"
                        className="toggle toggle-success"
                        checked={fileSystemSafeMode}
                        onChange={(e) => setFileSystemSafeMode(e.target.checked)}
                    />
                </div>
            </div>

            {/* Memory Section (Placeholder for Phase 4 completion) */}
            <div className="space-y-4 border rounded-lg p-4 bg-card/50 opacity-75">
                <div className="flex items-center gap-2 mb-2">
                    <Database className="w-4 h-4 text-blue-500" />
                    <h3 className="font-medium text-foreground">Long-Term Memory</h3>
                </div>
                <div className="text-sm text-muted-foreground">
                    <p>The agent uses a local SQLite database to remember entities and relationships.</p>
                    <div className="mt-2 flex gap-2">
                        <button className="btn btn-xs btn-outline" disabled>View Knowledge Graph (Coming Soon)</button>
                        <button className="btn btn-xs btn-outline btn-error" disabled>Reset Memory</button>
                    </div>
                </div>
            </div>
        </div>
    )
}
