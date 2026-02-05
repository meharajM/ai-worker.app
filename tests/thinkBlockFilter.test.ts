/**
 * Tests for universal think block filtering
 * Run with: node --test tests/thinkBlockFilter.test.ts
 */

import { filterThinkBlocks, hasLeakedReasoning } from '../src/renderer/src/lib/thinkBlockFilter';

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

// Test XML think tags (OpenAI format)
test('should filter XML think tags (OpenAI format)', () => {
    const input = '<think>Planning steps...</think>Here is the answer';
    const result = filterThinkBlocks(input);
    assert(result.thinking === 'Planning steps...', 'thinking should be extracted');
    assert(result.cleanedContent === 'Here is the answer', 'content should be cleaned');
    assert(result.format === 'xml', 'format should be xml');
    assert(result.isComplete === true, 'should be complete');
});

// Test markdown think blocks (Gemini format)
test('should filter markdown think blocks (Gemini format)', () => {
    const input = '```think\\nAnalyzing request...\\n```\\nHere is the response';
    const result = filterThinkBlocks(input);
    assert(result.thinking === 'Analyzing request...', 'thinking should be extracted');
    assert(result.cleanedContent === 'Here is the response', 'content should be cleaned');
    assert(result.format === 'markdown', 'format should be markdown');
    assert(result.isComplete === true, 'should be complete');
});

// Test incomplete streaming blocks
test('should handle incomplete streaming blocks', () => {
    const input = '<think>Partial reasoning...';
    const result = filterThinkBlocks(input);
    assert(result.thinking === 'Partial reasoning...', 'thinking should be extracted');
    assert(result.isComplete === false, 'should not be complete');
    assert(result.format === 'xml', 'format should be xml');
});

// Test Claude thinking tags
test('should handle Claude thinking tags', () => {
    const input = '<thinking>Analysis</thinking>Response';
    const result = filterThinkBlocks(input);
    assert(result.thinking === 'Analysis', 'thinking should be extracted');
    assert(result.cleanedContent === 'Response', 'content should be cleaned');
    assert(result.format === 'xml', 'format should be xml');
});

// Test no think blocks
test('should return original content if no think blocks', () => {
    const input = 'Just a normal response';
    const result = filterThinkBlocks(input);
    assert(result.thinking === null, 'thinking should be null');
    assert(result.cleanedContent === input, 'content should be unchanged');
    assert(result.format === 'none', 'format should be none');
});

// Test leaked reasoning detection
test('should detect leaked reasoning patterns', () => {
    assert(hasLeakedReasoning('The user wants me to...'), 'should detect "The user"');
    assert(hasLeakedReasoning('Let me think about this...'), 'should detect "Let me"');
    assert(hasLeakedReasoning('I should probably...'), 'should detect "I should"');
    assert(!hasLeakedReasoning('Here is the answer'), 'should not detect normal response');
});

// Test empty content
test('should handle empty content', () => {
    const result = filterThinkBlocks('');
    assert(result.thinking === null, 'thinking should be null');
    assert(result.cleanedContent === '', 'content should be empty');
    assert(result.format === 'none', 'format should be none');
});

console.log('\\n✅ All tests passed!');
