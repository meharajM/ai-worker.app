
import React, { useState, useEffect } from 'react'
import { HardDrive, Server, RefreshCw, AlertCircle, Check, ArrowRight } from 'lucide-react'
import { useSettingsStore } from '../../stores/settingsStore'
import { MemoryInspector } from './memory/MemoryInspector'

interface MemoryStats {
    entityCount: number
    relationCount: number
    storageSize: number
    avgSearchLatency: number
    backend: string
}

export function MemoryPreferencesPanel() {
    const settings = useSettingsStore()
    const [stats, setStats] = useState<MemoryStats | null>(null)
    const [loading, setLoading] = useState(false)
    const [migrationStatus, setMigrationStatus] = useState<'idle' | 'migrating' | 'success' | 'error'>('idle')

    const loadStats = async () => {
        if (!window.electron?.memory) return
        setLoading(true)
        try {
            const response = await window.electron.memory.getStats()
            if (response.success && response.stats) {
                setStats(response.stats)
            } else {
                console.error('Failed to load memory stats:', response.error)
            }
        } catch (error) {
            console.error('Failed to load memory stats:', error)
        } finally {
            setLoading(false)
        }
    }

    // Load stats on mount
    useEffect(() => {
        loadStats()
    }, [])

    const handleBackendChange = async (backend: 'server-memory' | 'memento-mcp') => {
        await settings.setMemoryBackend(backend)
        // Refresh stats to see new backend state
        setTimeout(loadStats, 500)
    }

    const formatBytes = (bytes: number) => {
        if (bytes === 0) return '0 B'
        const k = 1024
        const sizes = ['B', 'KB', 'MB', 'GB']
        const i = Math.floor(Math.log(bytes) / Math.log(k))
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
    }

    return (
        <div className="space-y-6">
            <div className="flex items-center gap-3 mb-6">
                <div className="p-3 bg-[var(--color-accent-muted)] rounded-lg">
                    <HardDrive className="w-6 h-6 text-[var(--color-accent)]" />
                </div>
                <div>
                    <h3 className="text-xl font-bold text-[var(--color-text-primary)]">Memory Architecture</h3>
                    <p className="text-sm text-[var(--color-text-secondary)]">Configure how the AI agent stores and retrieves long-term memories.</p>
                </div>
            </div>

            {/* Backend Selection */}
            <div className="bg-[var(--color-bg-elevated)] border border-[var(--color-border)] rounded-lg p-4">
                <label className="block text-sm font-medium text-[var(--color-text-primary)] mb-4">Storage Backend</label>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <button
                        onClick={() => handleBackendChange('server-memory')}
                        className={`flex flex-col items-start p-4 rounded-lg border transition-all ${
                            settings.memoryBackend === 'server-memory'
                                ? 'bg-[var(--color-accent-muted)] border-[var(--color-accent)]/50'
                                : 'bg-[var(--color-bg-surface)] border-transparent hover:bg-[var(--color-bg-raised)]'
                        }`}
                    >
                        <div className="flex items-center gap-2 mb-2">
                            <Server className={`w-5 h-5 ${settings.memoryBackend === 'server-memory' ? 'text-[var(--color-accent)]' : 'text-[var(--color-text-secondary)]'}`} />
                            <span className="font-bold text-[var(--color-text-primary)]">Server Memory</span>
                        </div>
                        <p className="text-xs text-left text-[var(--color-text-tertiary)]">
                            Local JSON-based storage. Fast and simple. Best for personal use and standard workloads.
                        </p>
                    </button>

                    <button
                        onClick={() => handleBackendChange('memento-mcp')}
                        className={`flex flex-col items-start p-4 rounded-lg border transition-all ${
                            settings.memoryBackend === 'memento-mcp'
                                ? 'bg-[var(--color-accent-muted)] border-[var(--color-accent)]/50'
                                : 'bg-[var(--color-bg-surface)] border-transparent hover:bg-[var(--color-bg-raised)]'
                        }`}
                    >
                        <div className="flex items-center gap-2 mb-2">
                            <HardDrive className={`w-5 h-5 ${settings.memoryBackend === 'memento-mcp' ? 'text-[var(--color-accent)]' : 'text-[var(--color-text-secondary)]'}`} />
                            <span className="font-bold text-[var(--color-text-primary)]">Memento MCP (Neo4j)</span>
                        </div>
                        <p className="text-xs text-left text-[var(--color-text-tertiary)]">
                            Graph database storage. Scalable and relational. Best for massive context and complex queries.
                        </p>
                    </button>
                </div>
            </div>

            {/* Current Stats */}
            <div className="bg-[var(--color-bg-elevated)] border border-[var(--color-border)] rounded-lg p-6">
                <div className="flex items-center justify-between mb-4">
                    <h4 className="font-medium text-[var(--color-text-primary)] flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full bg-[var(--color-success)] animate-pulse"></span>
                        Active Memory Stats
                    </h4>
                    <button 
                        onClick={loadStats}
                        disabled={loading}
                        className="p-2 hover:bg-[var(--color-bg-surface)] rounded-lg transition-colors"
                    >
                        <RefreshCw className={`w-4 h-4 text-[var(--color-text-tertiary)] ${loading ? 'animate-spin' : ''}`} />
                    </button>
                </div>

                {stats ? (
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                        <div className="bg-[var(--color-bg-dark)] p-3 rounded-lg">
                            <div className="text-xs text-[var(--color-text-tertiary)] mb-1">Total Entities</div>
                            <div className="text-xl font-mono text-[var(--color-accent)]">{stats.entityCount.toLocaleString()}</div>
                        </div>
                        <div className="bg-[var(--color-bg-dark)] p-3 rounded-lg">
                            <div className="text-xs text-[var(--color-text-tertiary)] mb-1">Relations</div>
                            <div className="text-xl font-mono text-[var(--color-info)]">{stats.relationCount.toLocaleString()}</div>
                        </div>
                        <div className="bg-[var(--color-bg-dark)] p-3 rounded-lg">
                            <div className="text-xs text-[var(--color-text-tertiary)] mb-1">Storage Size</div>
                            <div className="text-xl font-mono text-[var(--color-warning)]">{formatBytes(stats.storageSize)}</div>
                        </div>
                        <div className="bg-[var(--color-bg-dark)] p-3 rounded-lg">
                            <div className="text-xs text-[var(--color-text-tertiary)] mb-1">Search Latency</div>
                            <div className="text-xl font-mono text-[var(--color-success)]">{stats.avgSearchLatency.toFixed(1)}ms</div>
                        </div>
                    </div>
                ) : (
                    <div className="text-center py-8 text-[var(--color-text-disabled)]">
                        {loading ? 'Loading statistics...' : 'Stats unavailable'}
                    </div>
                )}
            </div>

            {/* Migration Suggestion (Conditional) */}
            {(migrationStatus === 'success' || (stats && stats.entityCount > 10000 && settings.memoryBackend === 'server-memory')) && (
                <div className={`border rounded-lg p-4 flex items-start gap-4 ${
                    migrationStatus === 'success' 
                        ? 'bg-[var(--color-success-muted)] border-[var(--color-success)]/20' 
                        : 'bg-[var(--color-warning-muted)] border-[var(--color-warning)]/20'
                }`}>
                    <div className={`p-2 rounded-lg ${
                        migrationStatus === 'success' ? 'bg-[var(--color-success)]/20' : 'bg-[var(--color-warning)]/20'
                    }`}>
                        {migrationStatus === 'success' ? (
                            <Check className="w-6 h-6 text-[var(--color-success)]" />
                        ) : (
                            <AlertCircle className="w-6 h-6 text-[var(--color-warning)]" />
                        )}
                    </div>
                    <div className="flex-1">
                        <h4 className={`font-bold mb-1 ${
                            migrationStatus === 'success' ? 'text-[var(--color-success)]' : 'text-[var(--color-warning)]'
                        }`}>
                            {migrationStatus === 'success' ? 'Migration Complete' : 'Scalability Warning'}
                        </h4>
                        <p className={`text-sm mb-3 ${
                            migrationStatus === 'success' ? 'text-[var(--color-text-secondary)]' : 'text-[var(--color-text-secondary)]'
                        }`}>
                            {migrationStatus === 'success' 
                                ? 'Your memory has been successfully migrated to Memento MCP.' 
                                : 'You have over 10,000 entities. Server Memory may start to slow down. We recommend migrating to Memento MCP (Neo4j) for better performance.'}
                        </p>
                        
                        {migrationStatus !== 'success' && (
                            <button 
                                onClick={async () => {
                                    if (!window.electron?.memory) return
                                    setMigrationStatus('migrating')
                                    try {
                                        const result = await window.electron.memory.migrate()
                                        if (result.success) {
                                            setMigrationStatus('success')
                                            loadStats() // Refresh stats
                                        } else {
                                            setMigrationStatus('error')
                                            console.error(result.error)
                                        }
                                    } catch (e) {
                                        setMigrationStatus('error')
                                        console.error(e)
                                    }
                                }}
                                disabled={migrationStatus === 'migrating'}
                                className="px-4 py-2 bg-[var(--color-warning-muted)] hover:bg-[var(--color-warning)]/20 text-[var(--color-warning)] rounded-lg text-sm font-medium transition-colors flex items-center gap-2"
                            >
                                {migrationStatus === 'migrating' ? (
                                    <>
                                        <RefreshCw className="animate-spin w-4 h-4" /> 
                                        Migrating...
                                    </>
                                ) : (
                                    <>
                                        Start Migration <ArrowRight size={16} />
                                    </>
                                )}
                            </button>
                        )}
                    </div>
                </div>
            )}

            {/* Memory Inspector */}
            {/* Debug Test Button */}
            <div className="flex justify-end">
                <button
                    onClick={async () => {
                        console.log('Testing memory write...');
                        try {
                            const result = await window.electron.memory.callTool('memory_create_entity', {
                                name: 'Manual Test Entity',
                                type: 'test_data',
                                description: 'This is a safe test description.',
                                observations: ['This is a safe test description.']
                            });
                            console.log('Memory write result:', result);
                            alert(result.success ? 'Write Success!' : 'Write Failed: ' + result.error);
                            loadStats(); // Refresh stats
                        } catch (e: any) {
                            console.error('Memory write exception:', e);
                            alert('Write Exception: ' + e.message);
                        }
                    }}
                    className="text-xs text-[var(--color-text-disabled)] hover:text-[var(--color-text-primary)] underline"
                >
                    Test Write
                </button>
            </div>

            <MemoryInspector />
        </div>
    )
}
