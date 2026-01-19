import { FEATURE_FLAGS } from './constants';
import { chatWithWebLLM, getWebLLMStatus, loadWebLLMModel, webLLMManager } from './webllm';
import type { PlanningResponse, TaskComplexity } from '../types/orchestrator';
import type { LLMTool } from './llm';

// Platform detection for better fallback behavior
function getCurrentPlatform(): 'windows' | 'macos' | 'linux' | 'unknown' {
    const userAgent = navigator.userAgent;
    if (userAgent.includes('Win')) return 'windows';
    if (userAgent.includes('Mac')) return 'macos';
    if (userAgent.includes('Linux') || userAgent.includes('X11')) return 'linux';
    return 'unknown';
}

/**
 * System prompt for plan generation
 * Instructs the local model to output structured JSON with plan details
 */
const PLANNING_SYSTEM_PROMPT = `You are an AI task analyzer. Your job is to understand user requests and create execution plans.

**Output a JSON object with this exact structure:**

{
  "complexity": "simple" | "moderate" | "complex",
  "intent": "Clear, corrected version of user's request",
  "plan": [
    {
      "stepNumber": 1,
      "description": "Human-friendly step description",
      "toolName": "tool_name_if_needed",
      "requiresLLM": true/false,
      "estimatedTime": 2
    }
  ],
  "suggestedTools": ["tool1", "tool2"],
  "recommendedProvider": "local" | "cloud",
  "reasoning": "Why this complexity level?",
  "requiresConfirmation": true/false,
  "autoApproveTimeout": 5 or null,
  "needsTools": true/false,
  "needsRealtimeData": true/false
}

**Complexity & Provider Guidelines:**
- **simple**: Greetings, jokes, casual conversation, OR answering directly from knowledge without tools.
  - Examples: "Hi", "How are you?", "Tell me a joke", "What is 2+2?"
  - Provider: **local** (ALWAYS use local for these)
  - needsTools: false
  - requiresConfirmation: FALSE (auto-execute immediately)
  - complexity: "simple"
  
- **moderate**: ANY task needing tools (Time, Weather, Files, Browser) or moderately hard reasoning.
  - Examples: "What time is it?", "List my files", "Open google.com"
  - Provider: **local** (if tools/capabilities allow) or cloud
  - needsTools: true
  - requiresConfirmation: true (or false for read-only tools like time)
  - complexity: "moderate"

**CRITICAL - REAL-TIME DATA REQUIREMENT:**
If the user asks for ANY of the following, you MUST set "needsTools": true AND "complexity": "moderate":
- Current time, today's date, or weather.
- System status, process list, or file listings.
- Live internet/stock data.
- **IMPORTANT**: If the user asks for "time", you MUST use the tool "get_current_time" if available.

**LOCAL-FIRST PREFERENCE:**
Prefer "local" for all simple intents to ensure speed and privacy. Only suggest "cloud" for complex reasoning or if the local model is insufficient.

**Tool Selection:**
Only suggest tools from the available tools list. If no tools are provided, set needsTools: true so they can be hydrated.

**Important:**
- Output ONLY the JSON object, no other text`;

/**
 * Analyzes a user request and generates an execution plan
 *
 * @param userMessage - The user's input message
 * @param availableTools - MCP tools that can be used
 * @returns Planning response with execution plan
 */
export async function analyzeRequest(
    userMessage: string,
    availableTools?: LLMTool[]
): Promise<PlanningResponse> {

    try {
        // Check if on-device AI is enabled
        if (!FEATURE_FLAGS.BROWSER_LLM_ENABLED) {
            console.log('[Orchestrator] Browser LLM disabled, using fallback');
            return createFallbackPlan(userMessage, availableTools || []);
        }

        // Check WebGPU support first before any initialization
        console.log('[Orchestrator] Checking WebGPU support...');
        await webLLMManager.initialize();
        const status = getWebLLMStatus();
        console.log('[Orchestrator] WebLLM status:', status);
        
        // If WebGPU is not supported, redirect all requests to cloud
        if (!status.isSupported) {
            console.log('[Orchestrator] WebGPU not supported, redirecting to cloud LLM');
            return createDirectCloudPlan(userMessage, availableTools || []);
        }
        
        // If WebGPU is supported but model not loaded, try to load it
        if (!status.isLoaded) {
            console.log('[Orchestrator] Loading 0.5B model for analysis...');
            try {
                await loadWebLLMModel('Qwen2.5-0.5B-Instruct-q4f16_1-MLC');
            } catch (loadError) {
                console.warn('[Orchestrator] Failed to load local model, redirecting to cloud:', loadError);
                return createDirectCloudPlan(userMessage, availableTools || []);
            }
        }

        // Build tool list for context if available
        let toolContext = '';
        if (availableTools) {
            toolContext = availableTools.length > 0
                ? `\n\nAvailable tools:\n${availableTools.map((t) => `- ${t.name}: ${t.description}`).join('\n')}`
                : '\n\nNo tools currently available. User should connect MCP servers for tool usage.';
        } else {
            // OPTIMIZATION: No tools provided, ask model if it NEEDS tools
            toolContext = `\n\nNote: You do not have access to tools right now. 
             If the user Request requires external capabilities (like searching files, web access, system info), 
             set "needsTools" to true in your JSON response. 
             If you can answer from your internal knowledge (simple greetings, jokes, general knowledge), set "needsTools" to false.`;
        }

        // Call local model for analysis
        let response;
        try {
            response = await chatWithWebLLM([
                { role: 'system', content: PLANNING_SYSTEM_PROMPT + toolContext },
                { role: 'user', content: `Analyze this request and create a plan:\n\n"${userMessage}"` },
            ]);
        } catch (chatError) {
            console.warn('[Orchestrator] WebLLM chat failed, using cloud fallback:', chatError);
            return createFallbackPlan(userMessage, availableTools || []);
        }

        // Parse JSON response
        let planData: Record<string, unknown>;
        try {
            // Try to extract JSON from response
            const jsonMatch = response.content.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                planData = JSON.parse(jsonMatch[0]);
            } else {
                throw new Error('No JSON found in response');
            }
        } catch (parseError) {
            console.warn('[Orchestrator] Failed to parse plan JSON, using fallback', parseError);
            return createFallbackPlan(userMessage, availableTools || []);
        }

        // Validate and normalize
        const plan: PlanningResponse = {
            type: 'plan',
            complexity: (planData.complexity as TaskComplexity) || 'moderate',
            intent: (planData.intent as string) || userMessage,
            plan: (planData.plan as PlanningResponse['plan']) || [
                {
                    stepNumber: 1,
                    description: 'Process request',
                    requiresLLM: true,
                    estimatedTime: 3,
                },
            ],
            suggestedTools: (planData.suggestedTools as string[]) || [],
            recommendedProvider: 'local', // Use local since we successfully analyzed with it
            reasoning: (planData.reasoning as string) || 'Analyzed with local model',
            requiresConfirmation: (planData.requiresConfirmation as boolean) !== false,
            autoApproveTimeout: (planData.autoApproveTimeout as number | null) || null,
            needsTools: (planData.needsTools as boolean) || (planData.needsRealtimeData as boolean) || false
        };

        console.log('[Orchestrator] Plan generated with local model:', plan);
        return plan;
    } catch (error) {
        console.error('[Orchestrator] Analysis failed:', error);
        // Return fallback plan on error
        return createFallbackPlan(userMessage, availableTools || []);
    }
}

