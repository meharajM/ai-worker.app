export type LLMContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

export interface MessageAction {
  type: 'continue' | 'cancel' | 'custom';
  label: string;
  payload?: Record<string, unknown>;
}

export interface LLMMessage {
  role: "user" | "assistant" | "system" | "tool";
  content: string | LLMContentPart[];
  tool_calls?: any[];
  tool_call_id?: string;
  name?: string; // For Gemini/OpenAI tool names
  actions?: MessageAction[]; // For button-based interactions
  attachments?: { name: string; path: string; type: string }[]; // User-uploaded files
  thought?: string; // Gemini 2.0 reasoning — must be echoed back in subsequent turns
  thought_signature?: string; // Gemini tool-call integrity token — required to avoid 400 errors
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
  thought?: string;
  thought_signature?: string;
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
  geminiOAuthToken?: string;
  geminiOAuthHeaders?: Record<string, string>;
  openrouterApiKey?: string;
  openrouterModel?: string;
  browserModel?: string;
}
