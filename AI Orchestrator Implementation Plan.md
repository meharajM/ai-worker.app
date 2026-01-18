# AI Orchestrator Implementation Plan
**Privacy-First AI Agent with Local Intelligence & Seamless Cloud Scaling**

---

## 🎯 User Experience Vision

**For Non-Technical Users:**

1. **Zero Configuration Required**
   - App downloads local AI model silently on first launch
   - Shows friendly message: "Getting your AI ready... This only happens once"
   - User can start chatting immediately while download happens in background

2. **Invisible Intelligence**
   - User types or speaks a request
   - AI thinks for 1-2 seconds, shows: "Understanding your request..."
   - Shows a **simple, friendly plan** in plain English: "Here's what I'll do..."
   - User clicks **green "Go" button** or just waits (auto-proceed in 5 seconds for simple tasks)

3. **Graceful Scaling**
   - Local AI handles simple tasks (questions, basic searches, file operations)
   - For complex tasks, shows: "This needs more power. Using cloud AI with your permission."
   - User clicks "Use Cloud" → request sent to cloud model
   - If local AI gives bad answer, user clicks "Try Better AI" → regenerates with cloud

4. **Visual Feedback**
   - Progress indicator: "Searching files..." "Reading document..." "Analyzing data..."
   - Tool usage shown as friendly icons (not technical JSON)
   - Clear "This was done locally" vs "This used cloud" labels

---

## 📐 Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                         USER INTERFACE                          │
│  (VoiceInput, ChatView, MessageBubble, PlanCard)               │
└────────────────┬────────────────────────────────────────────────┘
                 │
                 │ User sends message
                 ▼
┌─────────────────────────────────────────────────────────────────┐
│                        CHAT STORE                               │
│  - Manages conversation state                                  │
│  - Triggers orchestration                                      │
│  - Stores plans and execution results                          │
└────────────────┬────────────────────────────────────────────────┘
                 │
                 │ Calls analyzeAndPlan()
                 ▼
┌─────────────────────────────────────────────────────────────────┐
│                       ORCHESTRATOR                              │
│  - Calls local WebLLM (Qwen) for analysis                      │
│  - Determines complexity: simple/moderate/complex               │
│  - Generates execution plan                                    │
│  - Recommends provider: local/cloud                            │
└────────────────┬────────────────────────────────────────────────┘
                 │
                 │ Returns PlanningResponse
                 ▼
┌─────────────────────────────────────────────────────────────────┐
│                      PLAN REVIEW UI                             │
│  - Shows plan in friendly language                             │
│  - "Go" / "Edit" / "Cancel" buttons                            │
│  - Auto-proceeds for simple tasks (5s timer)                   │
└────────────────┬────────────────────────────────────────────────┘
                 │
                 │ User approves → executePlan()
                 ▼
┌─────────────────────────────────────────────────────────────────┐
│                         EXECUTOR                                │
│  - Executes plan steps sequentially                            │
│  - Calls LLM provider (local or cloud)                         │
│  - Executes tools via MCP                                      │
│  - Handles errors gracefully                                   │
└────────────────┬────────────────────────────────────────────────┘
                 │
         ┌───────┴────────┐
         ▼                ▼
┌─────────────────┐  ┌─────────────────┐
│   LLM PROVIDER  │  │   MCP CLIENT    │
│  (llm.ts)       │  │   (mcp.ts)      │
│  - WebLLM       │  │   - Tools       │
│  - Ollama       │  │   - Servers     │
│  - OpenAI       │  │                 │
│  - Gemini       │  │                 │
└─────────────────┘  └─────────────────┘
```

---

## 📦 New Files to Create

### 1. `src/renderer/src/lib/orchestrator.ts`
**Purpose**: Analyzes user requests using local AI and generates execution plans.

### 2. `src/renderer/src/lib/executor.ts`
**Purpose**: Executes approved plans by calling LLMs and MCP tools.

### 3. `src/renderer/src/components/PlanCard.tsx`
**Purpose**: Displays plan for user review with approve/reject/edit actions.

### 4. `src/renderer/src/types/orchestrator.ts`
**Purpose**: TypeScript interfaces for planning and execution.

---

## 🔧 Detailed Implementation Specification

---

## Phase 1: Type Definitions & Core Interfaces

### File: `src/renderer/src/types/orchestrator.ts`

```typescript
/**
 * Orchestrator Type Definitions
 * Defines the contract between orchestrator, chat store, and UI components.
 */

