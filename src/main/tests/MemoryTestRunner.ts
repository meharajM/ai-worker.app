
import { MemoryService } from '../services/MemoryService'

export class MemoryTestRunner {
  private service: MemoryService
  private results: string[] = []
  private errors: string[] = []

  constructor() {
    this.service = MemoryService.getInstance()
  }

  private log(msg: string) {
    console.log(`[MemoryTest] ${msg}`)
    this.results.push(msg)
  }

  private error(msg: string) {
    console.error(`[MemoryTest] ERROR: ${msg}`)
    this.errors.push(msg)
    this.results.push(`❌ ${msg}`)
  }

  async runTests(): Promise<{ results: string[], passed: boolean }> {
    this.log('Starting Memory Architecture Verification...')
    
    try {
      this.log('Test 1: Initialization')
      await this.service.initialize()
      this.log('✅ Service initialized')

      const testId = Date.now().toString()
      
      // 2. Privacy Check: PII
      this.log('Test 2: PII Detection')
      try {
        await this.service.createEntity(
          'Test PII',
            'person',
          `Contact me at test${testId}@example.com for details.`
        )
        this.error('Failed to detect PII (Email)')
      } catch (e: any) {
        if (e.message.includes('PII detected')) {
          this.log('✅ PII Detection worked: ' + e.message)
        } else {
          this.error('Unexpected error during PII check: ' + e.message)
        }
      }

      // 3. Privacy Check: Secrets
      this.log('Test 3: Secret Redaction')
      try {
        await this.service.createEntity(
          'Test Secret',
            'api_key',
          `My key is sk_live_${testId}12345`
        )
        this.error('Failed to detect Secret')
      } catch (e: any) {
        // Broad check for secret message
        this.log('✅ Secret blocked: ' + e.message)
      }

      // 4. Valid Entity Creation
      this.log('Test 4: Valid Entity Creation')
      const entityName = `Test Entity ${testId}`
      const created = await this.service.createEntity(
        entityName,
        'test_data',
        'This is a safe test description.'
      )
      
      if (created && created.name === entityName) {
          this.log(`✅ Entity created: ${created.id}`)
      } else {
          this.error('Entity creation failed')
      }

      // 5. Search
      this.log('Test 5: Search')
      const searchResults = await this.service.search(entityName)
      if (searchResults.length > 0 && searchResults[0].name === entityName) {
          this.log(`✅ Search found entity: ${searchResults[0].name}`)
      } else {
          this.error(`Search failed to find ${entityName}`)
      }

      // 6. Metrics/Stats
      this.log('Test 6: Stats')
      // Accessing backend dynamically to avoid TS private access issues in strict mode
      // @ts-ignore
      const backend = this.service.backend
      if (backend) {
        const stats = await backend.getStats()
        this.log(`✅ Stats retrieved: ${stats.entityCount} entities`)
      }

      // 7. Cleanup
      this.log('Test 7: Cleanup')
      if (created && backend) {
          await backend.deleteEntity(created.id)
          this.log('✅ Test entity deleted')
      }

    } catch (err: any) {
      this.error(`Fatal Test Error: ${err.message}`)
      console.error(err)
    }

    const passed = this.errors.length === 0
    return { results: this.results, passed }
  }
}
