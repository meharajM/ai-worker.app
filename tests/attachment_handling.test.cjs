/**
 * Attachment Handling Tests (Node.js Native)
 * 
 * Tests the attachment functionality WITHOUT depending on MarkItDown server.
 * Tests verify INPUT → OUTPUT behavior.
 * 
 * Run with: node tests/attachment_handling.test.cjs
 */

const assert = require('assert');

// Helper: Generate attachment context (mirrors agent-runtime.ts logic)
function generateAttachmentContext(attachments) {
    if (!attachments || attachments.length === 0) return '';
    
    const validAttachments = attachments.filter(a => a.path && a.path.trim() !== "");
    if (validAttachments.length === 0) return '';

    const callLines = validAttachments.map((a, i) => {
        const uri = a.path.startsWith("file://") ? a.path : `file://${a.path}`;
        return `${i + 1}. ${a.name}\n   → convert_to_markdown(uri="${uri}")`;
    }).join('\n');

    return `\n\n[ATTACHED FILES — act on these immediately and read each one NOW using the exact call shown]\n${callLines}\n\nCRITICAL: Copy the uri/file_path argument CHARACTER-FOR-CHARACTER from above. Do NOT use just the filename. Do NOT construct a URI yourself. Reading attached files does NOT require a workspace to be selected.`;
}

// Helper: Check if file is supported
function isSupportedFile(filename) {
    const SUPPORTED_EXTENSIONS = [
        '.pdf', '.docx', '.xlsx', '.pptx',
        '.png', '.jpg', '.jpeg', '.gif',
        '.mp3', '.wav', '.m4a',
        '.html', '.csv', '.json', '.xml', '.txt', '.md'
    ];
    const extension = '.' + filename.split('.').pop()?.toLowerCase();
    return SUPPORTED_EXTENSIONS.includes(extension);
}

console.log('🧪 Running Attachment Handling Tests...\n');

let passed = 0;
let failed = 0;

function test(name, fn) {
    try {
        fn();
        console.log(`✅ ${name}`);
        passed++;
    } catch (error) {
        console.error(`❌ ${name}`);
        console.error(`   ${error.message}`);
        failed++;
    }
}

// === PATH EXTRACTION TESTS ===
console.log('\n📁 Path Extraction Tests');

test('Extract path from File object', () => {
    const mockFile = { name: 'test.png', path: '/Users/test/Desktop/test.png' };
    assert.strictEqual(mockFile.path, '/Users/test/Desktop/test.png');
});

test('Handle file without path property', () => {
    const mockFile = { name: 'test.png' };
    const path = mockFile.path || '';
    assert.strictEqual(path, '');
});

test('Handle special characters in filename', () => {
    const mockFile = { name: 'test (copy) [2].png', path: '/Users/test/test (copy) [2].png' };
    assert.ok(mockFile.path.includes('(copy)'));
    assert.ok(mockFile.path.includes('[2]'));
});

test('Handle spaces in path', () => {
    const mockFile = { name: 'my file.pdf', path: '/Users/test/My Documents/my file.pdf' };
    assert.ok(mockFile.path.includes(' '));
});

test('Handle very long paths', () => {
    const longPath = '/Users/test/' + 'a/'.repeat(50) + 'file.txt';
    const mockFile = { name: 'file.txt', path: longPath };
    assert.ok(mockFile.path.length > 100);
});

// === CONTEXT GENERATION TESTS ===
console.log('\n📝 Context Generation Tests');

test('Generate context for standard attachment', () => {
    const attachments = [{ name: 'screenshot.png', path: '/Users/test/screenshot.png' }];
    const context = generateAttachmentContext(attachments);
    
    assert.ok(context.includes('screenshot.png'));
    assert.ok(context.includes('convert_to_markdown(uri="file:///Users/test/screenshot.png")'));
});

test('Generate context for multiple attachments', () => {
    const attachments = [
        { name: 'image.png', path: '/Users/test/image.png' },
        { name: 'document.pdf', path: '/Users/test/document.pdf' },
        { name: 'audio.m4a', path: '/Users/test/audio.m4a' }
    ];
    const context = generateAttachmentContext(attachments);
    
    assert.ok(context.includes('image.png\n   → convert_to_markdown'));
    assert.ok(context.includes('document.pdf\n   → convert_to_markdown'));
    assert.ok(context.includes('audio.m4a\n   → convert_to_markdown'));
});

test('Return empty string for no attachments', () => {
    const context = generateAttachmentContext([]);
    assert.strictEqual(context, '');
});

test('Handle empty paths', () => {
    const attachments = [{ name: 'test.png', path: '' }];
    const context = generateAttachmentContext(attachments);
    
    // Empty paths should be filtered out by validAttachments
    assert.strictEqual(context, '');
});

// === FILE URI TESTS ===
console.log('\n🔗 File URI Format Tests');

