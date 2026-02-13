
import { STATEFUL_BROWSER_TOOLS, STATEFUL_FILE_TOOLS } from './client-tools';

// ── Timeout Configuration ──────────────────────────────────────────────────────
// Per-tool-type timeout limits (milliseconds)
export const LANE_TIMEOUTS = {
    DEFAULT: 60_000,              // 60s - general fallback
    BROWSER_NAVIGATION: 120_000,  // 120s - navigate, goto (network-dependent)
    BROWSER_ACTION: 30_000,       // 30s  - click, type, select, hover, etc.
    BROWSER_SNAPSHOT: 15_000,     // 15s  - screenshot, snapshot (fast)
    FILE_SYSTEM: 30_000,          // 30s  - file read/write
} as const;

/**
 * Thrown when a lane task exceeds its allowed execution time.
 * Distinguished from generic errors so self-healing can handle it appropriately.
 */
export class LaneTimeoutError extends Error {
    public readonly timeoutMs: number;
    public readonly laneId: string;

    constructor(laneId: string, timeoutMs: number) {
        super(`Lane timeout: operation in lane "${laneId}" exceeded ${timeoutMs}ms`);
        this.name = 'LaneTimeoutError';
        this.timeoutMs = timeoutMs;
        this.laneId = laneId;
    }
}

/**
 * Thrown when an operation is cancelled via an AbortSignal.
 */
export class LaneAbortError extends Error {
    constructor(laneId: string) {
        super(`Aborted: operation in lane "${laneId}" was cancelled`);
        this.name = 'LaneAbortError';
    }
}

/**
 * A queue that enforces concurrency limits.
 * OpenClaw-style execution lane.
 */
export class LaneQueue {
    private queue: Array<() => Promise<void>> = [];
    private activeCount = 0;
    private concurrency: number;
    public readonly id: string;

    constructor(id: string, concurrency: number) {
        this.id = id;
        this.concurrency = concurrency;
    }

    /**
     * Execute a task in this lane.
     * If concurrency limit is reached, it waits in queue.
     *
     * @param task      The async work to execute.
     * @param timeoutMs Optional timeout in milliseconds.
     * @param signal    Optional AbortSignal.
     */
    async run<T>(task: () => Promise<T>, timeoutMs?: number, signal?: AbortSignal): Promise<T> {
        // Fast path: already aborted before we even start
        if (signal?.aborted) {
            throw new LaneAbortError(this.id);
        }

        return new Promise<T>((resolve, reject) => {
            const wrappedTask = async () => {
                this.activeCount++;
                try {
                    let result: T;

                    if (timeoutMs !== undefined && timeoutMs > 0) {
                        // Race the real task against a timeout promise
                        let timer: ReturnType<typeof setTimeout> | undefined;

                        const timeoutPromise = new Promise<never>((_resolve, _reject) => {
                            timer = setTimeout(() => {
                                _reject(new LaneTimeoutError(this.id, timeoutMs));
                            }, timeoutMs);
                        });

                        try {
                            result = await Promise.race([task(), timeoutPromise]);
                        } finally {
                            // Always clear the timer to avoid leaks
                            if (timer !== undefined) clearTimeout(timer);
                        }
                    } else {
                        result = await task();
                    }

                    resolve(result);
                } catch (error) {
                    reject(error);
                } finally {
                    this.activeCount--;
                    this.processNext();
                }
            };

            if (this.activeCount < this.concurrency) {
                wrappedTask();
            } else {
                this.queue.push(wrappedTask);

                // If signal fires while we're waiting in queue, dequeue and reject
                if (signal) {
                    const onAbort = () => {
                        const idx = this.queue.indexOf(wrappedTask);
                        if (idx !== -1) {
                            this.queue.splice(idx, 1);
                            reject(new LaneAbortError(this.id));
                        }
                    };
                    signal.addEventListener('abort', onAbort, { once: true });
                }
            }
        });
    }

    private processNext() {
        if (this.queue.length > 0 && this.activeCount < this.concurrency) {
            const nextTask = this.queue.shift();
            nextTask?.();
        }
    }

    get stats() {
        return {
            active: this.activeCount,
            queued: this.queue.length,
            concurrency: this.concurrency
        };
    }
}

/**
 * Manages all execution lanes for the agent system.
 * Routes tools to the correct lane based on type and context.
 */
export class LaneManager {
    private lanes = new Map<string, LaneQueue>();

