
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
                <div className="p-3 bg-purple-500/10 rounded-xl">
                    <HardDrive className="w-6 h-6 text-purple-400" />
                </div>
                <div>
                    <h3 className="text-xl font-bold">Memory Architecture</h3>
                    <p className="text-sm text-white/60">Configure how the AI agent stores and retrieves long-term memories.</p>
                </div>
            </div>

            {/* Backend Selection */}
            <div className="bg-[#1a1d23] border border-white/10 rounded-xl p-4">
                <label className="block text-sm font-medium mb-4">Storage Backend</label>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <button
                        onClick={() => handleBackendChange('server-memory')}
                        className={`flex flex-col items-start p-4 rounded-xl border transition-all ${
                            settings.memoryBackend === 'server-memory'
                                ? 'bg-purple-500/10 border-purple-500/50'
                                : 'bg-white/5 border-transparent hover:bg-white/10'
                        }`}
                    >
                        <div className="flex items-center gap-2 mb-2">
                            <Server className={`w-5 h-5 ${settings.memoryBackend === 'server-memory' ? 'text-purple-400' : 'text-white/60'}`} />
                            <span className="font-bold">Server Memory</span>
                        </div>
                        <p className="text-xs text-left text-white/50">
                            Local JSON-based storage. Fast and simple. Best for personal use and standard workloads.
                        </p>
                    </button>

                    <button
                        onClick={() => handleBackendChange('memento-mcp')}
                        className={`flex flex-col items-start p-4 rounded-xl border transition-all ${
                            settings.memoryBackend === 'memento-mcp'
                                ? 'bg-purple-500/10 border-purple-500/50'
                                : 'bg-white/5 border-transparent hover:bg-white/10'
                        }`}
                    >
                        <div className="flex items-center gap-2 mb-2">
                            <HardDrive className={`w-5 h-5 ${settings.memoryBackend === 'memento-mcp' ? 'text-purple-400' : 'text-white/60'}`} />
                            <span className="font-bold">Memento MCP (Neo4j)</span>
                        </div>
                        <p className="text-xs text-left text-white/50">
                            Graph database storage. Scalable and relational. Best for massive context and complex queries.
                        </p>
                    </button>
                </div>
            </div>

            {/* Current Stats */}
            <div className="bg-[#1a1d23] border border-white/10 rounded-xl p-6">
                <div className="flex items-center justify-between mb-4">
                    <h4 className="font-medium flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></span>
                        Active Memory Stats
                    </h4>
                    <button 
                        onClick={loadStats}
                        disabled={loading}
                        className="p-2 hover:bg-white/5 rounded-lg transition-colors"
                    >
                        <RefreshCw className={`w-4 h-4 text-white/40 ${loading ? 'animate-spin' : ''}`} />
                    </button>
                </div>

                {stats ? (
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                        <div className="bg-black/20 p-3 rounded-lg">
                            <div className="text-xs text-white/40 mb-1">Total Entities</div>
                            <div className="text-xl font-mono text-purple-400">{stats.entityCount.toLocaleString()}</div>
                        </div>
                        <div className="bg-black/20 p-3 rounded-lg">
                            <div className="text-xs text-white/40 mb-1">Relations</div>
                            <div className="text-xl font-mono text-blue-400">{stats.relationCount.toLocaleString()}</div>
                        </div>
                        <div className="bg-black/20 p-3 rounded-lg">
                            <div className="text-xs text-white/40 mb-1">Storage Size</div>
                            <div className="text-xl font-mono text-yellow-400">{formatBytes(stats.storageSize)}</div>
                        </div>
                        <div className="bg-black/20 p-3 rounded-lg">
                            <div className="text-xs text-white/40 mb-1">Search Latency</div>
                            <div className="text-xl font-mono text-green-400">{stats.avgSearchLatency.toFixed(1)}ms</div>
                        </div>
                    </div>
                ) : (
                    <div className="text-center py-8 text-white/20">
                        {loading ? 'Loading statistics...' : 'Stats unavailable'}
                    </div>
                )}
            </div>

            {/* Migration Suggestion (Conditional) */}
            {(migrationStatus === 'success' || (stats && stats.entityCount > 10000 && settings.memoryBackend === 'server-memory')) && (
                <div className={`border rounded-xl p-4 flex items-start gap-4 ${
                    migrationStatus === 'success' 
                        ? 'bg-green-500/10 border-green-500/20' 
                        : 'bg-yellow-500/10 border-yellow-500/20'
                }`}>
                    <div className={`p-2 rounded-lg ${
                        migrationStatus === 'success' ? 'bg-green-500/20' : 'bg-yellow-500/20'
                    }`}>
                        {migrationStatus === 'success' ? (
                            <Check className="w-6 h-6 text-green-400" />
                        ) : (
                            <AlertCircle className="w-6 h-6 text-yellow-400" />
                        )}
                    </div>
                    <div className="flex-1">
                        <h4 className={`font-bold mb-1 ${
                            migrationStatus === 'success' ? 'text-green-400' : 'text-yellow-400'
                        }`}>
                            {migrationStatus === 'success' ? 'Migration Complete' : 'Scalability Warning'}
                        </h4>
                        <p className={`text-sm mb-3 ${
                            migrationStatus === 'success' ? 'text-green-200/80' : 'text-yellow-200/80'
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
                                className="px-4 py-2 bg-yellow-500/20 hover:bg-yellow-500/30 text-yellow-400 rounded-lg text-sm font-medium transition-colors flex items-center gap-2"
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
                    className="text-xs text-white/30 hover:text-white/80 underline"
                >
                    Test Write
                </button>
            </div>

            <MemoryInspector />
        </div>
    )
}
