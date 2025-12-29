import { dirname } from 'path'
import { fileURLToPath } from 'url'
import fixPath from 'fix-path'

/**
 * Handle ESM shims and environment fixing
 */
export function initEnv(): void {
    // Fix PATH for macOS/Linux GUI apps so they can find node/npx/python
    fixPath()
}

export const __filename = fileURLToPath(import.meta.url)
export const __dirname = dirname(__filename)
