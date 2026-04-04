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

function testTaskDecomposerWebsiteAliasExtraction() {
  const src = read('src/renderer/src/lib/task-decomposer.ts');
  assertIncludes(src, 'const WEBSITE_ALIAS_TO_DOMAIN:', 'task-decomposer');
  assertIncludes(src, "amazon: 'amazon.com'", 'task-decomposer');
  assertIncludes(src, "ebay: 'ebay.com'", 'task-decomposer');
  assertIncludes(src, "bestbuy: 'bestbuy.com'", 'task-decomposer');
  assertIncludes(src, 'for (const [alias, domain] of Object.entries(WEBSITE_ALIAS_TO_DOMAIN)) {', 'task-decomposer');
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

function testPhaseARuntimeWritePauseAndSessionIsolation() {
  const runtimeSrc = read('src/renderer/src/lib/agent-runtime.ts');
  assertIncludes(runtimeSrc, 'function isWriteAwaitingApproval(callName: string, resultStr: string): boolean {', 'agent-runtime');
  assertIncludes(runtimeSrc, 'File Write Paused', 'agent-runtime');
  assertIncludes(runtimeSrc, 'pending approval', 'agent-runtime');

  const chatStoreSrc = read('src/renderer/src/stores/chatStore.ts');
  assertIncludes(chatStoreSrc, 'const existing = next.get(sessionId);', 'chat-store');
  assertIncludes(chatStoreSrc, 'existing.abortController.abort();', 'chat-store');
}

function testPhaseAMemoryParsingFallbacks() {
  const src = read('src/main/services/memory/adapters/ServerMemoryAdapter.ts');
  assertIncludes(src, 'function parseEntityLikePayload(text: string): Record<string, unknown> | null {', 'server-memory-adapter');
  assertNotIncludes(src, "throw new Error('No content returned from create_entities')", 'server-memory-adapter');
  assertNotIncludes(src, "throw new Error('No text content in create_entities response')", 'server-memory-adapter');
}

function testPhaseACompactChecklistSemantics() {
  const src = read('src/renderer/src/components/chat/SubTaskChecklist.tsx');
  assertIncludes(src, 'const completedWithIssues = isTerminal && hasFailure', 'subtask-checklist');
  assertIncludes(src, 'Completed with issues', 'subtask-checklist');
  assertNotIncludes(src, 'const completedWithIssues = isTerminal && hasFailure && completedCount > 0', 'subtask-checklist');
}

function testImmediateReplyNoToolMode() {
  const runtimeSrc = read('src/renderer/src/lib/agent-runtime.ts');
  assertIncludes(
    runtimeSrc,
    'const directAnswerFirstTurn = !this.options.isSubAgent && shouldPreferDirectAnswer(finalPrompt);',
    'agent-runtime'
  );
  assertIncludes(
    runtimeSrc,
    'const disableToolsThisIteration = directAnswerFirstTurn && iterationCount === 0;',
    'agent-runtime'
  );

  const llmSrc = read('src/renderer/src/lib/llm.ts');
  assertIncludes(
    llmSrc,
    'includePlanTool = true',
    'llm'
  );
  assertIncludes(
    llmSrc,
    'if (includePlanTool) {',
    'llm'
  );

  const openaiSrc = read('src/renderer/src/lib/llm/openai.ts');
  assertIncludes(
    openaiSrc,
    'const toolRecoveryAllowed = Boolean(tools && tools.length > 0);',
    'openai'
  );
}

function testMemoryReflectorCancellationHook() {
  const reflectorSrc = read('src/renderer/src/lib/memory-reflector.ts');
  assertIncludes(reflectorSrc, "cancel(reason = 'new prompt')", 'memory-reflector');
  assertIncludes(reflectorSrc, 'this.currentAbortController?.abort();', 'memory-reflector');

  const useAgentSrc = read('src/renderer/src/hooks/useAgent.ts');
  assertIncludes(
    useAgentSrc,
    "MemoryReflector.getInstance().cancel('prompt-restart');",
    'useAgent'
  );
}

function testE2EAssertionsAreStrict() {
  const realSrc = read('tests/real_e2e_test.cjs');
  assertIncludes(realSrc, '!result.timedOut && actionCards === 1', 'real-e2e');
  assertIncludes(realSrc, '!result.timedOut && hasProgress && hasParallel', 'real-e2e');
  assertIncludes(realSrc, '!result.timedOut && checkpointLogs.length > 0', 'real-e2e');

  const mockedSrc = read('tests/e2e_ui_mocked.cjs');
  assertIncludes(mockedSrc, "console.error('⚠️ Handoff test failed');", 'mocked-e2e');
  assertIncludes(mockedSrc, "console.error('❌ Plan Response missing');", 'mocked-e2e');
  assertIncludes(mockedSrc, "console.log('\\n🎉 ALL SCENARIOS PASSED');", 'mocked-e2e');
  assertNotIncludes(mockedSrc, 'ALL SCENARIOS PASSED (with handled warnings)', 'mocked-e2e');
}

function testRealE2EIdleGating() {
  const realSrc = read('tests/real_e2e_test.cjs');
  assertIncludes(realSrc, 'async function waitForRunIdle(', 'real-e2e');
  assertIncludes(realSrc, 'button[title="Stop Generation"]', 'real-e2e');
  assertIncludes(realSrc, 'Keyword matched but run still active; continuing to wait.', 'real-e2e');
}

function run() {
  console.log('Running critical regression checks...');
  testAgentRuntimeDelegateParallelism();
  testTaskDecomposerConditionalHeuristic();
  testTaskDecomposerWebsiteAliasExtraction();
  testOpenRouterBackoffIsolationAndAbortability();
  testAgentStateServiceNoGlobalSuppressor();
  testPhaseARuntimeWritePauseAndSessionIsolation();
  testPhaseAMemoryParsingFallbacks();
  testPhaseACompactChecklistSemantics();
  testImmediateReplyNoToolMode();
  testMemoryReflectorCancellationHook();
  testE2EAssertionsAreStrict();
  testRealE2EIdleGating();
  console.log('All critical regression checks passed.');
}

try {
  run();
} catch (error) {
  console.error('Critical regression check failed.');
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
