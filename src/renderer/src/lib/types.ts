export interface LLMMessage {
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  tool_calls?: any[];
  tool_call_id?: string;
  name?: string; // For Gemini/OpenAI tool names
}

export interface LLMTool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface ServerInfo {
  name: string;
  description: string;
  toolCount: number;
  isReasoningServer?: boolean; // True for servers that provide reasoning capabilities without traditional tools
}

export interface LLMResponse {
  content: string;
  toolCalls?: {
    id: string;
    name: string;
    arguments: Record<string, unknown>;
  }[];
  provider: string;
  model: string;
}

export type LLMProvider = "browser" | "ollama" | "openai" | "gemini" | "openrouter";

export interface LLMSettings {
  preferredProvider?: "auto" | "ollama" | "openai" | "browser" | "gemini" | "openrouter";
  ollamaModel?: string;
  ollamaBaseUrl?: string;
  openaiApiKey?: string;
  openaiBaseUrl?: string;
  openaiModel?: string;
  geminiApiKey?: string;
  geminiModel?: string;
  openrouterApiKey?: string;
  openrouterModel?: string;
}
