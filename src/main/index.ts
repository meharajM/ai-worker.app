import { app, shell, BrowserWindow } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { initEnv, __dirname } from './utils/env'
import { setupIpcHandlers } from './ipc'


// Enable experimental on-device AI features (Gemini Nano / Chrome Prompt API)
// These flags attempt to enable the window.ai API in Electron's Chromium
app.commandLine.appendSwitch('enable-features',
    'PromptAPIForGeminiNano,' +
    'OptimizationGuideOnDeviceModel:bypass_perf_requirement/true,' +
    'LanguageDetectionAPI'
)
app.commandLine.appendSwitch('optimization-guide-on-device-model-execution', 'performance_class:0')

// Platform-specific WebGPU support
function setupWebGPUSupport() {
    const platform = process.platform
    
    // Enable WebGPU on all platforms
    app.commandLine.appendSwitch('enable-webgpu')
    
    switch (platform) {
        case 'linux':
            // Linux requires Vulkan for WebGPU
            app.commandLine.appendSwitch('enable-features', 'WebGPU,Vulkan')
            app.commandLine.appendSwitch('enable-vulkan')
            app.commandLine.appendSwitch('use-vulkan=native')
            console.log('[Main] WebGPU configured for Linux with Vulkan backend')
            break
            
        case 'win32':
            // Windows uses DirectX 12 for WebGPU
            app.commandLine.appendSwitch('enable-features', 'WebGPU')
            app.commandLine.appendSwitch('use-angle', 'd3d11') // Fallback to D3D11 if D3D12 not available
            console.log('[Main] WebGPU configured for Windows with DirectX backend')
            break
            
        case 'darwin':
            // macOS uses Metal for WebGPU
            app.commandLine.appendSwitch('enable-features', 'WebGPU')
            console.log('[Main] WebGPU configured for macOS with Metal backend')
            break
            
        default:
            console.warn(`[Main] Unknown platform ${platform}, using default WebGPU configuration`)
            app.commandLine.appendSwitch('enable-features', 'WebGPU')
    }
}

setupWebGPUSupport()


// Initialize environment (fix PATH, etc.)
initEnv()

function createWindow(): void {
    const mainWindow = new BrowserWindow({
        width: 1000,
        height: 700,
        minWidth: 800,
        minHeight: 600,
        show: false,
        autoHideMenuBar: true,
        titleBarStyle: 'hiddenInset',
        trafficLightPosition: { x: 15, y: 15 },
        backgroundColor: '#0f1115',
        webPreferences: {
            preload: join(__dirname, '../preload/index.mjs'),
            sandbox: false,
            contextIsolation: true,
            nodeIntegration: false,
            webSecurity: true,
        }
    })

    mainWindow.on('ready-to-show', () => {
        mainWindow.show()
        if (is.dev) {
            mainWindow.webContents.openDevTools()
        }
    })

    mainWindow.webContents.setWindowOpenHandler((details) => {
        shell.openExternal(details.url)
        return { action: 'deny' }
    })

    // Enable audio permissions for TTS/STT
    mainWindow.webContents.session.setPermissionRequestHandler((_webContents, permission, callback) => {
        const allowedPermissions = ['media', 'mediaKeySystem', 'geolocation', 'notifications', 'midi', 'midiSysex']
        if (allowedPermissions.includes(permission)) {
            callback(true)
        } else {
            callback(false)
        }
    })

    if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
        mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
    } else {
        mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
    }
}

app.whenReady().then(() => {
    electronApp.setAppUserModelId('com.aiworker.app')

    // Setup modular IPC handlers
    setupIpcHandlers()

    app.on('browser-window-created', (_, window) => {
        optimizer.watchWindowShortcuts(window)
    })

    createWindow()

    app.on('activate', function () {
        if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
})

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit()
    }
})

// Handle certificate errors for local development
app.on('certificate-error', (event, _webContents, _url, _error, _certificate, callback) => {
    if (is.dev) {
        event.preventDefault()
        callback(true)
    } else {
        callback(false)
    }
})
