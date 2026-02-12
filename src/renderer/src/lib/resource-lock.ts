
import { laneManager, LANE_TIMEOUTS } from './execution-lanes';

/**
 * SHIM: Redirects old lock calls to the new LaneManager.
 * Preserves the API for compatibility.
 */

export class Mutex {
    async runExclusive<T>(task: () => Promise<T> | T): Promise<T> {
        // Default to global browser lane for unidentified locks
        return laneManager.getLane('navigate').run(async () => await task(), LANE_TIMEOUTS.BROWSER_NAVIGATION);
    }

    // Legacy support - no-op or auto-release
    async acquire(): Promise<() => void> {
        return () => { };
    }
}

export const browserLock = {
    runExclusive: <T>(task: () => Promise<T> | T) => {
        return laneManager.getLane('navigate').run(async () => await task(), LANE_TIMEOUTS.BROWSER_NAVIGATION);
    }
};

export class KeyedMutex {
    async runExclusive<T>(key: string, task: () => Promise<T> | T): Promise<T> {
        // Redirect all file keys to the single FILESYSTEM lane
        return laneManager.getLane('file_read').run(async () => await task(), LANE_TIMEOUTS.FILE_SYSTEM);
    }
}

export const fileLock = new KeyedMutex();
