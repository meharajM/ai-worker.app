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
