import { app, shell, BrowserWindow } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { initEnv, __dirname } from './utils/env'
import { setupIpcHandlers } from './ipc'
import { McpProcessManager } from './services/McpProcessManager'


// Enable experimental on-device AI features (Gemini Nano / Chrome Prompt API)
// These flags attempt to enable the window.ai API in Electron's Chromium
app.commandLine.appendSwitch('enable-features',
    'PromptAPIForGeminiNano,' +
    'OptimizationGuideOnDeviceModel:bypass_perf_requirement/true,' +
    'LanguageDetectionAPI,' +
    'ExperimentalWebPlatformFeatures'  // Enables modern web APIs
)
app.commandLine.appendSwitch('optimization-guide-on-device-model-execution', 'performance_class:0')

// Enable Web Speech API in Electron
// These flags ensure speech recognition works properly
app.commandLine.appendSwitch('enable-speech-dispatcher')  // Linux speech support
app.commandLine.appendSwitch('enable-speech-input')       // Enable speech input
app.commandLine.appendSwitch('enable-experimental-web-platform-features')  // Web Speech API
app.commandLine.appendSwitch('allow-file-access-from-files') // Allow fetch from file:// in Workers


// Initialize environment (fix PATH, etc.)
initEnv()

// Force ws to use pure-JS fallbacks in packaged builds.
// In some bundled production paths, optional native peer deps (bufferutil /
// utf-8-validate) can resolve to interop stubs and crash at runtime
// ("bufferUtil$1.mask is not a function"). Disabling native fast-paths keeps
// connection logic stable across dev + installed universal builds.
process.env.WS_NO_BUFFER_UTIL = '1'
process.env.WS_NO_UTF_8_VALIDATE = '1'

// PRODUCTION: Inject Google API Keys if available
// These are required for Web Speech API to work in built/packaged apps
// You must provide them via environment variables
if (process.env.GOOGLE_API_KEY) {
    process.env.GOOGLE_API_KEY = process.env.GOOGLE_API_KEY
}
if (process.env.GOOGLE_DEFAULT_CLIENT_ID) {
    process.env.GOOGLE_DEFAULT_CLIENT_ID = process.env.GOOGLE_DEFAULT_CLIENT_ID
}
if (process.env.GOOGLE_DEFAULT_CLIENT_SECRET) {
    process.env.GOOGLE_DEFAULT_CLIENT_SECRET = process.env.GOOGLE_DEFAULT_CLIENT_SECRET
}

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
            preload: join(__dirname, '../preload/index.js'),
            sandbox: false,
            contextIsolation: true,
            nodeIntegration: false,
            webSecurity: false, // Required for Vosk Worker to fetch local model files (file://)
        }
    })

    mainWindow.on('ready-to-show', () => {
        mainWindow.show()
        if (is.dev) {
            mainWindow.webContents.openDevTools()
        }
    })

    mainWindow.webContents.setWindowOpenHandler((details) => {
        const url = details.url

        // Allow Firebase/Google OAuth popups to open in new window
        if (url.includes('accounts.google.com') ||
            url.includes('.firebaseapp.com') ||
            url.includes('googleapis.com')) {
            return {
                action: 'allow',
                overrideBrowserWindowOptions: {
                    width: 500,
                    height: 600,
                    autoHideMenuBar: true,
                    webPreferences: {
                        nodeIntegration: false,
                        contextIsolation: true,
                    }
                }
            }
        }

        // Open other external links in system browser
        shell.openExternal(url)
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

app.whenReady().then(async () => {
    electronApp.setAppUserModelId('com.aiworker.app')

    // Verify environment and paths
    setupIpcHandlers()

    // Workers cannot fetch file:// URLs easily. We serve the model over HTTP locally.
    // Check for production env explicitly to ensure it runs during e2e tests
    // (Server code removed due to hang - reverting to file access attempt)

    app.on('browser-window-created', (_, window) => {
        optimizer.watchWindowShortcuts(window)
    })

    createWindow()

    app.on('activate', function () {
        if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
})

let isQuitting = false
app.on('before-quit', async (event) => {
    if (isQuitting) return
    
    // Prevent default quit, cleanup, then quit
    event.preventDefault()
    isQuitting = true
    
    await McpProcessManager.getInstance().teardownAll()
    
    app.quit()
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
