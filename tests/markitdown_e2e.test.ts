import { describe, it } from 'node:test';
import * as assert from 'node:assert';
import { execSync } from 'node:child_process';
import * as fs from 'node:fs';

describe('MarkItDown End-to-End Compatibility', () => {

    // Simple helper to test execution of uvx markitdown-mcp[all] for a specific file
    function testMarkItDown(filePath: string) {
        if (!fs.existsSync(filePath)) {
            // Skip if the file doesn't exist on this run (as they are temp files)
            console.log(`Skipping missing file: ${filePath}`);
            return;
        }

        try {
            // Execute markitdown command identically to how the MCP server is configured via uvx
            const output = execSync(`uvx 'markitdown[all]' "${filePath}"`, {
                encoding: 'utf-8',
                timeout: 30000 // Allow 30 seconds for heavy docs
            });

            assert.ok(output.length > 0, 'Output should not be empty');
            assert.ok(typeof output === 'string', 'Output should be text (Markdown)');
            console.log(`✅ Successfully processed ${filePath}`);
        } catch (error: any) {
            console.error(`❌ Failed processing ${filePath}:`, error.message);
            throw new Error(`MarkItDown failed for ${filePath}`);
        }
    }

    it('should successfully convert an Excel (.xlsx) file', () => {
        const testPath = '/tmp/test_excel.xlsx';
        testMarkItDown(testPath);
    });

    it('should successfully transcript an MP3 (.mp3) audio file', () => {
        // Find an mp3 from the known temp path, or skip if empty
        const tempFiles = fs.readdirSync('/var/folders/hf/xnnl863n2739s5vcnwl_9rw40000gn/T').filter(f => f.startsWith('wa_media_') && f.endsWith('.mp3'));
        if (tempFiles.length > 0) {
            testMarkItDown(`/var/folders/hf/xnnl863n2739s5vcnwl_9rw40000gn/T/${tempFiles[0]}`);
        }
    });

    it('should successfully convert a Document (.docx) file', () => {
        const tempFiles = fs.readdirSync('/var/folders/hf/xnnl863n2739s5vcnwl_9rw40000gn/T').filter(f => f.startsWith('wa_media_') && f.endsWith('.docx'));
        if (tempFiles.length > 0) {
            testMarkItDown(`/var/folders/hf/xnnl863n2739s5vcnwl_9rw40000gn/T/${tempFiles[0]}`);
        }
    });
    
    it('should successfully convert a PDF (.pdf) file', () => {
        const tempFiles = fs.readdirSync('/var/folders/hf/xnnl863n2739s5vcnwl_9rw40000gn/T').filter(f => f.startsWith('wa_media_') && f.endsWith('.pdf'));
        if (tempFiles.length > 0) {
            testMarkItDown(`/var/folders/hf/xnnl863n2739s5vcnwl_9rw40000gn/T/${tempFiles[0]}`);
        }
    });
});