    // Standard Lanes
    private globalBrowserLane: LaneQueue;
    // private apiParallelLane: LaneQueue; // COMMENTED OUT - not using API parallel lane
    private fileSystemLane: LaneQueue; // Granular locking handled inside? Or just serial?
    // Current design: FS tools use a granular lock in the old code. 
    // Here we can make a high-concurrency lane, but we might need KeyedMutex if we want true file-level locking.
    // For now, let's stick to the Plan: Serial Browser, Parallel API.

    constructor() {
        // Browser: Serial (1 at a time) to prevent race conditions on the active page
        this.globalBrowserLane = new LaneQueue('BROWSER_SERIAL', 1);

        // API/Thinking: Parallel (High concurrency)
        // COMMENTED OUT: Not using API parallel lane for now - everything goes through browser serial
        // this.apiParallelLane = new LaneQueue('API_PARALLEL', 10);

        // FileSystem: For now, we'll allow parallel file ops (OS handles locking mostly, or we assume different files)
        // If we need strict file locking, we'd add it here.
        this.fileSystemLane = new LaneQueue('FILESYSTEM', 5);

        this.lanes.set(this.globalBrowserLane.id, this.globalBrowserLane);
        // this.lanes.set(this.apiParallelLane.id, this.apiParallelLane); // COMMENTED OUT
        this.lanes.set(this.fileSystemLane.id, this.fileSystemLane);
    }

    /**
     * Get or create a dedicated lane for a specific browser tab.
     */
    private getTabLane(tabId: number): LaneQueue {
        const laneId = `TAB_${tabId}`;
        if (!this.lanes.has(laneId)) {
            // Tab lanes are Serial (1 op per tab)
            const lane = new LaneQueue(laneId, 1);
            this.lanes.set(laneId, lane);
        }
        return this.lanes.get(laneId)!;
    }

    /**
     * Routes a tool call to the appropriate execution lane.
     */
    getLane(toolName: string, context: { tabId?: number } = {}): LaneQueue {
        // 1. Browser Tools (including MCP Playwright tools)
        const isBrowserTool = STATEFUL_BROWSER_TOOLS.includes(toolName) ||
            toolName.startsWith('playwright_') ||
            toolName.startsWith('browser_');

        if (isBrowserTool) {
            // If a specific tab is requested, use its dedicated lane
            if (context.tabId !== undefined) {
                return this.getTabLane(context.tabId);
            }
            // Otherwise, use the global main window lane
            return this.globalBrowserLane;
        }

        // 2. File Tools
        if (STATEFUL_FILE_TOOLS.includes(toolName)) {
            return this.fileSystemLane;
        }

        // 3. Stateless/API Tools (Memory, Search, etc.)
        // COMMENTED OUT: Forcing all non-browser/file tools to use browser lane for now
        // return this.apiParallelLane;

        // TEMPORARY: Route everything to browser serial to prevent race conditions
        return this.globalBrowserLane;
    }

    // Debugging helper
    getDebugStats() {
        const stats: Record<string, any> = {};
        for (const [id, lane] of this.lanes.entries()) {
            stats[id] = lane.stats;
        }
        return stats;
    }

    /**
     * Returns the appropriate timeout (ms) for a given tool name.
     * Navigation-style tools get a longer window; fast browser actions get a
     * shorter one; file tools get their own bucket; everything else uses the
     * default.
     */
    getTimeoutForTool(toolName: string): number {
        // Navigation tools – network-dependent, need more time
        const NAVIGATION_TOOLS = ['navigate', 'browser_navigate', 'playwright_navigate', 'goto'];
        if (NAVIGATION_TOOLS.some(n => toolName.includes(n))) {
            return LANE_TIMEOUTS.BROWSER_NAVIGATION;
        }

        // Snapshot / screenshot – should be fast
        const SNAPSHOT_TOOLS = ['screenshot', 'browser_screenshot', 'browser_snapshot', 'snapshot'];
        if (SNAPSHOT_TOOLS.some(n => toolName.includes(n))) {
            return LANE_TIMEOUTS.BROWSER_SNAPSHOT;
        }

        // Other browser actions (click, type, hover, select, etc.)
        const isBrowserTool = STATEFUL_BROWSER_TOOLS.includes(toolName) ||
            toolName.startsWith('playwright_') ||
            toolName.startsWith('browser_');
        if (isBrowserTool) {
            return LANE_TIMEOUTS.BROWSER_ACTION;
        }

        // File system tools
        if (STATEFUL_FILE_TOOLS.includes(toolName)) {
            return LANE_TIMEOUTS.FILE_SYSTEM;
        }

        return LANE_TIMEOUTS.DEFAULT;
    }
}

// Singleton instance
export const laneManager = new LaneManager();
