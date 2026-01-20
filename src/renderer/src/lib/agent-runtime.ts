import { chat } from "./llm";
import { LLMMessage, LLMTool, ServerInfo, type LLMResponse } from "./types";
import { pruneContext } from "./dcp";
import { executeToolCall, getAllTools, getServers } from "./mcp";
import { CLIENT_TOOLS } from "./client-tools";

export type AgentStatusCallback = (message: LLMMessage) => void;

interface AgentRuntimeOptions {
  activeSessionId?: string;
  settings: any;
  onMessage?: AgentStatusCallback;
  signal?: AbortSignal;
}

export class AgentRuntime {
  private messages: LLMMessage[] = [];
  private options: AgentRuntimeOptions;
  private maxIterations = 20;

  constructor(options: AgentRuntimeOptions, initialHistory: LLMMessage[] = []) {
    this.options = options;
    this.messages = [...initialHistory];
  }

  /**
   * Main entry point to run the agent loop.
   */
  async chat(userContent: string): Promise<LLMMessage> {
    const userMsg: LLMMessage = { role: "user", content: userContent };
    this.addMessage(userMsg);

    let iterationCount = 0;
    
    while (iterationCount < this.maxIterations) {
      if (this.options.signal?.aborted) {
        throw new Error("Aborted by user");
      }

      // 1. DCP: Prune context
      this.messages = pruneContext(this.messages);

      // 2. Prepare context
      const contextMessages = this.messages;

      // 3. Get Tools (MCP + Client)
      const mcpTools = getAllTools();
      const llmTools: LLMTool[] = mcpTools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        parameters: tool.inputSchema,
      }));

      // Add Client Tools (Sub-agent, etc.)
      const clientLlmTools: LLMTool[] = CLIENT_TOOLS.map((tool) => ({
        name: tool.name,
        description: tool.description,
        parameters: tool.inputSchema,
      }));

      const allTools = [...llmTools, ...clientLlmTools];
      
      const servers = getServers();
      const serverInfo: ServerInfo[] = servers
        .filter((server) => server.connected)
        .map((server) => {
           const isReasoningServer =
              server.name.includes("sequential-thinking") ||
              server.name.includes("sequential") ||
              server.description.toLowerCase().includes("reasoning");
              
           return {
             name: server.name,
             description: server.description.substring(0, 40),
             toolCount: server.tools.length,
             isReasoningServer,
           };
        });

      // 4. Call LLM
      console.log(`[AgentRuntime] Iteration ${iterationCount + 1}: Calling LLM...`);
      let response: LLMResponse;
      try {
        response = await chat(
            contextMessages,
            allTools.length > 0 ? allTools : undefined,
            this.options.settings,
            serverInfo.length > 0 ? serverInfo : undefined,
            this.options.signal
        );
      } catch (error) {
        console.error("[AgentRuntime] LLM Error:", error);
        throw error;
      }

      // 5. Check for Tool Calls
      if (!response.toolCalls || response.toolCalls.length === 0) {
        const assistantMsg: LLMMessage = {
          role: "assistant",
          content: response.content,
        };
        this.addMessage(assistantMsg);
        return assistantMsg;
      }

      // 6. Handle Tool Calls
      const assistantMsg: LLMMessage = {
        role: "assistant",
        content: response.content,
        tool_calls: response.toolCalls.map(tc => ({
          id: tc.id,
          type: "function",
          function: {
            name: tc.name,
            arguments: tc.arguments,
          }
        })) as any
      };
      this.addMessage(assistantMsg);

      // Execute tools
      for (const call of response.toolCalls) {
        if (this.options.signal?.aborted) break;

        console.log(`[AgentRuntime] Executing tool: ${call.name}`);
        
        let resultStr = "";
        
        // Check if it's a client-side tool
        if (call.name === 'delegate_sub_task') {
             const args = call.arguments as any;
             const instruction = args.instruction || "";
             const context = args.context || "";
             
             console.log(`[AgentRuntime] Delegating to sub-agent: ${instruction}`);
             
             // Create sub-agent with isolated context
             // We don't propagate onMessage to parent UI to avoid noise, 
             // but we could log it or have a special UI for it.
             const subAgent = new AgentRuntime({
                 ...this.options,
                 onMessage: (msg) => {
                     console.log(`[SubAgent] ${msg.role}: ${msg.content ? msg.content.substring(0,50) : '...'}`);
                 }
             });
             
             try {
                 const prompt = context 
                    ? `Context: ${context}\n\nTask: ${instruction}` 
                    : instruction;
                 
                 const finalRes = await subAgent.chat(prompt);
                 resultStr = `Sub-agent completed task.\n\nFinal Result:\n${finalRes.content}`;
             } catch (err: any) {
                 resultStr = `Sub-agent failed: ${err.message}`;
             }

        } else {
             // Standard MCP tool
             try {
                const result = await executeToolCall(call.name, call.arguments);
                if (result.error) {
                  resultStr = JSON.stringify({ error: result.error });
                } else {
                  resultStr = typeof result.result === 'string' 
                     ? result.result 
                     : JSON.stringify(result.result);
                }
             } catch (err: any) {
                resultStr = JSON.stringify({ error: err.message || "Unknown error" });
             }
        }

        // Add tool result
        this.addMessage({
          role: "tool",
          content: resultStr,
          tool_call_id: call.id
        });
      }

      iterationCount++;
    }

    throw new Error("Max iterations reached");
  }

  private addMessage(msg: LLMMessage) {
    this.messages.push(msg);
    if (this.options.onMessage) {
      this.options.onMessage(msg);
    }
  }

  getHistory(): LLMMessage[] {
    return this.messages;
  }
}
