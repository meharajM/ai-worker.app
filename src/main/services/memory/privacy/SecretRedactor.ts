/**
 * SecretRedactor - Detect and Block Secrets
 * 
 * Prevents API keys, tokens, and passwords from being stored in memory.
 * Unlike PII, secrets should NEVER be stored - this class throws errors instead of redacting.
 * 
 * Supported Secret Types:
 * - API keys (sk_, pk_, Bearer tokens)
 * - JWT tokens
 * - GitHub tokens (ghp_, gho_, etc.)
 * - AWS keys
 * - OpenAI keys
 * - Anthropic keys
 * - Password fields
 * - Generic secret patterns
 * 
 * Security Philosophy:
 * - Secrets should NEVER reach the storage layer
 * - Detection happens before storage
 * - Errors are thrown to prevent accidental leaks
 * 
 * Usage:
 *   const redactor = new SecretRedactor()
 *   
 *   // Throws error if secrets detected
 *   redactor.check("My API key is sk_test_12345...")
 *   // Error: Secret detected (apiKey). Secrets must not be stored in memory.
 */
export class SecretRedactor {
  private patterns: Record<string, RegExp> = {
    // Common API key patterns
    apiKey: /\b(sk|pk)_[a-zA-Z0-9_-]{32,}\b/g,
    bearerToken: /Bearer\s+[a-zA-Z0-9_-]+/g,
    
    // JWT tokens
    jwt: /\beyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\b/g,
    
    // GitHub tokens
    githubToken: /\b(ghp|gho|ghu|ghs|ghr)_[a-zA-Z0-9]{36,}\b/g,
    
    // AWS credentials
    awsAccessKey: /\b(AKIA|ASIA)[A-Z0-9]{16}\b/g,
    awsSecretKey: /\b[A-Za-z0-9/+=]{40}\b/g,
    
    // OpenAI keys
    openaiKey: /\bsk-[a-zA-Z0-9]{48}\b/g,
    
    // Anthropic keys
    anthropicKey: /\bsk-ant-[a-zA-Z0-9-_]{95,}\b/g,
    
    // Google API keys
    googleApiKey: /\bAIza[0-9A-Za-z_-]{35}\b/g,
    
    // Password fields (various formats)
    passwordField: /password\s*[:=]\s*['"]?([^'"\s]{8,})['"]?/gi,
    passwordJson: /"password"\s*:\s*"([^"]{8,})"/gi,
    
    // Generic secret patterns
    secretEnv: /(SECRET|TOKEN|KEY|PASSWORD|CREDENTIAL)\s*[:=]\s*['"]?([a-zA-Z0-9_\-+=]{16,})['"]?/gi,
    
    // Private keys
    privateKey: /-----BEGIN\s+(RSA\s+)?PRIVATE\s+KEY-----/g,
    
    // Database connection strings with passwords
    dbConnection: /(mongodb|postgres|mysql):\/\/[^:]+:([^@]+)@/gi
  }

  /**
   * Detect if text contains any secrets
   * 
   * @param text - Text to scan for secrets
   * @returns true if secrets are detected
   */
  detect(text: string): boolean {
    for (const pattern of Object.values(this.patterns)) {
      pattern.lastIndex = 0
      if (pattern.test(text)) {
        return true
      }
    }
    return false
  }

  /**
   * Detect secrets and return detailed information
   * 
   * @param text - Text to scan
   * @returns Object with detection details
   */
  detectDetailed(text: string): { found: boolean; types: string[]; positions?: Record<string, number[]> } {
    const types: string[] = []
    const positions: Record<string, number[]> = {}

    for (const [type, pattern] of Object.entries(this.patterns)) {
      pattern.lastIndex = 0
      const matches = [...text.matchAll(pattern)]
      
      if (matches.length > 0) {
        types.push(type)
        positions[type] = matches.map(m => m.index || 0)
      }
    }

    return {
      found: types.length > 0,
      types,
      ...(types.length > 0 && { positions })
    }
  }

  /**
   * Check for secrets and throw error if found
   * 
   * This is the primary method to use before storing data.
   * It will throw an error if any secrets are detected.
   * 
   * @param text - Text to check
   * @throws Error if secrets are detected
   */
  check(text: string): void {
    const detection = this.detectDetailed(text)
    
    if (detection.found) {
      const types = detection.types.join(', ')
      throw new Error(
        `Secret detected (${types}). Secrets must not be stored in memory. ` +
        `Please remove sensitive data before saving.\n\n` +
        `Detected types: ${types}\n` +
        `If this is a false positive, you can adjust the secret patterns.`
      )
    }
  }

  /**
   * Safe check that doesn't throw
   * 
   * Returns a result object instead of throwing.
   * Use this when you want to handle secrets gracefully.
   * 
   * @param text - Text to check
   * @returns Result object with safe property
   */
  safeCheck(text: string): { safe: boolean; detected?: string[] } {
    const detection = this.detectDetailed(text)
    
    if (detection.found) {
      return {
        safe: false,
        detected: detection.types
      }
    }
    
    return { safe: true }
  }

  /**
   * Add custom secret pattern
   * 
   * @param name - Name of the secret type
   * @param pattern - Regex pattern to detect this secret type
   */
  addPattern(name: string, pattern: RegExp): void {
    this.patterns[name] = pattern
  }

  /**
   * Remove a secret pattern
   * 
   * @param name - Name of the secret type to remove
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
   * Check if specific secret type exists in text
   * 
   * @param text - Text to check
   * @param type - Secret type to look for
   * @returns true if the specified secret type is found
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
   * Sanitize text for logging/debugging
   * 
   * Unlike the main check() method, this redacts secrets for safe logging
   * Use this when you need to log text that might contain secrets
   * 
   * @param text - Text to sanitize
   * @returns Text with secrets replaced by [SECRET_REDACTED]
   */
  sanitize(text: string): string {
    let sanitized = text

    for (const [type, pattern] of Object.entries(this.patterns)) {
      pattern.lastIndex = 0
      sanitized = sanitized.replace(pattern, `[${type.toUpperCase()}_REDACTED]`)
    }

    return sanitized
  }
}