export type TaskComplexity = 'simple' | 'moderate' | 'complex';
export type RecommendedProvider = 'local' | 'cloud';
export type PlanStatus = 'pending' | 'approved' | 'rejected' | 'executing' | 'completed' | 'failed';

/**
 * A single step in an execution plan
 */
export interface PlanStep {
  /** Step number (1, 2, 3...) */
  stepNumber: number;
  
  /** Human-readable description: "Search for recent files" */
  description: string;
  
  /** Optional tool to use: "filesystem_list_directory" */
  toolName?: string;
  
  /** Whether this step requires LLM reasoning */
  requiresLLM: boolean;
  
  /** Estimated time in seconds */
  estimatedTime?: number;
}

/**
 * Analysis result from orchestrator
 */
export interface PlanningResponse {
  /** Discriminator for message type */
  type: 'plan';
  
  /** Task complexity level */
  complexity: TaskComplexity;
  
  /** Cleaned/corrected user intent */
  intent: string;
  
  /** Execution plan steps */
  plan: PlanStep[];
  
  /** Tools that will be used */
  suggestedTools: string[];
  
  /** Recommended provider */
  recommendedProvider: RecommendedProvider;
  
  /** Reasoning for complexity assessment */
  reasoning: string;
  
  /** Whether user confirmation is required (false for simple tasks) */
  requiresConfirmation: boolean;
  
  /** Auto-approve timeout in seconds (null if requires confirmation) */
  autoApproveTimeout?: number;
}

/**
 * Execution context for plan execution
 */
export interface ExecutionContext {
  /** The approved plan */
  plan: PlanningResponse;
  
  /** Provider to use (may differ from recommendation if user overrides) */
  provider: 'local' | 'cloud';
  
  /** Original user message */
  userMessage: string;
  
  /** Available MCP tools */
  availableTools: Array<{ name: string; description: string; parameters: Record<string, unknown> }>;
  
  /** Abort signal for cancellation */
  abortSignal?: AbortSignal;
}

/**
 * Result of plan execution
 */
export interface ExecutionResult {
  /** Whether execution succeeded */
  success: boolean;
  
  /** Final response content */
  content: string;
  
  /** Steps that were executed */
  executedSteps: Array<{
    stepNumber: number;
    success: boolean;
    result?: string;
    error?: string;
    duration: number;
  }>;
  
  /** Provider that was used */
  provider: string;
  
  /** Model that was used */
  model: string;
  
  /** Total execution time */
  totalDuration: number;
  
  /** Error message if failed */
  error?: string;
}
```

---

## Phase 2: Orchestrator Implementation

### File: `src/renderer/src/lib/orchestrator.ts`

```typescript
/**
 * AI Orchestrator
 * 
 * Uses local WebLLM (Qwen) to analyze user requests and generate execution plans.
 * Determines task complexity and recommends local vs cloud execution.
 */

import { chatWithWebLLM, getWebLLMStatus, loadWebLLMModel } from './webllm';
import type { PlanningResponse, TaskComplexity } from '../types/orchestrator';
import type { LLMTool } from './llm';

/**
 * System prompt for plan generation
 * Instructs Qwen to output structured JSON with plan details
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
  "autoApproveTimeout": 5 or null
}

**Complexity Guidelines:**
- **simple**: Greetings, basic questions, single-step tasks, no external data needed
  - Examples: "Hello", "What time is it?", "Tell me a joke"
  - Provider: local
  - Confirmation: false, auto-approve in 5 seconds
  
- **moderate**: Multi-step tasks, tool usage, local file operations
  - Examples: "List files in Documents", "Search my notes for 'meeting'"
  - Provider: local (if tools available) or cloud
  - Confirmation: true
  
- **complex**: Deep reasoning, code generation, multiple tool orchestration, external APIs
  - Examples: "Analyze this CSV and create a report", "Build a Python script to..."
  - Provider: cloud
  - Confirmation: true

**Tool Selection:**
Only suggest tools that are in the available tools list. If user needs a tool that isn't available, explain in the plan.

**Important:**
- Keep descriptions friendly and non-technical
- Be honest about capabilities
- Prefer local execution when possible (privacy)`;

/**
 * Analyzes a user request and generates an execution plan
 * 
 * @param userMessage - The user's input message
 * @param availableTools - MCP tools that can be used
 * @returns Planning response with execution plan
 */
