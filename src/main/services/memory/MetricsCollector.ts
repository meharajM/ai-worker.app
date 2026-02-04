import type { MemoryStats } from './UnifiedMemoryBackend'

/**
 * MetricsCollector - Track Memory Usage Metrics
 * 
 * Monitors memory system performance to determine when migration is needed.
 * Tracks entity count, search performance, and storage size.
 * 
 * When to Migrate:
 * - Entity count > 10,000
 * - Average search latency > 100ms
 * - Storage size > 50MB
 * 
 * Usage:
 *   const metrics = new MetricsCollector()
 *   metrics.increment('entityCount')
 *   metrics.recordLatency(45)
 *   
 *   if (await metrics.shouldSuggestMigration()) {
 *     // Show migration UI
 *   }
 */
export class MetricsCollector {
  private stats = {
    entityCount: 0,
    relationCount: 0,
    searchCount: 0,
    totalSearchLatency: 0,
    storageSize: 0,
    lastUpdated: Date.now()
  }

  private searchLatencies: number[] = []
  private maxLatencyHistory = 100 // Keep last N search latencies

  /**
   * Increment a counter metric
   * 
   * @param metric - Metric name to increment
   * @param value - Amount to increment (default: 1)
   */
  increment(metric: 'entityCount' | 'relationCount' | 'searchCount', value: number = 1): void {
    this.stats[metric] += value
    this.stats.lastUpdated = Date.now()
  }

  /**
   * Decrement a counter metric
   * 
   * @param metric - Metric name to decrement
   * @param value - Amount to decrement (default: 1)
   */
  decrement(metric: 'entityCount' | 'relationCount', value: number = 1): void {
    this.stats[metric] = Math.max(0, this.stats[metric] - value)
    this.stats.lastUpdated = Date.now()
  }

  /**
   * Record a search latency measurement
   * 
   * @param latency - Search latency in milliseconds
   */
  recordLatency(latency: number): void {
    this.stats.searchCount++
    this.stats.totalSearchLatency += latency
    
    // Keep rolling window of latencies for better average
    this.searchLatencies.push(latency)
    if (this.searchLatencies.length > this.maxLatencyHistory) {
      this.searchLatencies.shift()
    }
    
    this.stats.lastUpdated = Date.now()
  }

  /**
   * Update storage size metric
   * 
   * @param size - Storage size in bytes
   */
  updateStorageSize(size: number): void {
    this.stats.storageSize = size
    this.stats.lastUpdated = Date.now()
  }

  /**
   * Get current memory statistics
   * 
   * @returns Current stats including average search latency
   */
  async getStats(): Promise<MemoryStats> {
    return {
      entityCount: this.stats.entityCount,
      relationCount: this.stats.relationCount,
      storageSize: this.stats.storageSize,
      avgSearchLatency: this.getAverageLatency(),
      backend: 'server-memory' // TODO: Get from config
    }
  }

  /**
   * Get average search latency
   * Uses rolling window if available, otherwise overall average
   */
  private getAverageLatency(): number {
    if (this.searchLatencies.length > 0) {
      const sum = this.searchLatencies.reduce((a, b) => a + b, 0)
      return sum / this.searchLatencies.length
    }
    
    if (this.stats.searchCount > 0) {
      return this.stats.totalSearchLatency / this.stats.searchCount
    }
    
    return 0
  }

  /**
   * Check if migration should be suggested
   * 
   * Migration thresholds:
   * - Entity count > 10,000
   * - Average search latency > 100ms
   * - Storage size > 50MB
   * 
   * @returns true if any threshold is exceeded
   */
  async shouldSuggestMigration(): Promise<boolean> {
    const stats = await this.getStats()

    return (
      stats.entityCount > 10000 ||
      stats.avgSearchLatency > 100 ||
      stats.storageSize > 50 * 1024 * 1024 // 50MB
    )
  }

  /**
   * Get migration reasons
   * 
   * Returns array of reasons why migration is recommended
   * 
   * @returns Array of reason strings
   */
  async getMigrationReasons(): Promise<string[]> {
    const stats = await this.getStats()
    const reasons: string[] = []

    if (stats.entityCount > 10000) {
      reasons.push(`High entity count (${stats.entityCount.toLocaleString()})`)
    }

    if (stats.avgSearchLatency > 100) {
      reasons.push(`Slow search performance (${Math.round(stats.avgSearchLatency)}ms avg)`)
    }

    if (stats.storageSize > 50 * 1024 * 1024) {
      const sizeMB = (stats.storageSize / (1024 * 1024)).toFixed(2)
      reasons.push(`Large storage size (${sizeMB}MB)`)
    }

    return reasons
  }

  /**
   * Get health score (0-100)
   * 
   * 100 = Perfect performance
   * 0 = Critical, needs immediate migration
   * 
   * @returns Health score from 0-100
   */
  async getHealthScore(): Promise<number> {
    const stats = await this.getStats()
    
    // Score each metric from 0-100
    const entityScore = Math.max(0, 100 - (stats.entityCount / 10000) * 100)
    const latencyScore = Math.max(0, 100 - (stats.avgSearchLatency / 100) * 100)
    const storageScore = Math.max(0, 100 - (stats.storageSize / (50 * 1024 * 1024)) * 100)
    
    // Average the scores
    return Math.round((entityScore + latencyScore + storageScore) / 3)
  }

  /**
   * Reset all metrics
   */
  reset(): void {
    this.stats = {
      entityCount: 0,
      relationCount: 0,
      searchCount: 0,
      totalSearchLatency: 0,
      storageSize: 0,
      lastUpdated: Date.now()
    }
    this.searchLatencies = []
  }

  /**
   * Export metrics for analysis
   */
  export(): {
    stats: {
      entityCount: number
      relationCount: number
      searchCount: number
      totalSearchLatency: number
      storageSize: number
      lastUpdated: number
    }
    searchLatencies: number[]
    averageLatency: number
  } {
    return {
      stats: { ...this.stats },
      searchLatencies: [...this.searchLatencies],
      averageLatency: this.getAverageLatency()
    }
  }

  /**
   * Import metrics (useful for persistence)
   */
  import(data: {
    stats: {
      entityCount: number
      relationCount: number
      searchCount: number
      totalSearchLatency: number
      storageSize: number
      lastUpdated: number
    }
    searchLatencies: number[]
  }): void {
    this.stats = { ...data.stats }
    this.searchLatencies = [...data.searchLatencies]
  }
}
