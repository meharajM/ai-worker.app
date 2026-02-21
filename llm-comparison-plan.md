# Default LLM Selection: Implementation Plan & Research

## Goal
Identify and recommend the absolute "best" LLM to use as the default for the AI-Worker application. The selection prioritizes **tool calling reliability**, **reasoning capability**, **privacy**, and **cost**.

## Research Findings

### 1. Privacy-Focused (Paid, No Training)
**Winner: Anthropic Claude 3.5 Sonnet**
- **Provider**: **Anthropic API** (Direct) or **AWS Bedrock**.
- **Why**: Direct API guarantees zero data retention for training. AWS Bedrock offers even stricter enterprise-grade compliance (HIPAA/GDPR).
- **Cost**: Moderate ($3/1M input tokens).

**Runner Up: OpenAI GPT-4o**
- **Provider**: **OpenAI API** (Direct) or **Azure OpenAI**.
- **Why**: Enterprise standard. Azure offers private networking options.

### 2. Budget-Friendly / Open Source (Non-Privacy)
**Winner: DeepSeek V3**
- **Provider**: **DeepSeek API** (Direct) or **OpenRouter** (Aggregator).
- **Why**: Direct API is cheapest (~$0.14/1M input tokens), but OpenRouter offers better uptime/failover.
- **Cost**: Extremely cheap (~20x cheaper than Claude). Rivals GPT-4o in reasoning.

**Runner Up: Llama 3.3 70B**
- **Provider**: **Groq** or **Cerebras**.
- **Why**: Speed. Groq/Cerebras run models on custom silicon (LPU/Wafer-Scale), delivering 1000+ tokens/sec. Ideal for near-instant tool loops.

### 3. Local (Maximum Privacy & Free)
**Winner: Qwen 2.5 (14B)**
- **Provider**: **Ollama** or **LM Studio**.
- **Why**: Ollama is the easiest "one-click" setup. Qwen 2.5 14B fits on consumer GPUs (8-12GB VRAM) and outperforms Llama 3.1 8B in coding benchmarks.

## Recommendations
1.  **Default Cloud**: Set `OPENROUTER.DEFAULT_MODEL` to `deepseek/deepseek-chat` (via OpenRouter).
2.  **Privacy Profile**: Add `ANTHROPIC_DIRECT` config for Claude 3.5 Sonnet.
3.  **Local Default**: Keep `OLLAMA` with `qwen2.5:14b` (or `7b` fallback).
4.  **Speed Profile**: Add `GROQ` provider for Llama 3.3 70B (Optional future feature).

## Implementation Plan
1.  **Update `src/renderer/src/lib/constants.ts`**:
    -   Set `OPENROUTER.DEFAULT_MODEL` to `deepseek/deepseek-chat`.
    -   Update `OLLAMA.DEFAULT_MODEL` to `qwen2.5:14b`.
    -   Add `ANTHROPIC` configuration block.
2.  **Update `src/renderer/src/lib/llm.ts`**:
    -   Add `getAnthropicSettings` helper.
    -   Update `LLM_CONFIG` interface to support direct Anthropic keys.
