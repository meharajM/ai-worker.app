const assert = require('node:assert/strict');
const { readOpenRouterEnv } = require('./read-openrouter-env.cjs');

function isNetworkUnavailableError(error) {
  const code = error?.code || error?.cause?.code;
  return code === 'ENOTFOUND' || code === 'EAI_AGAIN' || code === 'ECONNREFUSED' || code === 'ETIMEDOUT';
}

async function main() {
  const { apiKey, model, baseUrl, isConfigured } = readOpenRouterEnv();

  if (!isConfigured) {
    console.log('SKIP live_agent_partial_report: missing real AIW_OPENROUTER_API_KEY or AIW_OPENROUTER_MODEL');
    process.exit(0);
  }

  const prompt = `
You are validating agent partial-report formatting.
Given this run log:
- Completed: fs_list_directory("/workspace") returned 42 files
- Partial: extracted 3 product names from page text
- Error: browser_click("button.checkout") -> Element not found

Return markdown with EXACT headings:
#### Completed
#### Partial Findings
#### Failed / Blocked

Include the last error text in the Failed / Blocked section.
`;

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model,
      max_tokens: 220,
      temperature: 0,
      messages: [
        { role: 'system', content: 'Return only markdown.' },
        { role: 'user', content: prompt }
      ]
    })
  });

  assert.equal(response.status, 200, `Expected 200, got ${response.status}`);
  const payload = await response.json();
  const text = payload?.choices?.[0]?.message?.content || '';
  assert.ok(text.includes('#### Completed'), 'Missing Completed heading');
  assert.ok(text.includes('#### Partial Findings'), 'Missing Partial Findings heading');
  assert.ok(text.includes('#### Failed / Blocked'), 'Missing Failed / Blocked heading');
  assert.ok(/Element not found/i.test(text), 'Missing expected last error text');

  console.log(`live_agent_partial_report passed using model=${model}`);
}

main().catch((error) => {
  if (isNetworkUnavailableError(error)) {
    console.log(`SKIP live_agent_partial_report: network unavailable (${error?.cause?.code || error?.code})`);
    process.exit(0);
  }
  console.error('live_agent_partial_report failed:', error);
  process.exit(1);
});
