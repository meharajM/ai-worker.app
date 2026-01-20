import { LLMMessage } from "./types";

/**
 * Prunes redundant tool outputs from the message history to save context window.
 * 
 * Strategy:
 * 1. Identify all tool calls (name + arguments).
 * 2. Group them by identity (same tool called with same arguments).
 * 3. If a tool call is repeated, prune the output of the *earlier* instances,
 *    keeping only the latest one.
 * 
 * This treats the latest execution as the "source of truth" and assumes 
 * earlier readings of the same data are now redundant (or at least less important 
 * than the most recent one).
 */
export function pruneContext(messages: LLMMessage[]): LLMMessage[] {
  // 1. Map tool_call_id to its definition (name + args)
  const toolCallDefinitions = new Map<string, string>();
  
  for (const msg of messages) {
    if (msg.role === 'assistant' && msg.tool_calls) {
      for (const call of msg.tool_calls) {
        // Create a unique signature for this tool call configuration
        // We sort keys to ensure arguments object order doesn't matter
        const argsStr = JSON.stringify(call.function.arguments || {}, Object.keys(call.function.arguments || {}).sort());
        const signature = `${call.function.name}:${argsStr}`;
        toolCallDefinitions.set(call.id, signature);
      }
    }
  }

  // 2. Find which definitions have been executed multiple times
  // We want to know the *last* tool_call_id for each signature
  const signatureToLastId = new Map<string, string>();
  const allIdsForSignature = new Map<string, string[]>();

  // Iterate in order to find the last one
  // (We rely on toolCallDefinitions being populated in order, or we scan messages again? 
  //  Actually, we can just use the map we built, but we need to know the order of occurrence in messages)
  
  // Let's re-scan messages to be safe about order
  for (const msg of messages) {
    if (msg.role === 'assistant' && msg.tool_calls) {
      for (const call of msg.tool_calls) {
        const signature = toolCallDefinitions.get(call.id);
        if (signature) {
          signatureToLastId.set(signature, call.id);
          
          const existing = allIdsForSignature.get(signature) || [];
          existing.push(call.id);
          allIdsForSignature.set(signature, existing);
        }
      }
    }
  }

  // 3. Identify IDs that should be pruned
  const idsToPrune = new Set<string>();
  
  for (const [signature, ids] of allIdsForSignature.entries()) {
    if (ids.length > 1) {
      // Keep the last one, prune the rest
      const lastId = signatureToLastId.get(signature);
      for (const id of ids) {
        if (id !== lastId) {
          idsToPrune.add(id);
        }
      }
    }
  }

  // 4. Create new messages array with pruned content
  return messages.map((msg) => {
    // We only modify messages with role 'tool'
    if (msg.role === 'tool' && msg.tool_call_id) {
      if (idsToPrune.has(msg.tool_call_id)) {
        return {
          ...msg,
          content: "[Redundant Tool Output Pruned by DCP]",
        };
      }
    }
    return msg;
  });
}
