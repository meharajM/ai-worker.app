import { app, shell, BrowserWindow } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { initEnv, __dirname } from './utils/env'
import { setupIpcHandlers } from './ipc'

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
