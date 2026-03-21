import { describe, it, before } from 'node:test';
import * as assert from 'node:assert';

// Mock browser globals required by Zustand and Electron bridges
(global as any).window = {
    electron: {
        platform: 'mac',
        whatsapp: {
            sendPresence: async () => {},
            sendMessage: async () => {}
        }
    }
};
(global as any).localStorage = {
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {}
};

// Import the module under test using relative path
import {
    resolveWhatsAppTarget,
    getWhatsAppSystemPrompt,
    resolveWhatsAppMessageToLLM
} from '../src/renderer/src/lib/whatsapp-integration';
import { useWhatsAppStore } from '../src/renderer/src/stores/whatsappStore';

describe('WhatsApp Integration Logic', () => {

    describe('resolveWhatsAppTarget', () => {
        before(() => {
            // Reset state
            useWhatsAppStore.setState({
                connectionState: { status: 'disconnected', qrCode: null, error: null, phoneNumber: null, workerNumber: null },
                whatsappEnabled: false
            });
        });

        it('should extract target JID from message text', () => {
            const jid = resolveWhatsAppTarget('📱 **WhatsApp** (919876543210@s.whatsapp.net):\nHello!');
            // Since it's disconnected, it should return null because target only resolves when connected.
            assert.strictEqual(jid, null);
            
            // Re-enable whatsapp mode and connect
            useWhatsAppStore.setState({
                connectionState: { status: 'connected', qrCode: null, error: null, phoneNumber: '5551234@s.whatsapp.net', workerNumber: null },
                whatsappEnabled: true
            });
            const validJid = resolveWhatsAppTarget('📱 **WhatsApp** (919876543210@s.whatsapp.net):\nHello!');
            assert.strictEqual(validJid, '919876543210@s.whatsapp.net');
        });

        it('should fallback to global target when enabled without specific message text', () => {
            useWhatsAppStore.setState({
                connectionState: { status: 'connected', qrCode: null, error: null, phoneNumber: '8881234@s.whatsapp.net', workerNumber: null },
                whatsappEnabled: true
            });
            const validJid = resolveWhatsAppTarget('Just a random message');
            assert.strictEqual(validJid, '8881234@s.whatsapp.net');
        });
    });

    describe('getWhatsAppSystemPrompt', () => {
        it('should return system prompt with WHATSAPP MODE ACTIVE', () => {
            const prompt = getWhatsAppSystemPrompt();
            assert.strictEqual(prompt.role, 'system');
            assert.ok(typeof prompt.content === 'string' && prompt.content.includes('WHATSAPP MODE ACTIVE'));
        });
    });

    describe('resolveWhatsAppMessageToLLM', () => {

        it('should structure an image message properly', async () => {
            const msg = {
                type: 'image',
                mediaUrl: 'file:///tmp/wa_media_123.jpg',
                content: '[Media Message]',
                caption: undefined
            };
            const result = await resolveWhatsAppMessageToLLM(msg);
            
            assert.strictEqual(result.role, 'user');
            assert.ok(Array.isArray(result.content));
            
            const contentArray = result.content as { type: string, image_url?: { url: string }, text?: string }[];
            assert.strictEqual(contentArray.length, 2);
            assert.strictEqual(contentArray[0].type, 'image_url');
            assert.strictEqual(contentArray[0].image_url?.url, 'file:///tmp/wa_media_123.jpg');
            assert.strictEqual(contentArray[1].type, 'text');
            assert.ok(contentArray[1].text?.includes('[Image saved locally at: /tmp/wa_media_123.jpg]'));

            assert.strictEqual(result.attachments?.length, 1);
            assert.strictEqual(result.attachments![0].type, 'image');
            assert.strictEqual(result.attachments![0].path, '/tmp/wa_media_123.jpg'); // file:// removed
        });

        it('should structure an audio message purely as text ref', async () => {
            const msg = {
                type: 'audio',
                mediaUrl: 'file:///tmp/wa_media_456.ogg',
                content: '[Media Message]',
            };
            const result = await resolveWhatsAppMessageToLLM(msg);
            
            assert.strictEqual(result.role, 'user');
            assert.strictEqual(typeof result.content, 'string');
            assert.ok((result.content as string).includes('/tmp/wa_media_456.ogg'));
            assert.ok((result.content as string).includes('[User attached an audio file: '));
        });

        it('should extract documents similarly', async () => {
            const msg = {
                type: 'document',
                mediaUrl: 'file:///tmp/wa_media_doc.pdf',
                content: '[Media Message]',
            };
            const result = await resolveWhatsAppMessageToLLM(msg);
            
            assert.strictEqual(typeof result.content, 'string');
            assert.ok((result.content as string).includes('[User attached a document: /tmp/wa_media_doc.pdf. Use convert_to_markdown'));
        });

        it('should append text caption after the media', async () => {
             const msg = {
                type: 'image',
                mediaUrl: 'file:///tmp/wa_media_cat.jpg',
                content: 'Look at this funny cat', // the caption
                caption: 'Look at this funny cat'
            };
            const result = await resolveWhatsAppMessageToLLM(msg);
            
            const contentArray = result.content as { type: string, text?: string, image_url?: any }[];
            assert.strictEqual(contentArray.length, 3);
            assert.strictEqual(contentArray[0].type, 'image_url');
            assert.strictEqual(contentArray[1].type, 'text');
            assert.strictEqual(contentArray[2].type, 'text');
            assert.strictEqual(contentArray[2].text, 'Look at this funny cat');
        });

        it('should resolve plain text exactly as a single string (not an array)', async () => {
             const msg = {
                type: 'text',
                content: 'Hello AI',
            };
            const result = await resolveWhatsAppMessageToLLM(msg);
            assert.strictEqual(result.content, 'Hello AI');
        });
    });
});
