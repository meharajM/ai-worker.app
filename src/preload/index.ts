import { contextBridge } from 'electron'

// Custom APIs for renderer
const api = {
    // Add IPC methods here
}

if (process.contextIsolated) {
    try {
        contextBridge.exposeInMainWorld('api', api)
    } catch (error) {
        console.error(error)
    }
} else {
    // @ts-ignore (define in d.ts)
    window.api = api
}