/**
 * Creates a direct cloud plan when local model is not available
 * Bypasses local analysis and goes straight to cloud execution
 */
function createDirectCloudPlan(userMessage: string, tools: LLMTool[]): PlanningResponse {
    const platform = getCurrentPlatform();
    let reasoning = 'Using cloud AI (local model unavailable)';
    
    // Add platform-specific context
    switch (platform) {
        case 'linux':
            reasoning += ' (WebGPU may require Vulkan drivers on Linux)';
            break;
        case 'windows':
            reasoning += ' (WebGPU requires DirectX 12 support)';
            break;
        case 'macos':
            reasoning += ' (WebGPU requires macOS 13.0+ with Metal support)';
            break;
        default:
            reasoning += ' (WebGPU not available or unsupported)';
    }
    
    return {
        type: 'plan',
        complexity: 'moderate',
        intent: userMessage,
        plan: [
            {
                stepNumber: 1,
                description: 'Process your request with cloud AI',
                requiresLLM: true,
                estimatedTime: 3,
            },
        ],
        suggestedTools: [],
        recommendedProvider: 'cloud',
        reasoning,
        requiresConfirmation: false, // Always auto-execute for direct cloud
        autoApproveTimeout: 5, // Quick auto-approve for cloud requests
    };
}

/**
 * Creates a fallback plan when analysis fails
 */
function createFallbackPlan(userMessage: string, _tools: LLMTool[]): PlanningResponse {
    const platform = getCurrentPlatform();
    let reasoning = 'Using cloud AI for reliability';
    
    // Add platform-specific context
    switch (platform) {
        case 'linux':
            reasoning += ' (WebGPU may require Vulkan drivers on Linux)';
            break;
        case 'windows':
            reasoning += ' (WebGPU requires DirectX 12 support)';
            break;
        case 'macos':
            reasoning += ' (WebGPU requires macOS 13.0+ with Metal support)';
            break;
        default:
            reasoning += ' (WebGPU not available or unsupported)';
    }
    
    // Check if this is a simple request that doesn't need confirmation
    const isSimpleRequest = /^(hi|hello|hey|what(\s+can\s+you\s+do)|how\s+are|thanks|bye|goodbye)/i.test(userMessage.trim());
    
    return {
        type: 'plan',
        complexity: 'moderate',
        intent: userMessage,
        plan: [
            {
                stepNumber: 1,
                description: 'Process your request',
                requiresLLM: true,
                estimatedTime: 5,
            },
        ],
        suggestedTools: [],
        recommendedProvider: 'cloud',
        reasoning,
        requiresConfirmation: !isSimpleRequest,
        autoApproveTimeout: isSimpleRequest ? 3 : null,
    };
}

/**
 * Checks if local model is ready for orchestration
 */
export function isOrchestratorReady(): boolean {
    const status = getWebLLMStatus();
    return status.isSupported && status.isLoaded;
}

/**
 * Gets orchestrator status for UI display
 */
export function getOrchestratorStatus(): {
    ready: boolean;
    loading: boolean;
    error: string | null;
} {
    const status = getWebLLMStatus();
    return {
        ready: status.isLoaded,
        loading: status.isLoading,
        error: status.error,
    };
}

/**
 * Quickly classifies a message as simple (can skip planning UI)
 */
export function isLikelySimpleTask(message: string): boolean {
    // We now let the LLM decide everything.
    // This function can be deprecated once all call sites are removed.
    return false;
}
