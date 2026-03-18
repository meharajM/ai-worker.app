/**
 * Tests for WhatsApp JID formatting
 * Run with: node --test tests/whatsapp_jid.test.ts
 */

import { formatWhatsAppJid } from '../src/main/utils/whatsapp.js';

// Simple test runner
function test(name: string, fn: () => void) {
    try {
        fn();
        console.log(`✓ ${name}`);
    } catch (error) {
        console.error(`✗ ${name}`);
        console.error(error);
        process.exit(1);
    }
}

function assert(condition: boolean, message: string) {
    if (!condition) {
        throw new Error(message);
    }
}

test('should format a standard 10-digit number', () => {
    const input = '1234567890';
    const result = formatWhatsAppJid(input);
    assert(result === '1234567890@s.whatsapp.net', 'should append @s.whatsapp.net');
});

test('should format a number with international code', () => {
    const input = '+919876543210';
    const result = formatWhatsAppJid(input);
    assert(result === '919876543210@s.whatsapp.net', 'should remove + and append @s.whatsapp.net');
});

test('should handle existing JIDs', () => {
    const input = '1234567890@s.whatsapp.net';
    const result = formatWhatsAppJid(input);
    assert(result === '1234567890@s.whatsapp.net', 'should return existing JID unchanged');
});

test('should handle group JIDs', () => {
    const input = '1234567890-123456@g.us';
    const result = formatWhatsAppJid(input);
    assert(result === '1234567890-123456@g.us', 'should return existing group JID unchanged');
});

test('should return null for short numbers', () => {
    const input = '123456';
    const result = formatWhatsAppJid(input);
    assert(result === null, 'should return null for numbers under 7 digits');
});

test('should handle numbers with special characters', () => {
    const input = '(123) 456-7890';
    const result = formatWhatsAppJid(input);
    assert(result === '1234567890@s.whatsapp.net', 'should strip spaces and parentheses');
});

test('should return null for empty input', () => {
    assert(formatWhatsAppJid('') === null, 'empty string should return null');
    assert(formatWhatsAppJid(null as any) === null, 'null should return null');
});

console.log('\n✅ All WhatsApp JID tests passed!');
