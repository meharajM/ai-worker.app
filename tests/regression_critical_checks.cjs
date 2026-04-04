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

function testUserEnvironmentGeoBackoff() {
  const src = read('src/renderer/src/lib/user-environment.ts');
  assertIncludes(src, 'const GEO_FETCH_TIMEOUT_MS = 2000;', 'user-environment');
  assertIncludes(src, 'const GEO_FETCH_BACKOFF_MS = 10 * 60 * 1000;', 'user-environment');
  assertIncludes(src, 'if (Date.now() < geoFetchBackoffUntil) return null;', 'user-environment');
  assertIncludes(src, 'Failed to fetch geolocation (backing off)', 'user-environment');
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
  assertIncludes(
    runtimeSrc,
    'const shouldDirectAnswer = shouldPreferDirectAnswer(finalPrompt);',
    'agent-runtime'
  );
  assertIncludes(
    runtimeSrc,
    'if (shouldDirectAnswer) {',
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
  assertIncludes(
    useAgentSrc,
    "const shouldRunReflector =",
    'useAgent'
  );
  assertIncludes(
    useAgentSrc,
    "skipping MemoryReflector for low-signal direct prompt",
    'useAgent'
  );
}

function testE2EAssertionsAreStrict() {
  const realSrc = read('tests/real_e2e_test.cjs');
  assertIncludes(realSrc, '!result.timedOut && finalResultSignals >= 1 && assistantDelta >= 1 && terminalSummarySeen', 'real-e2e');
  assertIncludes(realSrc, '!result.timedOut && (orchestratedPath || directSingleSite)', 'real-e2e');
  assertIncludes(realSrc, '!result.timedOut && hasProgress && hasParallel', 'real-e2e');
  assertIncludes(realSrc, 'logsContain(/progress_update session=/i) || logsContain(/parallel_start run=/i) || logsContain(/parallel_done run=/i)', 'real-e2e');
  assertIncludes(realSrc, '!result.timedOut && checkpointLogs.length > 0', 'real-e2e');

  const mockedSrc = read('tests/e2e_ui_mocked.cjs');
  assertIncludes(mockedSrc, "console.error('⚠️ Handoff test failed');", 'mocked-e2e');
  assertIncludes(mockedSrc, "console.error('❌ Plan Response missing');", 'mocked-e2e');
  assertIncludes(mockedSrc, '\\[LLM\\]\\[Issue #19\\] recovery_json_success', 'mocked-e2e');
  assertIncludes(mockedSrc, '\\[LLM\\]\\[Issue #19\\] recovery_xml_success', 'mocked-e2e');
  assertNotIncludes(mockedSrc, 'JSON recovery signal not visible in UI; continuing (non-blocking)', 'mocked-e2e');
  assertNotIncludes(mockedSrc, 'XML recovery signal not visible in UI; continuing (non-blocking)', 'mocked-e2e');
  assertIncludes(mockedSrc, "console.log('\\n🎉 ALL SCENARIOS PASSED');", 'mocked-e2e');
  assertNotIncludes(mockedSrc, 'ALL SCENARIOS PASSED (with handled warnings)', 'mocked-e2e');
}

function testEvaluateToolTopLevelReturnRecovery() {
  const advancedSrc = read('src/main/services/playwright/tools/AdvancedTools.ts');
  assertIncludes(advancedSrc, "aliases = ['browser_run_code', 'browser_evaluate'];", 'advanced-tools');
  assertIncludes(advancedSrc, "typeof args?.code === 'string' ? args.code : ''", 'advanced-tools');
  assertIncludes(advancedSrc, 'Missing required parameter: script', 'advanced-tools');
  assertIncludes(advancedSrc, "return statements are only valid inside functions", 'advanced-tools');
  assertIncludes(advancedSrc, 'const hasSyntaxLikeFailure =', 'advanced-tools');
  assertIncludes(advancedSrc, 'const genericEvaluateFailureWithReturn =', 'advanced-tools');
  assertIncludes(advancedSrc, 'const alreadyIifeWrapped =', 'advanced-tools');
  assertIncludes(advancedSrc, 'recovered script by wrapping top-level return in IIFE', 'advanced-tools');
}

function testLaneTimeoutsForPerceptionTools() {
  const lanesSrc = read('src/renderer/src/lib/execution-lanes.ts');
  assertIncludes(lanesSrc, 'BROWSER_PERCEPTION: 60_000', 'execution-lanes');
  assertIncludes(lanesSrc, "const PERCEPTION_TOOLS = [", 'execution-lanes');
  assertIncludes(lanesSrc, "'get_state'", 'execution-lanes');
  assertIncludes(lanesSrc, "'get_page_content'", 'execution-lanes');
  assertIncludes(lanesSrc, "'wait_for_navigation'", 'execution-lanes');
}

function testCloseTabLastTabNoop() {
  const tabToolsSrc = read('src/main/services/playwright/tools/TabTools.ts');
  assertIncludes(tabToolsSrc, "Skipped close_tab: last tab remains open", 'tab-tools');
  assertNotIncludes(tabToolsSrc, "return { result: null, error: 'Cannot close the last tab' };", 'tab-tools');
}

function testNavigationTimeoutRecovery() {
  const navigateSrc = read('src/main/services/playwright/tools/NavigateTool.ts');
  assertIncludes(navigateSrc, 'interactive_timeout — page usable', 'navigate-tool');
  assertIncludes(navigateSrc, 'Navigation timed out but page appears interactive.', 'navigate-tool');
  assertIncludes(navigateSrc, 'const probe = await probeReadiness(page);', 'navigate-tool');
  assertIncludes(navigateSrc, 'const outcome = classifyNavigationError(errorStr, probe);', 'navigate-tool');
  assertIncludes(navigateSrc, "meta: { navigationOutcome: 'interactive_timeout' as NavigationOutcome }", 'navigate-tool');
  assertIncludes(navigateSrc, "safeArgs = args ?? {}", 'navigate-tool');
}

function testWaitForNavigationHeuristicFallback() {
  const miscSrc = read('src/main/services/playwright/tools/MiscTools.ts');
  assertIncludes(miscSrc, 'const perStateTimeout = Math.max(2000, Math.floor(timeout / loadStates.length));', 'misc-tools');
  assertIncludes(miscSrc, 'Navigation likely complete (heuristic).', 'misc-tools');
  assertIncludes(miscSrc, 'interactiveElements=', 'misc-tools');
}

function testGetStateNavigationRaceResilience() {
  const getStateSrc = read('src/main/services/playwright/tools/GetStateTool.ts');
  assertIncludes(getStateSrc, 'const safeArgs = args ?? {};', 'get-state');
  assertIncludes(getStateSrc, 'for (let attempt = 1; attempt <= 3; attempt++) {', 'get-state');
  assertIncludes(getStateSrc, 'const readinessProbe = await probeReadinessWithRetry(page, 2, 1200);', 'get-state');
  assertIncludes(getStateSrc, '[GetStateTool][Issue #10] page not usable before extraction', 'get-state');
  assertIncludes(getStateSrc, "Target page, context or browser has been closed", 'get-state');
  assertIncludes(getStateSrc, "await withNavigationRecovery(() => page.evaluate(() => {", 'get-state');
}

function testToolResultMetadataPropagation() {
  const toolBase = read('src/main/services/playwright/PlaywrightTool.ts');
  assertIncludes(toolBase, 'meta?: Record<string, unknown>;', 'playwright-tool');

  const mainMcp = read('src/main/ipc/mcp.ts');
  assertIncludes(mainMcp, "if (res.meta && typeof res.meta === 'object') wrapped.meta = res.meta", 'main-mcp');
}

function testSubAgentExtractionFirstRule() {
  const promptSrc = read('src/renderer/src/lib/llm/prompts.ts');
  assertIncludes(
    promptSrc,
    '**Extraction first**: For info-gathering tasks, prefer get_state/get_page_content/evaluate before clicking deep links.',
    'prompts'
  );
}

function testClickTextBoundedTimeoutAndFallbacks() {
  const clickTextSrc = read('src/main/services/playwright/tools/ClickTextTool.ts');
  assertIncludes(clickTextSrc, "timeout: { type: 'number', description: 'Max wait in ms (default: 8000, capped to 15000)' }", 'click-text');
  assertIncludes(clickTextSrc, 'const rawTimeout = typeof safeArgs.timeout === \'number\' ? safeArgs.timeout : 8000;', 'click-text');
  assertIncludes(clickTextSrc, 'const timeout = Math.max(1500, Math.min(15000, rawTimeout));', 'click-text');
  assertIncludes(clickTextSrc, 'recovered exact click_text via compact partial match', 'click-text');
  assertIncludes(clickTextSrc, 'recovered click_text via keyword fallback', 'click-text');
}

function testRecoverySignalLogging() {
  const openaiSrc = read('src/renderer/src/lib/llm/openai.ts');
  assertIncludes(openaiSrc, '[LLM][Issue #19] recovery_json_success', 'openai');
  assertIncludes(openaiSrc, '[LLM][Issue #19] recovery_xml_success', 'openai');
}

function testRealE2EIdleGating() {
  const realSrc = read('tests/real_e2e_test.cjs');
  assertIncludes(realSrc, "const CRITICAL_SELECT_ARG = process.argv.find((arg) => arg.startsWith('--only-critical=') || arg.startsWith('--critical='));", 'real-e2e');
  assertIncludes(realSrc, 'function shouldRunCritical(id) {', 'real-e2e');
  assertIncludes(realSrc, 'if (shouldRunCritical(3)) {', 'real-e2e');
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
  testUserEnvironmentGeoBackoff();
  testAgentStateServiceNoGlobalSuppressor();
  testPhaseARuntimeWritePauseAndSessionIsolation();
  testPhaseAMemoryParsingFallbacks();
  testPhaseACompactChecklistSemantics();
  testImmediateReplyNoToolMode();
  testMemoryReflectorCancellationHook();
  testE2EAssertionsAreStrict();
  testEvaluateToolTopLevelReturnRecovery();
  testLaneTimeoutsForPerceptionTools();
  testCloseTabLastTabNoop();
  testNavigationTimeoutRecovery();
  testWaitForNavigationHeuristicFallback();
  testGetStateNavigationRaceResilience();
  testToolResultMetadataPropagation();
  testSubAgentExtractionFirstRule();
  testClickTextBoundedTimeoutAndFallbacks();
  testRecoverySignalLogging();
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
