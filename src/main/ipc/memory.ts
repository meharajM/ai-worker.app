import { ipcMain } from 'electron'
import { MemoryService } from '../services/MemoryService'

/**
 * Memory IPC Handlers
 * 
 * Provides IPC endpoints for memory statistics, backend management,
 * and migration features from the renderer process.
 */
export function registerMemoryHandlers(): void {
  // Get memory statistics
  ipcMain.handle('memory:get-stats', async () => {
    try {
      const memoryService = MemoryService.getInstance()
      const stats = await memoryService.getStats()
      return { success: true, stats }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error)
      }
    }
  })

  // Export all memory data
  ipcMain.handle('memory:export-all', async () => {
    try {
      const memoryService = MemoryService.getInstance()
      const data = await memoryService.exportAll()
      return { success: true, data }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error)
      }
    }
  })

  // Execute memory tool call
  ipcMain.handle('memory:call-tool', async (_event, { name, args }) => {
    try {
      const memoryService = MemoryService.getInstance()
      return await memoryService.callTool(name, args)
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error)
      }
    }
  })

  // Trigger migration
  ipcMain.handle('memory:migrate', async () => {
    try {
        const memoryService = MemoryService.getInstance()
        const result = await memoryService.migrateToMemento()
        return { success: true, result }
    } catch (error) {
        return {
            success: false,
            error: error instanceof Error ? error.message : String(error)
        }
    }
  })

  // Check migration status
  ipcMain.handle('memory:check-migration', async () => {
    try {
        const memoryService = MemoryService.getInstance()
        const shouldMigrate = await memoryService.shouldSuggestMigration()
        return { success: true, shouldMigrate }
    } catch (error) {
        return {
            success: false,
            error: error instanceof Error ? error.message : String(error)
        }
    }
  })

  // Open memory file location
  ipcMain.handle('memory:open-file-location', async () => {
      try {
          const { shell, app } = require('electron')
          const path = require('path')
          const fs = require('fs')

          // Construct default path (matching MemoryServiceFactory default)
          const memoryDir = path.join(app.getPath('userData'), 'memory')
          const memoryPath = path.join(memoryDir, 'memory.json')
          
          // Ensure directory exists
          if (!fs.existsSync(memoryDir)) {
              fs.mkdirSync(memoryDir, { recursive: true })
          }

          // Check if file exists, if not open folder
          if (fs.existsSync(memoryPath)) {
              shell.showItemInFolder(memoryPath)
          } else {
              shell.openPath(memoryDir)
          }
          return { success: true }
      } catch (error) {
          return { 
              success: false, 
              error: error instanceof Error ? error.message : String(error) 
          }
      }
  })

  // TEMP: Run verification tests
  ipcMain.handle('memory:run-tests', async () => {
    try {
      const { MemoryTestRunner } = await import('../tests/MemoryTestRunner')
      const runner = new MemoryTestRunner()
      const result = await runner.runTests()
      return { success: true, result }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error)
      }
    }
  })

  console.log('[IPC] Memory handlers registered')
}
