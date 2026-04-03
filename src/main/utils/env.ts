import { dirname } from "path";
import { fileURLToPath } from "url";
import fixPathRaw from "fix-path";

// ESM/CJS interop: fix-path is ESM-only, bundler may wrap it
// @ts-expect-error - fixPathRaw has a default property at runtime in CJS
const fixPath = (fixPathRaw.default || fixPathRaw) as typeof fixPathRaw;

/**
 * Handle ESM shims and environment fixing
 */
export function initEnv(): void {
  // Fix PATH for macOS/Linux GUI apps so they can find node/npx/python
  fixPath();
}

export const __filename = fileURLToPath(import.meta.url);
export const __dirname = dirname(__filename);
