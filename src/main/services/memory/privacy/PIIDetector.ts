/**
 * PIIDetector - Personally Identifiable Information Detection
 * 
 * Detects PII patterns before storing data in memory to protect user privacy.
 * 
 * Supported PII Types:
 * - Email addresses
 * - Phone numbers (US format)
 * - Social Security Numbers (SSN)
 * - Credit card numbers
 * - IP addresses
 * - MAC addresses
 * 
 * Usage:
 *   const detector = new PIIDetector()
 *   const result = detector.detect("Contact me at john@example.com")
 *   // result: { found: true, types: ['email'] }
 * 
 *   const redacted = detector.redact("My SSN is 123-45-6789")
 *   // redacted: "My SSN is [SSN_REDACTED]"
 */
export class PIIDetector {
  private patterns: Record<string, RegExp> = {
    email: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g,
    phone: /\b(?:\+?1[-.\s]?)?\(?([0-9]{3})\)?[-.\s]?([0-9]{3})[-.\s]?([0-9]{4})\b/g,
    ssn: /\b\d{3}-\d{2}-\d{4}\b/g,
    creditCard: /\b\d{4}[-\s]?\d{4}[-\s]?\d{4}[-\s]?\d{4}\b/g,
    ipAddress: /\b(?:[0-9]{1,3}\.){3}[0-9]{1,3}\b/g,
    macAddress: /\b([0-9A-Fa-f]{2}[:-]){5}([0-9A-Fa-f]{2})\b/g
  }

  /**
   * Detect PII in text
   * 
   * @param text - Text to scan for PII
   * @returns Object indicating if PII was found and which types
   */
  detect(text: string): { found: boolean; types: string[]; matches?: Record<string, string[]> } {
    const types: string[] = []
    const matches: Record<string, string[]> = {}

    for (const [type, pattern] of Object.entries(this.patterns)) {
      // Reset regex lastIndex for global patterns
      pattern.lastIndex = 0
      
      const found = text.match(pattern)
      if (found && found.length > 0) {
        types.push(type)
        matches[type] = found
      }
    }

    return {
      found: types.length > 0,
      types,
      ...(types.length > 0 && { matches })
    }
  }

  /**
   * Redact PII from text
   * 
   * Replaces detected PII with redaction placeholders like [EMAIL_REDACTED]
   * 
   * @param text - Text to redact
   * @returns Text with PII replaced by placeholders
   */
  redact(text: string): string {
    let redacted = text

    for (const [type, pattern] of Object.entries(this.patterns)) {
      // Reset regex lastIndex for global patterns
      pattern.lastIndex = 0
      
      redacted = redacted.replace(pattern, `[${type.toUpperCase()}_REDACTED]`)
    }

    return redacted
  }

  /**
   * Add custom PII pattern
   * 
   * @param name - Name of the PII type
   * @param pattern - Regex pattern to detect this PII type
   */
  addPattern(name: string, pattern: RegExp): void {
    this.patterns[name] = pattern
  }

  /**
   * Remove a PII pattern
   * 
   * @param name - Name of the PII type to remove
   */
  removePattern(name: string): void {
    delete this.patterns[name]
  }

  /**
   * Get all registered patterns
   */
  getPatterns(): Record<string, RegExp> {
    return { ...this.patterns }
  }

  /**
   * Check if specific PII type exists in text
   * 
   * @param text - Text to check
   * @param type - PII type to look for (e.g., 'email', 'phone')
   * @returns true if the specified PII type is found
   */
  hasType(text: string, type: string): boolean {
    const pattern = this.patterns[type]
    if (!pattern) {
      return false
    }

    pattern.lastIndex = 0
    return pattern.test(text)
  }

  /**
   * Get count of PII occurrences by type
   * 
   * @param text - Text to analyze
   * @returns Object mapping PII types to occurrence counts
   */
  getCounts(text: string): Record<string, number> {
    const counts: Record<string, number> = {}

    for (const [type, pattern] of Object.entries(this.patterns)) {
      pattern.lastIndex = 0
      const matches = text.match(pattern)
      counts[type] = matches ? matches.length : 0
    }

    return counts
  }
}
