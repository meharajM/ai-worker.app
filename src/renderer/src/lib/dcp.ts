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
  const toolCallDefinitions = new Map<string, string>();
  const signatureToLastId = new Map<string, string>();
  const allIdsForSignature = new Map<string, Set<string>>();

  // 1 & 2. Single pass: Map tool_call_id to signature, and track all IDs per signature
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    if (msg.role === 'assistant' && msg.tool_calls) {
      for (const call of msg.tool_calls) {
        // Fast signature (we omit sorting keys for speed, LLM output is usually consistent)
        const argsStr = JSON.stringify(call.function.arguments || {});
        const signature = `${call.function.name}:${argsStr}`;
        
        toolCallDefinitions.set(call.id, signature);
        signatureToLastId.set(signature, call.id);

        let ids = allIdsForSignature.get(signature);
        if (!ids) {
            ids = new Set();
            allIdsForSignature.set(signature, ids);
        }
        ids.add(call.id);
      }
    }
  }

  // 3. Identify IDs that should be pruned
  const idsToPrune = new Set<string>();
  
  for (const [signature, ids] of allIdsForSignature.entries()) {
    if (ids.size > 1) {
      // Keep the last one, prune the rest
      const lastId = signatureToLastId.get(signature);
      for (const id of ids) {
        if (id !== lastId) {
          idsToPrune.add(id);
        }
      }
    }
  }

  // FAST PATH: If nothing to prune, return the original array reference!
  // This saves massive GC churn and React re-renders since the array identity stays exactly the same.
  if (idsToPrune.size === 0) {
      return messages;
  }

  // 4. Create new messages array with pruned content, ONLY if we actually change something
  let changed = false;
  const newMessages = messages.map((msg) => {
    if (msg.role === 'tool' && msg.tool_call_id && idsToPrune.has(msg.tool_call_id)) {
      if (msg.content === "[Redundant Tool Output Pruned by DCP]") {
          return msg; // Already pruned previously
      }
      changed = true;
      return {
        ...msg,
        content: "[Redundant Tool Output Pruned by DCP]",
      };
    }
    return msg;
  });

  return changed ? newMessages : messages;
}
