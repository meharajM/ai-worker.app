import { describe, it } from 'node:test';
import * as assert from 'node:assert';
import { classifyFileByExtension, classifyFile, normalizeAttachmentType, buildMediaLLMParts, buildAttachmentLLMParts } from '../src/renderer/src/lib/media-utils';

describe('Media Utils Logic', () => {

    describe('classifyFileByExtension', () => {
        it('should correctly classify common spreadsheet extensions', () => {
            assert.strictEqual(classifyFileByExtension('data.xlsx'), 'spreadsheet');
            assert.strictEqual(classifyFileByExtension('data.csv'), 'spreadsheet');
            assert.strictEqual(classifyFileByExtension('data.ods'), 'spreadsheet');
        });

        it('should correctly classify media extensions', () => {
            assert.strictEqual(classifyFileByExtension('image.jpg'), 'image');
            assert.strictEqual(classifyFileByExtension('image.png'), 'image');
            assert.strictEqual(classifyFileByExtension('audio.mp3'), 'audio');
            assert.strictEqual(classifyFileByExtension('video.mp4'), 'video');
            assert.strictEqual(classifyFileByExtension('voice.ogg'), 'audio');
        });

        it('should correctly classify documents and code', () => {
            assert.strictEqual(classifyFileByExtension('notes.pdf'), 'document');
            assert.strictEqual(classifyFileByExtension('notes.docx'), 'document');
            assert.strictEqual(classifyFileByExtension('script.ts'), 'code');
            assert.strictEqual(classifyFileByExtension('style.css'), 'code');
        });

        it('should handle absolute paths and uppercase extensions', () => {
            assert.strictEqual(classifyFileByExtension('/tmp/wa_media_1234/file.PDF'), 'document');
            assert.strictEqual(classifyFileByExtension('/var/folders/T/wa_media_1.XLSX'), 'spreadsheet');
            assert.strictEqual(classifyFileByExtension('no_extension_file'), 'binary');
        });
    });

    describe('normalizeAttachmentType', () => {
        it('should normalize MIME types into canonical MediaTypes', () => {
            assert.strictEqual(normalizeAttachmentType('image/png'), 'image');
            assert.strictEqual(normalizeAttachmentType('audio/ogg'), 'audio');
            assert.strictEqual(normalizeAttachmentType('application/pdf'), 'document');
            assert.strictEqual(normalizeAttachmentType('text/csv'), 'spreadsheet');
            assert.strictEqual(normalizeAttachmentType('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'), 'spreadsheet');
        });

        it('should safely passthrough canonical types', () => {
            assert.strictEqual(normalizeAttachmentType('spreadsheet'), 'spreadsheet');
            assert.strictEqual(normalizeAttachmentType('code'), 'code');
        });

        it('should fallback to filename extension if MIME is obscure or generic', () => {
            assert.strictEqual(normalizeAttachmentType('application/octet-stream', 'data.xlsx'), 'spreadsheet');
            assert.strictEqual(normalizeAttachmentType('', 'script.js'), 'code');
        });
    });

    describe('buildMediaLLMParts', () => {
        it('should build dual parts for image with local extraction instruction', () => {
            const parts = buildMediaLLMParts('/tmp/cat.jpg', 'image');
            assert.strictEqual(parts.length, 2);
            assert.strictEqual(parts[0].type, 'image_url');
            assert.strictEqual(parts[1].type, 'text');
            assert.ok(parts[1].text?.includes('[Image saved locally at: /tmp/cat.jpg]'));
        });

        it('should build specific convert_to_markdown tool instruction for spreadsheet', () => {
            const parts = buildMediaLLMParts('/tmp/finance.xlsx', 'spreadsheet');
            assert.strictEqual(parts.length, 1);
            assert.strictEqual(parts[0].type, 'text');
            assert.ok(parts[0].text?.includes('[User attached a spreadsheet'));
            assert.ok(parts[0].text?.includes('/tmp/finance.xlsx'));
            assert.ok(parts[0].text?.includes('Use convert_to_markdown to read its tabular data'));
        });

        it('should append user caption as a final text part if provided', () => {
            const parts = buildMediaLLMParts('/tmp/cat.jpg', 'image', 'Look at this cat!');
            assert.strictEqual(parts.length, 3);
            assert.strictEqual(parts[2].type, 'text');
            assert.strictEqual(parts[2].text, 'Look at this cat!');
        });
    });

    describe('buildAttachmentLLMParts (History Reconstruction)', () => {
        it('should reconstruct LLM parts from standard attachment store objects', () => {
            const attachments = [
                { name: 'data.xlsx', path: '/tmp/data.xlsx', type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
                { name: 'photo.png', path: '/tmp/photo.png', type: 'image/png' }
            ];
            
            const parts = buildAttachmentLLMParts(attachments, 'Here are the files you requested.') as any[];
            
            // 1 part for spreadsheet + 2 parts for image + 1 part for text = 4 total parts
            assert.strictEqual(parts.length, 4);
            assert.ok(parts[0].text?.includes('[User attached a spreadsheet'));
            assert.strictEqual(parts[1].type, 'image_url');
            assert.ok(parts[2].text?.includes('[Image saved locally'));
            assert.strictEqual(parts[3].text, 'Here are the files you requested.');
        });
    });
});