export async function analyzeRequest(
  userMessage: string,
  availableTools: LLMTool[]
): Promise<PlanningResponse> {
  try {
    // Ensure local model is loaded
    const status = getWebLLMStatus();
    if (!status.isLoaded) {
      console.log('[Orchestrator] Loading WebLLM model for analysis...');
      await loadWebLLMModel();
    }

    // Build tool list for context
    const toolContext = availableTools.length > 0
      ? `\n\nAvailable tools:\n${availableTools.map(t => `- ${t.name}: ${t.description}`).join('\n')}`
      : '\n\nNo tools currently available. User should connect MCP servers for tool usage.';

    // Call local model for analysis
    const response = await chatWithWebLLM([
      { role: 'system', content: PLANNING_SYSTEM_PROMPT + toolContext },
      { role: 'user', content: `Analyze this request and create a plan:\n\n"${userMessage}"` }
    ]);

    // Parse JSON response
    let planData: any;
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
      // Fallback to moderate complexity with cloud provider
      return createFallbackPlan(userMessage, availableTools);
    }

    // Validate and normalize
    const plan: PlanningResponse = {
      type: 'plan',
      complexity: planData.complexity || 'moderate',
      intent: planData.intent || userMessage,
      plan: planData.plan || [
        {
          stepNumber: 1,
          description: 'Process request',
          requiresLLM: true,
          estimatedTime: 3
        }
      ],
      suggestedTools: planData.suggestedTools || [],
      recommendedProvider: planData.recommendedProvider || 'cloud',
      reasoning: planData.reasoning || 'Automatic fallback analysis',
      requiresConfirmation: planData.requiresConfirmation ?? true,
      autoApproveTimeout: planData.autoApproveTimeout || null
    };

    console.log('[Orchestrator] Plan generated:', plan);
    return plan;

  } catch (error) {
    console.error('[Orchestrator] Analysis failed:', error);
    // Return fallback plan on error
    return createFallbackPlan(userMessage, availableTools);
  }
}

/**
 * Creates a fallback plan when analysis fails
 */
function createFallbackPlan(userMessage: string, tools: LLMTool[]): PlanningResponse {
  return {
    type: 'plan',
    complexity: 'moderate',
    intent: userMessage,
    plan: [
      {
        stepNumber: 1,
        description: 'Process your request',
        requiresLLM: true,
        estimatedTime: 5
      }
    ],
    suggestedTools: [],
    recommendedProvider: 'cloud',
    reasoning: 'Using cloud AI for reliability',
    requiresConfirmation: true,
    autoApproveTimeout: null
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
    error: status.error
  };
}
```

---

## Phase 3: Executor Implementation

### File: `src/renderer/src/lib/executor.ts`

```typescript
/**
 * Plan Executor
 * 
 * Executes approved plans by calling LLMs and MCP tools.
 */

import type { ExecutionContext, ExecutionResult } from '../types/orchestrator';
import { chat, type LLMMessage, type LLMSettings } from './llm';
import electron from './electron';

/**
 * Executes an approved plan
 */
export async function executePlan(
  context: ExecutionContext,
  settings: LLMSettings,
  onProgress?: (step: number, description: string) => void
): Promise<ExecutionResult> {
  const startTime = Date.now();
  const executedSteps: ExecutionResult['executedSteps'] = [];

  try {
    const messages: LLMMessage[] = [
      {
        role: 'system',
        content: buildExecutionSystemPrompt(context)
      },
      {
        role: 'user',
        content: context.userMessage
      }
    ];

    // Simple tasks: single LLM call
    if (context.plan.suggestedTools.length === 0) {
      onProgress?.(1, 'Processing...');
      
      const stepStart = Date.now();
      const response = await chat(
        messages,
        context.availableTools,
        {
          ...settings,
          preferredProvider: context.provider === 'local' ? 'browser' : settings.preferredProvider
        }
      );

      executedSteps.push({
        stepNumber: 1,
        success: true,
        result: response.content,
        duration: Date.now() - stepStart
      });

      return {
        success: true,
        content: response.content,
        executedSteps,
        provider: response.provider,
        model: response.model,
        totalDuration: Date.now() - startTime
      };
    }

    // Complex tasks: step-by-step execution
    let finalResponse = '';
    
    for (const step of context.plan.plan) {
      if (context.abortSignal?.aborted) {
        throw new Error('Cancelled by user');
      }

      onProgress?.(step.stepNumber, step.description);

      const stepStart = Date.now();

      try {
        if (step.toolName) {
          // Execute tool
          const toolResult = await executeTool(step.toolName, messages, context, settings);
          
          messages.push({
            role: 'tool',
            content: toolResult,
            tool_call_id: `tool_${step.stepNumber}`,
            name: step.toolName
          });

          executedSteps.push({
            stepNumber: step.stepNumber,
            success: true,
            result: toolResult,
            duration: Date.now() - stepStart
          });

        } else if (step.requiresLLM) {
          // LLM reasoning
          const response = await chat(
            messages,
            context.availableTools,
            {
              ...settings,
              preferredProvider: context.provider === 'local' ? 'browser' : settings.preferredProvider
            }
          );

          messages.push({
            role: 'assistant',
            content: response.content
          });

          finalResponse = response.content;

          executedSteps.push({
            stepNumber: step.stepNumber,
            success: true,
            result: response.content,
            duration: Date.now() - stepStart
          });
        }

      } catch (stepError) {
        executedSteps.push({
          stepNumber: step.stepNumber,
          success: false,
          error: stepError instanceof Error ? stepError.message : 'Unknown',
          duration: Date.now() - stepStart
        });
        throw stepError;
      }
    }

    return {
      success: true,
      content: finalResponse,
      executedSteps,
      provider: context.provider,
      model: settings.preferredProvider || 'auto',
      totalDuration: Date.now() - startTime
    };

  } catch (error) {
    return {
      success: false,
      content: '',
      executedSteps,
      provider: context.provider,
      model: settings.preferredProvider || 'auto',
      totalDuration: Date.now() - startTime,
      error: error instanceof Error ? error.message : 'Execution failed'
    };
  }
}