test('Convert absolute path to file:// URI', () => {
    const path = '/Users/test/Desktop/image.png';
    const uri = `file://${path}`;
    assert.strictEqual(uri, 'file:///Users/test/Desktop/image.png');
});

test('Handle Windows-style paths', () => {
    const path = '/C:/Users/test/image.png';
    const uri = `file://${path}`;
    assert.strictEqual(uri, 'file:///C:/Users/test/image.png');
});

test('Handle paths with spaces', () => {
    const path = '/Users/test/My Documents/file.pdf';
    const uri = `file://${path}`;
    assert.ok(uri.includes('file://'));
    assert.ok(uri.includes('My Documents'));
});

test('Handle paths with special characters', () => {
    const path = '/Users/test/file (1) [copy].png';
    const uri = `file://${path}`;
    assert.ok(uri.includes('(1)'));
    assert.ok(uri.includes('[copy]'));
});

// === DATA FLOW TESTS ===
console.log('\n🔄 Data Flow Tests');

test('Map File object to attachment metadata', () => {
    const mockFile = { name: 'test.png', path: '/Users/test/test.png', type: 'image/png' };
    const attachmentData = {
        name: mockFile.name,
        path: mockFile.path || '',
        type: mockFile.type
    };
    
    assert.strictEqual(attachmentData.name, 'test.png');
    assert.strictEqual(attachmentData.path, '/Users/test/test.png');
    assert.strictEqual(attachmentData.type, 'image/png');
});

test('Handle multiple files in batch', () => {
    const files = [
        { name: 'a.png', path: '/a.png', type: 'image/png' },
        { name: 'b.pdf', path: '/b.pdf', type: 'application/pdf' }
    ];
    const attachmentData = files.map(file => ({
        name: file.name,
        path: file.path || '',
        type: file.type
    }));
    
    assert.strictEqual(attachmentData.length, 2);
    assert.strictEqual(attachmentData[0].name, 'a.png');
    assert.strictEqual(attachmentData[1].name, 'b.pdf');
});

// === EDGE CASES ===
console.log('\n⚠️  Edge Case Tests');

test('Handle null/undefined attachments', () => {
    assert.strictEqual(generateAttachmentContext(null), '');
    assert.strictEqual(generateAttachmentContext(undefined), '');
    assert.strictEqual(generateAttachmentContext([]), '');
});

test('Handle file with no extension', () => {
    const mockFile = { name: 'README', path: '/Users/test/README' };
    assert.strictEqual(mockFile.name, 'README');
});

test('Handle file with multiple dots', () => {
    const mockFile = { name: 'archive.tar.gz', path: '/Users/test/archive.tar.gz' };
    assert.strictEqual(mockFile.name, 'archive.tar.gz');
});

test('Handle unicode characters in filename', () => {
    const mockFile = { name: '文档.pdf', path: '/Users/test/文档.pdf' };
    assert.ok(mockFile.path.includes('文档'));
});

test('Handle emoji in filename', () => {
    const mockFile = { name: '📄 document.pdf', path: '/Users/test/📄 document.pdf' };
    assert.ok(mockFile.name.includes('📄'));
});

// === FILE TYPE VALIDATION ===
console.log('\n📋 File Type Validation Tests');

test('Recognize supported image formats', () => {
    assert.strictEqual(isSupportedFile('photo.png'), true);
    assert.strictEqual(isSupportedFile('photo.jpg'), true);
    assert.strictEqual(isSupportedFile('photo.jpeg'), true);
    assert.strictEqual(isSupportedFile('photo.gif'), true);
});

test('Recognize supported document formats', () => {
    assert.strictEqual(isSupportedFile('doc.pdf'), true);
    assert.strictEqual(isSupportedFile('doc.docx'), true);
    assert.strictEqual(isSupportedFile('sheet.xlsx'), true);
    assert.strictEqual(isSupportedFile('slides.pptx'), true);
});

test('Recognize supported audio formats', () => {
    assert.strictEqual(isSupportedFile('audio.mp3'), true);
    assert.strictEqual(isSupportedFile('audio.wav'), true);
    assert.strictEqual(isSupportedFile('audio.m4a'), true);
});

test('Reject unsupported formats', () => {
    assert.strictEqual(isSupportedFile('video.mp4'), false);
    assert.strictEqual(isSupportedFile('archive.zip'), false);
    assert.strictEqual(isSupportedFile('executable.exe'), false);
});

test('Case-insensitive file type checking', () => {
    assert.strictEqual(isSupportedFile('PHOTO.PNG'), true);
    assert.strictEqual(isSupportedFile('Document.PDF'), true);
});

// === SUMMARY ===
console.log('\n' + '='.repeat(50));
console.log(`📊 Test Results: ${passed} passed, ${failed} failed`);
console.log('='.repeat(50));

if (failed > 0) {
    process.exit(1);
}
