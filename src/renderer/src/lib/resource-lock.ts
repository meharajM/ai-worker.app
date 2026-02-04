/**
 * Simple Mutex implementation to handle resource locking
 * Used to prevent race conditions when multiple agents try to use 
 * shared resources (Browser, FileSystem) simultaneously.
 */
export class Mutex {
    private queue: Array<(release: () => void) => void> = [];
    private locked = false;

    /**
     * Acquire the lock. Returns a release function.
     * If strictly serial execution is needed, wait for this promise.
     */
    async acquire(): Promise<() => void> {
        const release = () => {
            if (this.queue.length > 0) {
                const next = this.queue.shift();
                if (next) next(release);
            } else {
                this.locked = false;
            }
        };

        if (this.locked) {
            return new Promise<() => void>((resolve) => {
                this.queue.push(resolve);
            }).then(() => release);
        } else {
            this.locked = true;
            return release;
        }
    }

    /**
     * Run a task exclusively.
     * Waits for the lock, runs the task, then releases it.
     */
    async runExclusive<T>(task: () => Promise<T> | T): Promise<T> {
        const release = await this.acquire();
        try {
            return await task();
        } finally {
            release();
        }
    }
}

// Global locks for shared resources
export const browserLock = new Mutex(); // Global lock for single-context browser

/**
 * Keyed Mutex for granular locking (e.g. per file path)
 */
export class KeyedMutex {
    private locks = new Map<string, Mutex>();

    private getLock(key: string): Mutex {
        if (!this.locks.has(key)) {
            this.locks.set(key, new Mutex());
        }
        return this.locks.get(key)!;
    }

    async runExclusive<T>(key: string, task: () => Promise<T> | T): Promise<T> {
        return this.getLock(key).runExclusive(task);
    }
}

export const fileLock = new KeyedMutex(); // Granular lock per file path