async function executeTool(
  toolName: string,
  conversationHistory: LLMMessage[],
  context: ExecutionContext,
  settings: LLMSettings
): Promise<string> {
  // Ask LLM to generate tool arguments
  const response = await chat(
    [
      ...conversationHistory,
      {
        role: 'system',
        content: `Call the tool "${toolName}" with appropriate arguments.`
      }
    ],
    context.availableTools,
    { preferredProvider: context.provider === 'local' ? 'browser' : 'auto' }
  );

  if (response.toolCalls && response.toolCalls.length > 0) {
    const toolCall = response.toolCalls[0];
    const result = await electron.mcp.callTool(toolCall.name, toolCall.arguments);
    return result.content || JSON.stringify(result);
  }

  throw new Error(`LLM did not generate tool call for ${toolName}`);
}

function buildExecutionSystemPrompt(context: ExecutionContext): string {
  return `You are executing this plan:

${context.plan.plan.map((s, i) => `${i + 1}. ${s.description}`).join('\n')}

Execute faithfully. Use tools when specified.`;
}
```

---

## Phase 4: Chat Store Integration

### File: `src/renderer/src/stores/chatStore.ts` (Modifications)

Add to existing `ChatState` interface:

```typescript
  // NEW: Orchestration state
  currentPlan: PlanningResponse | null;
  planningPhase: 'idle' | 'analyzing' | 'waiting_approval' | 'executing';
  executionProgress: { step: number; description: string } | null;
  
  // NEW: Orchestration actions
  analyzeAndPlan: (userMessage: string) => Promise<void>;
  approvePlan: () => Promise<void>;
  rejectPlan: () => void;
  editPlan: (editedPlan: PlanningResponse) => void;
  regenerateWithCloud: (messageId: string) => Promise<void>;
```

---

## Phase 5: UI Components

### File: `src/renderer/src/components/PlanCard.tsx`

```typescript
import React, { useState, useEffect } from 'react';
import { Check, X, Edit2, Clock, Zap, Cloud } from 'lucide-react';
import type { PlanningResponse } from '../types/orchestrator';

interface PlanCardProps {
  plan: PlanningResponse;
  onApprove: () => void;
  onReject: () => void;
  onEdit?: (edited: PlanningResponse) => void;
  autoApproving?: boolean;
}

