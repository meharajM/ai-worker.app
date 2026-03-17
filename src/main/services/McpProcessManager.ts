import { ChildProcess } from 'child_process'
import treeKill from 'tree-kill'

export class McpProcessManager {
    private static instance: McpProcessManager
    private activeProcesses = new Map<string, ChildProcess>()

    private constructor() {}

    public static getInstance(): McpProcessManager {
        if (!McpProcessManager.instance) {
            McpProcessManager.instance = new McpProcessManager()
        }
        return McpProcessManager.instance
    }

    /**
     * Track a newly spawned process for later cleanup
     */
    public registerProcess(id: string, process: ChildProcess): void {
        this.activeProcesses.set(id, process)
        
        process.on('exit', () => {
            this.activeProcesses.delete(id)
        })
        
        process.on('error', () => {
            this.activeProcesses.delete(id)
        })
    }

    /**
     * Stop tracking a process (e.g. if it was manually disconnected)
     */
    public unregisterProcess(id: string): void {
        this.activeProcesses.delete(id)
    }

    /**
     * Forcefully terminate all tracked MCP processes and their descendants
     */
    public async teardownAll(): Promise<void> {
        const killPromises: Promise<void>[] = []
        
        for (const process of this.activeProcesses.values()) {
            if (process.pid) {
                const pid = process.pid
                killPromises.push(new Promise<void>((resolve) => {
                    treeKill(pid, 'SIGKILL', () => resolve())
                }))
            }
        }

        // Wait up to 3 seconds for all processes to be killed
        await Promise.race([
            Promise.all(killPromises),
            new Promise((resolve) => setTimeout(resolve, 3000))
        ])
        
        this.activeProcesses.clear()
    }
}
