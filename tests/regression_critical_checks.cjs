#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();

function read(relPath) {
  return fs.readFileSync(path.join(ROOT, relPath), 'utf8');
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function assertIncludes(haystack, needle, context) {
  assert(haystack.includes(needle), `${context}: expected to include "${needle}"`);
}

function assertNotIncludes(haystack, needle, context) {
  assert(!haystack.includes(needle), `${context}: should not include "${needle}"`);
}

function testAgentRuntimeDelegateParallelism() {
  const src = read('src/renderer/src/lib/agent-runtime.ts');
  assertIncludes(src, 'const parallelDelegateBatch =', 'agent-runtime');
  assertIncludes(
    src,
    'response.toolCalls.every((call) => call.name === "delegate_sub_task")',
    'agent-runtime'
  );
  assertIncludes(
    src,
    'Promise.all(response.toolCalls.map((call) => executeToolCall(call)))',
    'agent-runtime'
  );
}

function testTaskDecomposerConditionalHeuristic() {
  const src = read('src/renderer/src/lib/task-decomposer.ts');
  assertIncludes(src, 'const SEQUENTIAL_INTENT_PATTERN =', 'task-decomposer');
  assertIncludes(
    src,
    'const CONDITIONAL_SEQUENTIAL_INTENT_PATTERN =',
    'task-decomposer'
  );
  assertNotIncludes(
    src,
    'const SEQUENTIAL_INTENT_PATTERN = /\\b(and then|then|after that|next|finally|first|second|third|before|once|if\\b|unless)\\b/i;',
    'task-decomposer'
  );
}

function testOpenRouterBackoffIsolationAndAbortability() {
  const src = read('src/renderer/src/lib/llm/openai.ts');
  assertIncludes(src, 'const openRouterBackoffUntilByKey = new Map<string, number>();', 'openai');
  assertIncludes(src, 'function getOpenRouterBackoffKey(baseUrl: string, model: string): string {', 'openai');
  assertIncludes(src, 'async function sleepWithAbort(ms: number, signal?: AbortSignal): Promise<void> {', 'openai');
  assertIncludes(src, 'await waitForOpenRouterBackoff(isOpenRouter, model, openRouterBackoffKey, abortSignal);', 'openai');
  assertIncludes(src, 'await sleepWithAbort(delayMs, abortSignal);', 'openai');
}

function testAgentStateServiceNoGlobalSuppressor() {
  const src = read('src/renderer/src/lib/agent/AgentStateService.ts');
  assertIncludes(src, 'const memoryCreateDisabledUntilByContext = new Map<string, number>();', 'agent-state');
  assertIncludes(src, 'function canCreateStateEntity(context: string): boolean {', 'agent-state');
  assertNotIncludes(src, 'Skipping handoff entity creation (memory_create_entity temporarily disabled)', 'agent-state');
  assertIncludes(src, 'clearMemoryCreateFailure(createContext);', 'agent-state');
}

function run() {
  console.log('Running critical regression checks...');
  testAgentRuntimeDelegateParallelism();
  testTaskDecomposerConditionalHeuristic();
  testOpenRouterBackoffIsolationAndAbortability();
  testAgentStateServiceNoGlobalSuppressor();
  console.log('All critical regression checks passed.');
}

try {
  run();
} catch (error) {
  console.error('Critical regression check failed.');
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