export function PlanCard({ plan, onApprove, onReject, onEdit, autoApproving }: PlanCardProps) {
  const [countdown, setCountdown] = useState(plan.autoApproveTimeout || 0);
  const [isExpanded, setIsExpanded] = useState(false);

  useEffect(() => {
    if (!autoApproving || !plan.autoApproveTimeout) return;

    const timer = setInterval(() => {
      setCountdown(prev => {
        if (prev <= 1) {
          clearInterval(timer);
          onApprove();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [autoApproving, plan.autoApproveTimeout, onApprove]);

  const complexityColor = {
    simple: 'text-green-400',
    moderate: 'text-yellow-400',
    complex: 'text-orange-400'
  }[plan.complexity];

  const ComplexityIcon = {
    simple: Zap,
    moderate: Clock,
    complex: Cloud
  }[plan.complexity];

  return (
    <div className="bg-gradient-to-br from-[#1a1d23] to-[#252930] border border-white/10 rounded-2xl p-6 space-y-4 shadow-xl">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${plan.complexity === 'simple' ? 'from-green-500 to-emerald-600' : plan.complexity === 'moderate' ? 'from-yellow-500 to-orange-500' : 'from-purple-500 to-pink-500'} flex items-center justify-center shadow-lg`}>
            <ComplexityIcon size={20} className="text-white" />
          </div>
          <div>
            <h3 className="text-lg font-semibold">Here's my plan</h3>
            <p className={`text-sm ${complexityColor} flex items-center gap-1.5 mt-0.5`}>
              <span className="capitalize">{plan.complexity}</span> task
              {plan.recommendedProvider === 'cloud' && (
                <span className="text-white/40">• Cloud AI</span>
              )}
            </p>
          </div>
        </div>

        {autoApproving && countdown > 0 && (
          <div className="text-sm text-white/40 flex items-center gap-2">
            <Clock size={14} />
            {countdown}s
          </div>
        )}
      </div>

      {/* Intent */}
      <div className="bg-white/5 rounded-xl p-4">
        <p className="text-white/80 italic">"{plan.intent}"</p>
      </div>

      {/* Steps */}
      <div className="space-y-2">
        <div
          className="flex items-center justify-between cursor-pointer text-sm text-white/60 hover:text-white/80"
          onClick={() => setIsExpanded(!isExpanded)}
        >
          <span>Steps ({plan.plan.length})</span>
          <span>{isExpanded ? '▼' : '▶'}</span>
        </div>

        {(isExpanded || plan.plan.length <= 3) && (
          <div className="space-y-2">
            {plan.plan.map((step, idx) => (
              <div
                key={idx}
                className="flex gap-3 items-start bg-white/5 rounded-lg p-3"
              >
                <div className="w-6 h-6 rounded-full bg-[#00a896] flex items-center justify-center flex-shrink-0 text-white text-xs font-bold">
                  {step.stepNumber}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-white/90">{step.description}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="flex gap-3 pt-2">
        <button
          onClick={onApprove}
          className="flex-1 bg-gradient-to-r from-green-500 to-emerald-600 hover:from-green-600 hover:to-emerald-700 text-white font-semibold py-3 px-4 rounded-xl flex items-center justify-center gap-2 shadow-lg transition-all"
        >
          <Check size={18} />
          {countdown > 0 ? `Go (${countdown}s)` : 'Go'}
        </button>

        <button
          onClick={onReject}
          className="px-4 py-3 rounded-xl border border-white/10 hover:border-red-400/50 hover:bg-red-500/10 text-white/60 hover:text-red-400 transition-all flex items-center gap-2"
        >
          <X size={18} />
        </button>
      </div>

      {plan.recommendedProvider === 'local' && (
        <div className="text-xs text-white/30 text-center">
          🔒 Runs locally (private)
        </div>
      )}
    </div>
  );
}
```

---

## Phase 6: Background Model Download

### File: `src/renderer/src/App.tsx` (Modifications)

Add to `useEffect`:

```typescript
    const initModel = async () => {
      const status = getWebLLMStatus();
      if (status.isSupported && !status.isLoaded && status.downloadedModels.length === 0) {
        setShowToast(true);
        setToastType('downloading');
        try {
          await loadWebLLMModel();
          setToastType('ready');
          setTimeout(() => setShowToast(false), 3000);
        } catch (error) {
          console.error('Model download failed:', error);
          setShowToast(false);
        }
      }
    };
    initModel();
```

---

## 📋 Complete Validation Checklist

### Core Functionality ✅
- [ ] Orchestrator analyzes requests and generates plans
- [ ] Plans include complexity, steps, and provider recommendation
- [ ] Simple tasks auto-approve after countdown
- [ ] Complex tasks require user confirmation
- [ ] Plan execution calls correct LLM provider
- [ ] Tools execute via MCP when specified
- [ ] Errors handled gracefully throughout

### User Experience ✅
- [ ] Plan card displays beautifully
- [ ] Countdown timer visible and accurate
- [ ] "Go" button executes plan
- [ ] "Cancel" button rejects plan
- [ ] "Try Better AI" regenerates with cloud
- [ ] Progress indicator shows during execution
- [ ] Privacy labels ("local" vs "cloud") visible

### Background Download ✅
- [ ] Model downloads silently on first launch
- [ ] Toast shows friendly progress message
- [ ] No page freezing during download
- [ ] Success notification on completion

---

**Ready for implementation.**
