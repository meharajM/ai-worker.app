/**
 * Error sanitization utility for IPC handlers
 * Prevents information disclosure by returning user-friendly messages
 * while logging full technical details for debugging
 */

export function sanitizeError(error: unknown, context: string): string {
  // Log full error details for debugging
  console.error(`[${context}] Full error:`, error);

  // Return user-friendly message
  if (error instanceof Error) {
    // Map known error types to user-friendly messages
    if (error.message.includes('ENOENT')) return 'File or directory not found';
    if (error.message.includes('EACCES')) return 'Permission denied';
    if (error.message.includes('EEXIST')) return 'File or directory already exists';
    if (error.message.includes('ENOTDIR')) return 'Not a directory';
    if (error.message.includes('EISDIR')) return 'Is a directory';
    if (error.message.includes('ENOTFOUND')) return 'Network resource not found';
    if (error.message.includes('ETIMEDOUT')) return 'Operation timed out';
    if (error.message.includes('ECONNREFUSED')) return 'Connection refused';

    // Generic fallback - don't expose internal details
    return 'Operation failed. Please check the logs for details.';
  }

  return 'An unexpected error occurred';
}
