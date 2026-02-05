import { BrowserWindow } from 'electron'
import type { UnifiedMemoryBackend, ExportData } from './UnifiedMemoryBackend'
import type { MetricsCollector } from './MetricsCollector'
import { MemoryServiceFactory } from './MemoryServiceFactory'

/**
 * MigrationService - Handle Backend Migration
 * 
 * Manages migration from server-memory to memento-mcp when scaling is needed.
 * 
 * Features:
 * - Automatic migration suggestions based on metrics
 * - One-click migration process
 * - Data export/import handling
 * - Configuration updates
 * - User notifications via IPC
 * 
 * Migration Flow:
 * 1. Check metrics against thresholds
 * 2. Show notification to user
 * 3. User approves migration
 * 4. Export data from current backend
 * 5. Verify new backend availability (Neo4j)
 * 6. Import data to new backend
 * 7. Update configuration
 * 8. Restart with new backend
 * 
 * Usage:
 *   const migration = new MigrationService()
 *   await migration.checkAndNotify(metricsCollector)
 *   
 *   // Later, when user approves:
 *   const result = await migration.migrateToMemento(currentBackend)
 */
export class MigrationService {
  private notificationShown = false
  private migrationInProgress = false

  /**
   * Check metrics and show migration suggestion if needed
   * 
   * @param metrics - MetricsCollector instance to check
   */
  async checkAndNotify(metrics: MetricsCollector): Promise<void> {
    // Don't spam notifications
    if (this.notificationShown || this.migrationInProgress) {
      return
    }

    if (await metrics.shouldSuggestMigration()) {
      const reasons = await metrics.getMigrationReasons()
      const stats = await metrics.getStats()
      
      await this.showMigrationSuggestion({
        reasons,
        currentStats: stats
      })
      
      this.notificationShown = true
    }
  }

  /**
   * Show migration suggestion notification to user
   * 
   * @param data - Notification data with reasons and stats
   */
  private async showMigrationSuggestion(data: {
    reasons: string[]
    currentStats: any
  }): Promise<void> {
    const win = BrowserWindow.getFocusedWindow()
    
    if (!win) {
      console.warn('No focused window for migration notification')
      return
    }

    win.webContents.send('memory:suggest-migration', {
      title: 'Upgrade Memory Backend?',
      message: 'Your memory system has grown significantly. Consider upgrading to Memento-MCP for better performance.',
      reasons: data.reasons,
      currentStats: {
        entities: data.currentStats.entityCount.toLocaleString(),
        avgLatency: `${Math.round(data.currentStats.avgSearchLatency)}ms`,
        storageSize: `${(data.currentStats.storageSize / (1024 * 1024)).toFixed(2)}MB`,
        backend: data.currentStats.backend
      },
      recommendation: 'Memento-MCP with Neo4j',
      benefits: [
        'Semantic search with embeddings',
        'Graph queries (find related entities)',
        'Better performance at scale (100K+ entities)',
        'Advanced relationship traversal'
      ]
    })
  }

