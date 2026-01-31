
import { generateSubAgentInstruction } from '../src/renderer/src/lib/task-decomposer';

// Mock the AgentRuntime's formatParallelResults logic (copied from agent-runtime.ts)
// We need to see what the current implementation produces.

function mockFormatParallelResults(contexts: string[], results: { context: string; success: boolean; result: string }[]) {
  const successfulResults = results.filter(r => r.success);
  const failedResults = results.filter(r => !r.success);

  let summary = `## Results from ${contexts.length} sources\n\n`;

  for (const result of successfulResults) {
    summary += `### ${result.context}\n${result.result}\n\n`;
  }

  if (failedResults.length > 0) {
    summary += `### ⚠️ Failed Sources\n`;
    for (const result of failedResults) {
      summary += `- **${result.context}**: ${result.result}\n`;
    }
  }

  if (successfulResults.length > 1) {
    summary += `\n---\n\n*Parallel execution complete: ${successfulResults.length}/${contexts.length} sources succeeded.*`;
  }

  return summary;
}

async function runTest() {
  console.log('--- TEST: Parallel Execution Output Formatting ---\n');

  const contexts = ['amazon', 'bestbuy'];
  
  // Simulate results from sub-agents (as if they followed the prompt in generateSubAgentInstruction)
  const results = [
    {
      context: 'amazon',
      success: true,
      result: '- **Sony WH-1000XM5** – INR 25,587.85 (30% off)\n- New, in stock, Prime-eligible\n- Features: Auto NC Optimizer, 30h battery\n- ✓ amazon complete'
    },
    {
      context: 'bestbuy',
      success: true,
      result: '- **Sony WH-1000XM5** – $399.99 (online & in-store)\n- Immediate shipping or store pickup\n- Key features: noise cancellation, 30-hour battery\n- ✓ bestbuy complete'
    }
  ];

  const formattedOutput = mockFormatParallelResults(contexts, results);
  
  console.log(formattedOutput);
  console.log('\n--------------------------------------------------');
  
  // Also check the instruction generator to see if it enforces the right format
  console.log('\n--- TEST: Sub-Agent Instructions ---\n');
  const instruction = generateSubAgentInstruction(
    "Compare the price of Sony WH-1000XM5", 
    "amazon", 
    contexts
  );
  console.log(instruction);
}

runTest();
