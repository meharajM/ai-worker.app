import StoreRaw from 'electron-store';

/**
 * Handle ESM/CommonJS interop for electron-store.
 * Since electron-store v11+ is a pure ES Module, it returns an object 
 * containing the class under the 'default' key when required in CommonJS.
 */
// @ts-ignore - StoreRaw has a default property at runtime in CJS
export const Store = (StoreRaw.default || StoreRaw) as typeof StoreRaw;