  /**
   * Migrate from server-memory to memento-mcp
   * 
   * @param currentBackend - Current memory backend to export from
   * @returns Migration result with success status and message
   */
  async migrateToMemento(currentBackend: UnifiedMemoryBackend): Promise<{
    success: boolean
    message: string
    error?: string
  }> {
    if (this.migrationInProgress) {
      return {
        success: false,
        message: 'Migration already in progress',
        error: 'MIGRATION_IN_PROGRESS'
      }
    }

    this.migrationInProgress = true

    try {
      // Step 1: Export from current backend
      console.log('[Migration] Step 1/5: Exporting data from server-memory...')
      const data = await currentBackend.exportAll()
      
      console.log(`[Migration] Exported ${data.entities.length} entities and ${data.relations.length} relations`)

      // Step 2: Verify export
      if (data.entities.length === 0) {
        throw new Error('No data to migrate')
      }

      // Step 3: Check Neo4j availability
      console.log('[Migration] Step 2/5: Checking Neo4j availability...')
      const neo4jAvailable = await this.checkNeo4jAvailability()
      
      if (!neo4jAvailable) {
        throw new Error(
          'Neo4j is not available. Please ensure Neo4j is running:\n' +
          'docker run -p 7687:7687 -p 7474:7474 -e NEO4J_AUTH=neo4j/password neo4j:latest'
        )
      }

      // Step 4: Create new backend and import
      console.log('[Migration] Step 3/5: Initializing Memento-MCP backend...')
      const config = MemoryServiceFactory.loadConfig()
      
      if (!config.memento) {
        throw new Error('Memento-MCP configuration missing. Please configure Neo4j settings first.')
      }

      const newBackend = MemoryServiceFactory.create({
        backend: 'memento-mcp',
        memento: config.memento
      })

      await newBackend.initialize()

      console.log('[Migration] Step 4/5: Importing data to Memento-MCP...')
      await newBackend.importAll(data)

      // Step 5: Update configuration
      console.log('[Migration] Step 5/5: Updating configuration...')
      await MemoryServiceFactory.switchBackend('memento-mcp')

      // Step 6: Notify success
      this.notifyMigrationComplete({
        entitiesMigrated: data.entities.length,
        relationsMigrated: data.relations.length
      })

      this.migrationInProgress = false

      return {
        success: true,
        message: `Successfully migrated ${data.entities.length} entities and ${data.relations.length} relations to Memento-MCP`
      }
    } catch (error: any) {
      this.migrationInProgress = false
      
      console.error('[Migration] Failed:', error)
      
      this.notifyMigrationFailed(error.message)

      return {
        success: false,
        message: 'Migration failed',
        error: error.message
      }
    }
  }

  /**
   * Rollback to server-memory
   * 
   * @param backup - Backup data to restore
   */
  async rollbackToServerMemory(backup: ExportData): Promise<{
    success: boolean
    message: string
  }> {
    try {
      console.log('[Migration] Rolling back to server-memory...')
      
      // Switch config back
      await MemoryServiceFactory.switchBackend('server-memory')
      
      // Create server-memory backend
      const backend = MemoryServiceFactory.create()
      await backend.initialize()
      
      // Import backup
      await backend.importAll(backup)
      
      return {
        success: true,
        message: 'Successfully rolled back to server-memory'
      }
    } catch (error: any) {
      return {
        success: false,
        message: `Rollback failed: ${error.message}`
      }
    }
  }

  /**
   * Check if Neo4j is available
   * 
   * @returns true if Neo4j is accessible
   */
  private async checkNeo4jAvailability(): Promise<boolean> {
    try {
      const config = MemoryServiceFactory.loadConfig()
      
      if (!config.memento) {
        return false
      }

      // Try to connect to Neo4j
      // This is a simplified check - in production, use actual Neo4j driver
      const url = config.memento.neo4jUri.replace('bolt://', 'http://').replace(':7687', ':7474')
      
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Accept': 'application/json'
        }
      })

      return response.ok
    } catch (error) {
      console.error('[Migration] Neo4j check failed:', error)
      return false
    }
  }

  /**
   * Notify user of migration completion
   */
  private notifyMigrationComplete(data: {
    entitiesMigrated: number
    relationsMigrated: number
  }): void {
    const win = BrowserWindow.getFocusedWindow()
    
    if (!win) return

    win.webContents.send('memory:migration-complete', {
      title: 'Migration Complete!',
      message: 'Your memory has been successfully upgraded to Memento-MCP',
      stats: {
        entities: data.entitiesMigrated.toLocaleString(),
        relations: data.relationsMigrated.toLocaleString()
      },
      nextSteps: [
        'Restart the application to use the new backend',
        'Enjoy faster searches and semantic queries',
        'Explore graph relationships in your data'
      ]
    })
  }

  /**
   * Notify user of migration failure
   */
  private notifyMigrationFailed(error: string): void {
    const win = BrowserWindow.getFocusedWindow()
    
    if (!win) return

    win.webContents.send('memory:migration-failed', {
      title: 'Migration Failed',
      message: 'Could not complete migration to Memento-MCP',
      error,
      suggestions: [
        'Ensure Neo4j is running',
        'Check configuration settings',
        'Try again or contact support'
      ]
    })
  }

  /**
   * Reset notification state (for testing)
   */
  resetNotificationState(): void {
    this.notificationShown = false
  }

  /**
   * Check if migration is in progress
   */
  isInProgress(): boolean {
    return this.migrationInProgress
  }
}
