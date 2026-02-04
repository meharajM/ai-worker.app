import { app } from 'electron'
import Store from 'electron-store'
import { UnifiedMemoryBackend } from './UnifiedMemoryBackend'
import { ServerMemoryAdapter } from './adapters/ServerMemoryAdapter'
import { MementoMCPAdapter } from './adapters/MementoMCPAdapter'

/**
 * Memory Configuration
 */
export interface MemoryConfig {
  backend: 'server-memory' | 'memento-mcp'
  
  serverMemory?: {
    storagePath: string
  }
  
  memento?: {
    neo4jUri: string
    username: string
    password: string
  }
  
  autoMigration?: {
    enabled: boolean
    thresholds: {
      entityCount: number
      searchLatency: number    // ms
      fileSize: number         // bytes
    }
  }
}

/**
 * Default Configuration
 */
const DEFAULT_CONFIG: MemoryConfig = {
  backend: 'server-memory',
  
  serverMemory: {
    storagePath: app.getPath('userData') + '/memory'
  },
  
  autoMigration: {
    enabled: true,
    thresholds: {
      entityCount: 10000,
      searchLatency: 100,
      fileSize: 50 * 1024 * 1024  // 50MB
    }
  }
}

/**
 * MemoryServiceFactory
 * 
 * Creates the appropriate memory backend based on configuration.
 * Allows swapping backends without changing application code.
 * 
 * Usage:
 *   const backend = MemoryServiceFactory.create()
 *   await backend.createEntity({...})
 * 
 * To switch backends:
 *   1. Update config.backend to 'memento-mcp'
 *   2. Restart service
 *   3. Data migrates automatically
 */
export class MemoryServiceFactory {
  // Use same type assertion as store.ts for consistent API
  private static store = new Store<Record<string, any>>() as Store<Record<string, any>> & {
    get: (key: string, defaultValue?: any) => any;
    set: (key: string, value: any) => void;
  }
  
  /**
   * Create backend instance based on config
   */
  static create(config?: MemoryConfig): UnifiedMemoryBackend {
    const finalConfig = config || this.loadConfig()
    
    switch (finalConfig.backend) {
      case 'server-memory':
        if (!finalConfig.serverMemory) {
          throw new Error('server-memory config missing')
        }
        return new ServerMemoryAdapter(finalConfig.serverMemory)
        
      case 'memento-mcp':
        if (!finalConfig.memento) {
          throw new Error('memento-mcp config missing. Please configure Neo4j settings.')
        }
        return new MementoMCPAdapter(finalConfig.memento)
        
      default:
        throw new Error(`Unknown backend: ${finalConfig.backend}`)
    }
  }
  
  /**
   * Load configuration from electron-store
   */
  static loadConfig(): MemoryConfig {
    return this.store.get('memory', DEFAULT_CONFIG)
  }
  
  /**
   * Save configuration to electron-store
   */
  static saveConfig(config: MemoryConfig): void {
    this.store.set('memory', config)
  }
  
  /**
   * Update backend (triggers migration)
   */
  static async switchBackend(newBackend: 'server-memory' | 'memento-mcp'): Promise<void> {
    const config = MemoryServiceFactory.loadConfig()
    config.backend = newBackend
    MemoryServiceFactory.saveConfig(config)
  }
  
  /**
   * Get current backend name
   */
  static getCurrentBackend(): string {
    return this.loadConfig().backend
  }
  
  /**
   * Check if auto-migration is enabled
   */
  static isAutoMigrationEnabled(): boolean {
    return this.loadConfig().autoMigration?.enabled ?? true
  }
  
  /**
   * Get migration thresholds
   */
  static getMigrationThresholds() {
    return this.loadConfig().autoMigration?.thresholds || DEFAULT_CONFIG.autoMigration!.thresholds
  }
}
