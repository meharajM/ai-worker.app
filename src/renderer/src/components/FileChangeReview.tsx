import React, { useEffect, useState } from 'react'
import { FileText, Check, X, AlertTriangle, RefreshCw } from 'lucide-react'

interface FileChange {
    id: string
    originalPath: string
    shadowPath: string
    type: 'create' | 'modify' | 'delete'
    content?: string
    timestamp: number
    approvalChannel?: 'desktop' | 'whatsapp'
    approvalToken?: string
    status?: 'pending' | 'approved' | 'rejected' | 'expired'
    createdAt?: number
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
            const result = await window?.electron?.fs.approveChange(id)
            if (result?.success) {
                setChanges(prev => prev.filter(c => c.id !== id))
            } else if (result?.error) {
                console.error('Failed to approve change:', result.error)
            }
        } catch (error) {
            console.error('Failed to approve change:', error)
        }
    }

    const handleReject = async (id: string) => {
        try {
            const result = await window?.electron?.fs.rejectChange(id)
            if (result?.success) {
                setChanges(prev => prev.filter(c => c.id !== id))
            } else if (result?.error) {
                console.error('Failed to reject change:', result.error)
            }
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
                                <div className="mt-2 bg-muted/50 p-2 rounded overflow-hidden max-h-24 font-mono text-[10px] whitespace-pre-wrap break-all relative group">
                                    <div className="absolute top-0 right-0 p-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                        <button onClick={() => {
                                            if (change.content) navigator.clipboard.writeText(change.content);
                                        }} className="p-1 bg-background border border-border rounded text-[8px] hover:bg-muted">Copy</button>
                                    </div>
                                    {change.content.substring(0, 200)}
                                    {change.content.length > 200 && '...'}
                                </div>
                            )}

                            {change.approvalChannel === 'whatsapp' && change.status === 'pending' && (
                                <div className="mt-2 p-2 bg-blue-500/10 border border-blue-500/20 rounded-md flex flex-col gap-1 items-center justify-center">
                                    <div className="flex items-center gap-1.5 text-blue-500 font-semibold text-[10px]">
                                        <RefreshCw className="w-3 h-3 animate-spin-slow" />
                                        Remote Approval Active (WhatsApp)
                                    </div>
                                    <div className="flex flex-col items-center">
                                        <span className="text-[9px] text-muted-foreground">Verification Token:</span>
                                        <span className="text-sm font-black tracking-widest text-blue-600 bg-white px-2 py-0.5 rounded border border-blue-200">
                                            {change.approvalToken}
                                        </span>
                                    </div>
                                    <p className="text-[9px] text-center text-muted-foreground italic">
                                        Approvals on WhatsApp have priority. UI buttons will unlock in 5 minutes if no response is received.
                                    </p>
                                </div>
                            )}

                            {change.status === 'expired' && (
                                <div className="mt-2 p-2 bg-amber-500/10 border border-amber-500/20 rounded-md">
                                    <p className="text-[10px] text-amber-700 text-center">
                                        WhatsApp approval expired or disconnected. You can approve/reject from desktop now.
                                    </p>
                                </div>
                            )}

                            <div className="mt-3 flex gap-2">
                                <button 
                                    onClick={() => handleApprove(change.id)}
                                    disabled={change.approvalChannel === 'whatsapp' && change.status === 'pending'}
                                    className={`flex-1 ${change.approvalChannel === 'whatsapp' && change.status === 'pending' ? 'bg-muted text-muted-foreground' : 'bg-green-600 hover:bg-green-700 text-white'} py-1.5 rounded flex items-center justify-center gap-1 transition-colors`}
                                >
                                    <Check className="w-3 h-3" /> Approve
                                </button>
                                <button 
                                    onClick={() => handleReject(change.id)}
                                    disabled={change.approvalChannel === 'whatsapp' && change.status === 'pending'}
                                    className={`flex-1 ${change.approvalChannel === 'whatsapp' && change.status === 'pending' ? 'bg-muted text-muted-foreground' : 'bg-red-600 hover:bg-red-700 text-white'} py-1.5 rounded flex items-center justify-center gap-1 transition-colors`}
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
