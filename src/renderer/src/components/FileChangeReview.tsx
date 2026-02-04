import React, { useEffect, useState } from 'react'
import { FileText, Check, X, AlertTriangle, RefreshCw } from 'lucide-react'

interface FileChange {
    id: string
    originalPath: string
    shadowPath: string
    type: 'create' | 'modify' | 'delete'
    content?: string
    timestamp: number
}

export const FileChangeReview: React.FC = () => {
    const [changes, setChanges] = useState<FileChange[]>([])
    const [isLoading, setIsLoading] = useState(false)

    const fetchChanges = async () => {
        setIsLoading(true)
        try {
            const pending = await window?.electron?.fs.getPendingChanges()
            if(pending)setChanges(pending)
        } catch (error) {
            console.error('Failed to fetch changes:', error)
        } finally {
            setIsLoading(false)
        }
    }

    useEffect(() => {
        fetchChanges()
        // Poll for changes every 2 seconds
        const interval = setInterval(fetchChanges, 2000)
        return () => clearInterval(interval)
    }, [])

    const handleApprove = async (id: string) => {
        try {
            await window?.electron?.fs.approveChange(id)
            setChanges(prev => prev.filter(c => c.id !== id))
        } catch (error) {
            console.error('Failed to approve change:', error)
        }
    }

    const handleReject = async (id: string) => {
        try {
            await window?.electron?.fs.rejectChange(id)
            setChanges(prev => prev.filter(c => c.id !== id))
        } catch (error) {
            console.error('Failed to reject change:', error)
        }
    }

    if (changes.length === 0) return null

    return (
        <div className="fixed bottom-4 right-4 z-50 w-96 flex flex-col gap-2">
            <div className="bg-card border border-border shadow-lg rounded-lg overflow-hidden flex flex-col max-h-[80vh]">
                <div className="bg-primary/10 p-3 border-b border-border flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <AlertTriangle className="w-4 h-4 text-warning" />
                        <h3 className="font-semibold text-sm">Review File Changes ({changes.length})</h3>
                    </div>
                    <button onClick={fetchChanges} className="p-1 hover:bg-background rounded-full" disabled={isLoading}>
                        <RefreshCw className={`w-3 h-3 ${isLoading ? 'animate-spin' : ''}`} />
                    </button>
                </div>

                <div className="overflow-y-auto p-2 space-y-2">
                    {changes.map(change => (
                        <div key={change.id} className="bg-background border border-border rounded p-3 text-xs shadow-sm">
                            <div className="flex items-start gap-2">
                                <FileText className="w-4 h-4 text-muted-foreground mt-0.5" />
                                <div className="flex-1 min-w-0">
                                    <div className="font-medium truncate" title={change.originalPath}>
                                        {change.originalPath.split('/').pop()}
                                    </div>
                                    <div className="text-muted-foreground truncate text-[10px]">
                                        {change.originalPath}
                                    </div>
                                    <div className="mt-1 flex items-center gap-2">
                                        <span className={`px-1.5 py-0.5 rounded text-[10px] uppercase font-bold
                                            ${change.type === 'create' ? 'bg-green-500/20 text-green-500' : 
                                              change.type === 'delete' ? 'bg-red-500/20 text-red-500' : 
                                              'bg-yellow-500/20 text-yellow-500'}`}>
                                            {change.type}
                                        </span>
                                        <span className="text-muted-foreground text-[10px]">
                                            {new Date(change.timestamp).toLocaleTimeString()}
                                        </span>
                                    </div>
                                </div>
                            </div>

                            {change.content && (
                                <div className="mt-2 bg-muted/50 p-2 rounded overflow-hidden max-h-24 font-mono text-[10px] whitespace-pre-wrap break-all">
                                    {change.content.substring(0, 200)}
                                    {change.content.length > 200 && '...'}
                                </div>
                            )}

                            <div className="mt-3 flex gap-2">
                                <button 
                                    onClick={() => handleApprove(change.id)}
                                    className="flex-1 bg-green-600 hover:bg-green-700 text-white py-1.5 rounded flex items-center justify-center gap-1 transition-colors"
                                >
                                    <Check className="w-3 h-3" /> Approve
                                </button>
                                <button 
                                    onClick={() => handleReject(change.id)}
                                    className="flex-1 bg-red-600 hover:bg-red-700 text-white py-1.5 rounded flex items-center justify-center gap-1 transition-colors"
                                >
                                    <X className="w-3 h-3" /> Reject
                                </button>
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    )
}
