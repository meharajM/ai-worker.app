const assert = require('node:assert/strict');
const { readOpenRouterEnv } = require('./read-openrouter-env.cjs');

function isNetworkUnavailableError(error) {
  const code = error?.code || error?.cause?.code;
  return code === 'ENOTFOUND' || code === 'EAI_AGAIN' || code === 'ECONNREFUSED' || code === 'ETIMEDOUT';
}

async function main() {
  const { apiKey, model, baseUrl, isConfigured } = readOpenRouterEnv();

  if (!isConfigured) {
    console.log('SKIP live_llm_smoke: missing real AIW_OPENROUTER_API_KEY or AIW_OPENROUTER_MODEL');
    process.exit(0);
  }

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model,
      max_tokens: 60,
      temperature: 0,
      messages: [
        { role: 'system', content: 'Reply in one short sentence.' },
        { role: 'user', content: 'Say "live smoke ok".' }
      ]
    })
  });

  assert.equal(response.status, 200, `Expected 200, got ${response.status}`);
  const payload = await response.json();
  const text = payload?.choices?.[0]?.message?.content || '';
  assert.ok(typeof text === 'string' && text.length > 0, 'Missing text response from OpenRouter');
  console.log(`live_llm_smoke passed using model=${model}`);
}

main().catch((error) => {
  if (isNetworkUnavailableError(error)) {
    console.log(`SKIP live_llm_smoke: network unavailable (${error?.cause?.code || error?.code})`);
    process.exit(0);
  }
  console.error('live_llm_smoke failed:', error);
  process.exit(1);
});
