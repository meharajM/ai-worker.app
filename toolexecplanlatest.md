# AI Agent Architecture Analysis & Fix Plan

Comprehensive analysis of the 5 key areas you identified.

---

## 1. Local LLM System Requirement Check & Auto-Download

### Current State ✅ (Mostly Good)

**Platform Detection** ([webllm.ts#L257-L329](file:///home/mhrj/Desktop/ai-worker/src/renderer/src/lib/webllm.ts#L257-L329)):
- Detects Windows, macOS, Linux from user agent
- Provides platform-specific error messages with actionable steps (Vulkan for Linux, DirectX 12 for Windows, Metal for macOS)
- Checks `navigator.gpu` and requests adapter with `powerPreference: 'high-performance'`

**Auto-Download** ([App.tsx#L101-L107](file:///home/mhrj/Desktop/ai-worker/src/renderer/src/App.tsx#L101-L107)):
```typescript
if (FEATURE_FLAGS.BROWSER_LLM_ENABLED) {
  const qwenModelId = 'Qwen2.5-0.5B-Instruct-q4f16_1-MLC';
  import('./lib/webllm').then(({ loadWebLLMModel }) => {
    loadWebLLMModel(qwenModelId).catch(err => console.warn('[App] Background model load failed:', err));
  });
}
```

**Compatibility Checks** ([webllm.ts#L171-L210](file:///home/mhrj/Desktop/ai-worker/src/renderer/src/lib/webllm.ts#L171-L210)):
- RAM check via `navigator.deviceMemory`
- Disk space check via `navigator.storage.estimate()`
- VRAM requirements documented per model

### Issues Found

| Issue | Severity | Location |
|-------|----------|----------|
| Auto-download happens blindly without checking compatibility first | Medium | App.tsx#L102-L107 |
| No user notification when WebGPU is unavailable before attempting load | Low | App.tsx |
| `deviceMemory` API is deprecated/unavailable in many browsers | Low | webllm.ts#L181 |

### Proposed Fixes

#### [MODIFY] [App.tsx](file:///home/mhrj/Desktop/ai-worker/src/renderer/src/App.tsx)

Add compatibility check before auto-downloading:

```typescript
// In useEffect for auto-download
if (FEATURE_FLAGS.BROWSER_LLM_ENABLED) {
  import('./lib/webllm').then(async ({ loadWebLLMModel, checkWebLLMModelCompatibility, getWebLLMStatus }) => {
    const status = getWebLLMStatus();
    if (!status.isSupported) {
      console.warn('[App] WebGPU not supported, skipping auto-download');
      return;
    }
    
    const qwenModelId = 'Qwen2.5-0.5B-Instruct-q4f16_1-MLC';
    const { compatible, reasons } = await checkWebLLMModelCompatibility(qwenModelId);
    if (!compatible) {
      console.warn('[App] Model not compatible, skipping auto-download:', reasons);
      return;
    }
    
    loadWebLLMModel(qwenModelId).catch(err => console.warn('[App] Background model load failed:', err));
  });
}
```

---

## 2. Prompt Processing & Task Complexity Identification

### Current State ✅ (Good)

**Orchestrator** ([orchestrator.ts](file:///home/mhrj/Desktop/ai-worker/src/renderer/src/lib/orchestrator.ts)):
- Uses WebLLM (Qwen 0.5B) to analyze user requests
- Outputs structured JSON with `complexity`, `needsTools`, `requiresConfirmation`
- Fallback to cloud when WebGPU unavailable

**System Prompt** ([orchestrator.ts#L19-L73](file:///home/mhrj/Desktop/ai-worker/src/renderer/src/lib/orchestrator.ts#L19-L73)):
- Well-defined complexity levels: `simple`, `moderate`, `complex`
- Clear guidance on when tools are needed
- Real-time data requirements flagged

### Issues Found

| Issue | Severity | Location |
|-------|----------|----------|
| No `complex` complexity level handled in App.tsx | Medium | App.tsx |
| Missing validation of JSON output structure | Low | orchestrator.ts#L144-L156 |

### Proposed Fixes

The current implementation handles complexities well. One minor enhancement:

#### [MODIFY] [orchestrator.ts](file:///home/mhrj/Desktop/ai-worker/src/renderer/src/lib/orchestrator.ts)

Add validation helper:
```typescript
function validatePlanResponse(planData: any): planData is PlanningResponse {
  return (
    typeof planData.complexity === 'string' &&
    ['simple', 'moderate', 'complex'].includes(planData.complexity) &&
    Array.isArray(planData.plan)
  );
}
```

---

## 3. Task Assignment to Local vs Remote Model

### Current State ✅ (Good but could be clearer)

**Provider Selection** ([llm.ts#L1021-L1060](file:///home/mhrj/Desktop/ai-worker/src/renderer/src/lib/llm.ts#L1037-L1060)):
- Auto mode: Gemini → OpenAI → OpenRouter → Ollama → Browser
- Respects user's `preferredProvider` setting

**Executor Provider Mapping** ([executor.ts#L73-L88](file:///home/mhrj/Desktop/ai-worker/src/renderer/src/lib/executor.ts#L73-L88)):
- `local` → browser or ollama
- `cloud` → auto (prioritizes cloud)

### Issues Found

| Issue | Severity | Location |
|-------|----------|----------|
| Orchestrator recommends `local`/`cloud` but executor remaps them | Medium | executor.ts#L73-L88 |
| No direct use of `complexity` for provider selection | Low | executor.ts |
| Auto-mode prioritizes cloud over local even for simple tasks | Medium | llm.ts#L1037-L1049 |

### Proposed Fixes

#### [MODIFY] [llm.ts](file:///home/mhrj/Desktop/ai-worker/src/renderer/src/lib/llm.ts)

Improve auto-selection to prioritize local for simple tasks:

```typescript
// In chat() function, before provider selection
if (preferredProvider === "auto" || !preferredProvider) {
  // Check if this is a simple task that can be handled locally
  // This would require passing complexity info to chat()
  // For now, keep existing priority but this is a future enhancement
}
```

> [!NOTE]
> A more robust fix would pass `complexity` to the `chat()` function so it can make smarter decisions. This is a larger refactor.

---

## 4. Tool Calling: Caching, Indexing & Smart Selection

### Current State ✅ (Well Implemented)

**Tool Registry** ([tool-registry.ts](file:///home/mhrj/Desktop/ai-worker/src/renderer/src/lib/tool-registry.ts)):
- Uses MiniSearch for semantic indexing
- Filters by App Mode first (hard filter)
- Then searches within mode for relevant tools

**Integration** ([App.tsx#L284-L289](file:///home/mhrj/Desktop/ai-worker/src/renderer/src/App.tsx#L284-L289)):
- Hydrates tools before planning
- Uses `searchTools(query, mode)` to get top 15 relevant tools

### Issues Found

| Issue | Severity | Location |
|-------|----------|----------|
| Tool indexing is async but not awaited before first use | Medium | App.tsx#L91-L93 |
| No cache invalidation when servers connect/disconnect | Medium | tool-registry.ts |
| Limit of 15 tools may be too restrictive for some tasks | Low | tool-registry.ts#L78 |

### Proposed Fixes

#### [MODIFY] [App.tsx](file:///home/mhrj/Desktop/ai-worker/src/renderer/src/App.tsx)

Ensure tools are indexed before first query:
```typescript
// In initializeAndAutoConnect
await initializeMcpServers();
await autoConnectServers();
// Wait for indexing instead of fire-and-forget
await ToolRegistry.indexTools();
```

#### [MODIFY] [tool-registry.ts](file:///home/mhrj/Desktop/ai-worker/src/renderer/src/lib/tool-registry.ts)

Add method to re-index on connection change:
```typescript
public async reindexOnConnectionChange(): Promise<void> {
  // Debounced re-indexing
  this.isIndexed = false;
  await this.indexTools();
}
```

Hook this into MCP connection events in `mcp.ts`.

---

## 5. Model Fallback Mechanism

### Current State ✅ (Comprehensive)

**LLM Fallback Chain** ([llm.ts#L1037-L1060](file:///home/mhrj/Desktop/ai-worker/src/renderer/src/lib/llm.ts#L1037-L1060)):
```
Auto Mode: Gemini → OpenAI → OpenRouter → Ollama → Browser
```

**Orchestrator Fallback** ([orchestrator.ts#L101-L114](file:///home/mhrj/Desktop/ai-worker/src/renderer/src/lib/orchestrator.ts#L101-L114)):
- If WebGPU unavailable → `createDirectCloudPlan()`
- If model load fails → `createFallbackPlan()`

**Error Handling** ([llm.ts#L1064-L1072](file:///home/mhrj/Desktop/ai-worker/src/renderer/src/lib/llm.ts#L1064-L1072)):
- Returns graceful error message if no provider available

### Issues Found

| Issue | Severity | Location |
|-------|----------|----------|
| No automatic retry on transient failures | Medium | llm.ts |
| OpenRouter tool support error not handled gracefully | Low | llm.ts#L1137-L1141 |
| No fallback when Gemini tool response is empty (your original issue) | High | llm.ts#L1261-L1275 |

### Proposed Fixes

#### [MODIFY] [llm.ts](file:///home/mhrj/Desktop/ai-worker/src/renderer/src/lib/llm.ts)

Fix Gemini tool response handling (this is the original issue you reported):

1. **Group consecutive tool responses** into a single message
2. **Join all text parts** from response
3. **Add retry logic** for transient failures

```typescript
// In callGemini, fix content extraction
const content = candidate?.content?.parts
  ?.filter((p: any) => p.text)
  .map((p: any) => p.text)
  .join('\n') || "";
```

---

## 6. LLM Availability Race Conditions (Deep Dive)

Your question highlights critical timing scenarios. Let me map each one:

### Current Architecture Flow

```
User Message
    ↓
┌─────────────────────────────────────────────────────────────────┐
│ ORCHESTRATOR (analyzeRequest)                                    │
│ Purpose: Decide complexity + provider recommendation            │
│                                                                 │
│ 1. Check BROWSER_LLM_ENABLED flag                               │
│ 2. Check WebGPU support                                         │
│ 3. If local available → Load model → Analyze → Return plan     │
│ 4. If local unavailable → createDirectCloudPlan()              │
└─────────────────────────────────────────────────────────────────┘
    ↓
┌─────────────────────────────────────────────────────────────────┐
│ EXECUTOR (executePlan)                                          │
│ Purpose: Execute the plan using recommended provider            │
│                                                                 │
│ 1. Map provider: 'local' → browser/ollama, 'cloud' → auto      │
│ 2. Call chat() with effective provider                          │
│ 3. chat() selects ACTUAL provider from available ones          │
└─────────────────────────────────────────────────────────────────┘
```

---

### Scenario Analysis

#### Scenario A: Local LLM Loading (Slow) + Remote LLM Available

**Current Behavior:**
```
User sends message
    ↓
Orchestrator calls loadWebLLMModel() ← BLOCKS HERE (can be 10-60s on first load!)
    ↓ (user waits)
Local model loaded → Analyzes task
    ↓
Executor gets plan with recommendedProvider='local'
    ↓
chat() uses browser LLM (slow inference)
```

**Problems:**
1. 🔴 **No timeout** on `loadWebLLMModel()` - user stuck waiting
2. 🔴 **Remote not used** even though it's faster and available
3. 🔴 **No user feedback** during loading (just "Analyzing...")

**Proposed Fix:**
```typescript
// In orchestrator.ts - Add timeout
const ANALYSIS_TIMEOUT_MS = 5000;

if (!status.isLoaded) {
  const loadPromise = loadWebLLMModel('Qwen2.5-0.5B-Instruct-q4f16_1-MLC');
  const timeoutPromise = new Promise((_, reject) => 
    setTimeout(() => reject(new Error('Timeout')), ANALYSIS_TIMEOUT_MS)
  );
  
  try {
    await Promise.race([loadPromise, timeoutPromise]);
  } catch (e) {
    console.log('[Orchestrator] Local model load timeout, using cloud');
    return createDirectCloudPlan(userMessage, availableTools || []);
  }
}
```

---

#### Scenario B: Remote LLM Connecting (Slow) + Local LLM Ready

**Current Behavior:**
```
User sends message
    ↓
Orchestrator → Local model ready → Analyzes → recommendedProvider='local'
    ↓
Executor → effectiveProvider='browser'
    ↓
chat() → Uses browser LLM (fast, good!)
```

**This scenario works well!** Local is used when available.

**Edge Case:** If `recommendedProvider='cloud'` was set (for complex task) but cloud is slow:
```
Executor → effectiveProvider='auto'
    ↓
chat() → Tries Gemini → Slow/timeout → Tries OpenAI → Slow → Tries Ollama → ...
```

**Problem:** No parallel checking - sequential fallback is slow.

**Proposed Fix:** 
```typescript
// In llm.ts - Add parallel availability check with timeout
async function getFirstAvailableProvider(providers: LLMProvider[], timeout: number = 3000) {
  const checks = providers.map(async p => {
    const available = await checkProviderWithTimeout(p, timeout);
    if (available) return p;
    throw new Error(`${p} not available`);
  });
  
  return Promise.any(checks);
}
```

---

#### Scenario C: Only Local LLM Available (No API Keys)

**Current Behavior:**
```
User sends message
    ↓
Orchestrator → Local model ready → Analyzes task
    ↓
If simple/moderate → recommendedProvider='local' ✅
If complex → recommendedProvider='cloud' ❌
    ↓
Executor → effectiveProvider='auto'
    ↓
chat() → Gemini? No key → OpenAI? No key → OpenRouter? No key → Ollama? Not running → Browser ✅
```

**Problems:**
1. 🟡 Unnecessary fallback chain when we KNOW cloud is unavailable
2. 🟡 Delay while checking each cloud provider

**Proposed Fix:**
```typescript
// In orchestrator.ts - Check cloud availability before recommending
const hasCloudConfig = await hasAnyCloudProvider(); // Quick check for API keys

if (planData.recommendedProvider === 'cloud' && !hasCloudConfig) {
  plan.recommendedProvider = 'local';
  plan.reasoning = 'Using local AI (no cloud API keys configured)';
}
```

---

#### Scenario D: Only Remote LLM Available (WebGPU Not Supported)

**Current Behavior:**
```
User sends message
    ↓
Orchestrator → WebGPU not supported → createDirectCloudPlan()
    ↓
recommendedProvider='cloud', requiresConfirmation=false
    ↓
Executor → effectiveProvider='auto'
    ↓
chat() → Uses first available cloud (Gemini/OpenAI/etc.) ✅
```

**This scenario works well!** But...

**Edge Case:** What if cloud is ALSO unavailable?
```
chat() → No providers available → Error message to user
```

**Problem:** User gets error with no actionable guidance.

**Proposed Fix:**
```typescript
// In llm.ts - Improve no-provider error message
if (!provider) {
  const hasWebGPU = (await checkBrowserLLM()).available;
  const hasOllama = (await checkOllama()).available;
  
  let guidance = 'No LLM provider available.\n';
  if (!hasWebGPU) guidance += '- WebGPU not supported on this device\n';
  if (!hasOllama) guidance += '- Ollama not running (http://localhost:11434)\n';
  guidance += '- No cloud API keys configured (Settings → LLM)\n';
  guidance += '\nPlease configure at least one provider.';
  
  return { content: guidance, provider: 'none', model: 'none' };
}
```

---

### Impact on Task Complexity Analysis

| Scenario | Who Analyzes? | Accuracy | Speed |
|----------|---------------|----------|-------|
| A: Local slow, remote ready | Local (waits) | ✅ Good | ❌ Slow |
| B: Remote slow, local ready | Local | ✅ Good | ✅ Fast |
| C: Only local | Local | ✅ Good | ✅ Fast |
| D: Only remote | Skipped (default plan) | 🟡 None | ✅ Fast |

**Key Insight:** Scenario D skips analysis entirely! The `createDirectCloudPlan()` just assumes `moderate` complexity.

---

### Impact on Tool Execution

| Scenario | Provider Used | Tool Calling |
|----------|---------------|--------------|
| A | Browser (local) | JSON fallback (most models don't have native tools) |
| B | Browser (local) | JSON fallback |
| C | Browser (local) | JSON fallback |
| D | Cloud (Gemini/OpenAI) | Native tool calling ✅ |

**Key Insight:** Local models use **JSON fallback** for tool calling (less reliable), while cloud models use **native function calling** (more reliable).

---

### Proposed Unified Fix: "Smart Router"

Create a new module `src/renderer/src/lib/smart-router.ts`:

```typescript
interface ProviderReadiness {
  local: { ready: boolean; loadTime?: number };
  cloud: { ready: boolean; providers: string[] };
}

export async function getProviderReadiness(): Promise<ProviderReadiness> {
  // Parallel check with short timeout
  const [localStatus, cloudStatus] = await Promise.all([
    checkLocalWithTimeout(2000),
    checkCloudWithTimeout(2000),
  ]);
  
  return { local: localStatus, cloud: cloudStatus };
}

export function recommendProvider(
  complexity: 'simple' | 'moderate' | 'complex',
  readiness: ProviderReadiness
): 'local' | 'cloud' | 'none' {
  // Simple tasks → prefer local if ready
  if (complexity === 'simple' && readiness.local.ready) {
    return 'local';
  }
  
  // Complex tasks → prefer cloud if ready
  if (complexity === 'complex' && readiness.cloud.ready) {
    return 'cloud';
  }
  
  // Moderate → use whichever is ready first
  if (readiness.local.ready) return 'local';
  if (readiness.cloud.ready) return 'cloud';
  
  return 'none';
}
```

---

## Summary: Priority Order

| Priority | Area | Key Fix |
|----------|------|---------|
| 🔴 High | Gemini Tool Response | Fix empty response after tool execution |
| 🔴 High | Scenario A | Add timeout to local model loading |
| 🟡 Medium | Auto-Download | Add compatibility check before download |
| 🟡 Medium | Tool Indexing | Await indexing before first query |
| 🟡 Medium | Scenario C | Check cloud availability before recommending |
| 🟢 Low | Provider Selection | Consider complexity in auto-selection |
| 🟢 Low | Retry Logic | Add transient error retry |

---

## Verification Plan

### Automated Tests
```bash
npm run typecheck
npm run dev
```

### Manual Verification
1. **WebGPU Check**: Launch on Linux without Vulkan → Should show helpful error, not crash
2. **Tool Selection**: Ask "what time is it?" → Should route to `get_current_time` tool
3. **Gemini Tools**: Execute a tool via Gemini → Should return text summary (not empty)
4. **Fallback**: Disable all cloud APIs → Should gracefully fall back to local or show error
