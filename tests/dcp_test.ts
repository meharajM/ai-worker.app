import { pruneContext } from "../src/renderer/src/lib/dcp";
import { LLMMessage } from "../src/renderer/src/lib/types";

function assert(condition: boolean, message: string) {
  if (!condition) {
    console.error(`❌ FAILED: ${message}`);
    process.exit(1);
  } else {
    console.log(`✅ PASSED: ${message}`);
  }
}

console.log("Starting DCP Test...");

// Test Case 1: No duplicates
const test1: LLMMessage[] = [
  { role: "user", content: "read file A" },
  { 
    role: "assistant", 
    content: "Reading file A...",
    tool_calls: [{ 
      id: "call_1", 
      function: { name: "read_file", arguments: { path: "A.txt" } } 
    }]
  },
  { role: "tool", tool_call_id: "call_1", content: "Content of A" },
];

const result1 = pruneContext(test1);
assert(result1.length === 3, "Length should be unchanged");
assert(result1[2].content === "Content of A", "Content should be preserved");


// Test Case 2: Duplicate tool call (same name + args)
const test2: LLMMessage[] = [
  // First access
  { role: "user", content: "read file A" },
  { 
    role: "assistant", 
    content: "Reading file A...",
    tool_calls: [{ 
      id: "call_1", 
      function: { name: "read_file", arguments: { path: "A.txt" } } 
    }]
  },
  { role: "tool", tool_call_id: "call_1", content: "Content of A (Old)" }, // Should be pruned
  
  // Some chat
  { role: "assistant", content: "Here is A" },
  { role: "user", content: "read it again" },

  // Second access (Duplicate)
  { 
    role: "assistant", 
    content: "Reading file A again...",
    tool_calls: [{ 
      id: "call_2", 
      function: { name: "read_file", arguments: { path: "A.txt" } } 
    }]
  },
  { role: "tool", tool_call_id: "call_2", content: "Content of A (New)" } // Should be kept
];

const result2 = pruneContext(test2);
assert(result2.length === 7, "Length should be unchanged (content distinct)");
assert(result2[2].content === "[Redundant Tool Output Pruned by DCP]", "First tool output should be pruned");
assert(result2[6].content === "Content of A (New)", "Second tool output should be kept");


// Test Case 3: Different args (should not prune)
const test3: LLMMessage[] = [
  { 
    role: "assistant", 
    content: "Reading file A...",
    tool_calls: [{ 
      id: "call_1", 
      function: { name: "read_file", arguments: { path: "A.txt" } } 
    }]
  },
  { role: "tool", tool_call_id: "call_1", content: "Content of A" },
  
  { 
    role: "assistant", 
    content: "Reading file B...",
    tool_calls: [{ 
      id: "call_2", 
      function: { name: "read_file", arguments: { path: "B.txt" } } 
    }]
  },
  { role: "tool", tool_call_id: "call_2", content: "Content of B" }
];

const result3 = pruneContext(test3);
assert(result3[1].content === "Content of A", "Tool A should be kept");
assert(result3[3].content === "Content of B", "Tool B should be kept");

console.log("All tests passed!");
