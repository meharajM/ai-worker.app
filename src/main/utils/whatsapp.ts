/**
 * Utility functions for WhatsApp operations.
 */

/**
 * Validates and formats a string into a WhatsApp JID.
 * @param to - The phone number or JID string.
 * @returns The formatted JID or null if invalid.
 */
export function formatWhatsAppJid(to: string): string | null {
    if (!to) return null;
    
    // If it's already a JID, return as is
    if (to.includes('@s.whatsapp.net') || to.includes('@g.us')) {
        return to;
    }
    
    // Remove all non-digit characters
    const normalized = to.replace(/[^0-9]/g, '');
    
    // Check if we have at least 7 digits (minimum for a phone number)
    if (normalized.length < 7) {
        return null;
    }
    
    return `${normalized}@s.whatsapp.net`;
}
