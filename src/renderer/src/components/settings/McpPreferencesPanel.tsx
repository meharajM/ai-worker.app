import React from 'react'
import { Monitor, Cpu, Shield, HardDrive, Database } from 'lucide-react'
import { useSettingsStore, PlaywrightBrowserType } from '../../stores/settingsStore'

export const McpPreferencesPanel: React.FC = () => {
    const { 
        playwrightBrowser, 
        setPlaywrightBrowser, 
        playwrightHeadless, 
        setPlaywrightHeadless,
        fileSystemSafeMode,
        setFileSystemSafeMode,
        fileSystemAutoApprove,
        setFileSystemAutoApprove
    } = useSettingsStore()

    const browsers: { value: PlaywrightBrowserType; label: string }[] = [
        { value: 'auto', label: 'Auto-Detect (Recommended)' },
        { value: 'chrome', label: 'Google Chrome' },
        { value: 'msedge', label: 'Microsoft Edge' },
        { value: 'firefox', label: 'Mozilla Firefox' },
        { value: 'chromium', label: 'Chromium (Bundled)' },
    ]

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
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                        <label className="text-sm font-medium text-foreground">Browser Provider</label>
                        <select
                            className="w-full flex h-10 items-center justify-between rounded-md border border-[var(--color-border)] bg-[var(--color-input-bg)] px-3 py-2 text-sm text-[var(--color-text-primary)] placeholder:text-[var(--color-text-dim)] focus:outline-none focus:ring-2 focus:ring-[var(--color-brand-teal)]/50 focus:border-[var(--color-brand-teal)]/50 disabled:cursor-not-allowed disabled:opacity-50"
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
                            When enabled, user-facing file edits are staged in a temporary area and require your approval. Internal AI-Worker tracking files (like <code>.ai-worker/tasks.json</code>) are written automatically.
                        </p>
                    </div>
                    <input
                        type="checkbox"
                        className="toggle toggle-success"
                        checked={fileSystemSafeMode}
                        onChange={(e) => setFileSystemSafeMode(e.target.checked)}
                    />
                </div>

                <div className="flex items-center justify-between space-x-2 border rounded-md p-3">
                    <div className="space-y-0.5">
                        <label className="text-sm font-medium text-foreground">Auto-Approve Writes</label>
                        <p className="text-xs text-muted-foreground">
                            Automatically commit staged writes without showing the approval queue.
                        </p>
                    </div>
                    <input
                        type="checkbox"
                        className="toggle toggle-success"
                        checked={fileSystemAutoApprove}
                        onChange={(e) => setFileSystemAutoApprove(e.target.checked)}
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
