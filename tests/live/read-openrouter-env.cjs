const fs = require('node:fs');
const path = require('node:path');

function parseEnvFile(content) {
  const values = {};
  for (const rawLine of content.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1).trim().replace(/^['"]|['"]$/g, '');
    values[key] = value;
  }
  return values;
}

function isPlaceholder(value) {
  if (!value) return true;
  const normalized = String(value).trim().toLowerCase();
  return (
    normalized.includes('replace_with') ||
    normalized.includes('your_') ||
    normalized.includes('example') ||
    normalized.includes('dummy') ||
    normalized.includes('changeme') ||
    normalized === 'sk-placeholder'
  );
}

function readOpenRouterEnv() {
  const envPath = path.join(__dirname, '.env.local');
  const fileValues = fs.existsSync(envPath) ? parseEnvFile(fs.readFileSync(envPath, 'utf8')) : {};

  const rawApiKey = process.env.AIW_OPENROUTER_API_KEY || fileValues.AIW_OPENROUTER_API_KEY || '';
  const rawModel = process.env.AIW_OPENROUTER_MODEL || fileValues.AIW_OPENROUTER_MODEL || '';
  const baseUrl =
    process.env.AIW_OPENROUTER_BASE_URL || fileValues.AIW_OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1';
  const apiKey = isPlaceholder(rawApiKey) ? '' : rawApiKey;
  const model = isPlaceholder(rawModel) ? '' : rawModel;

  return { apiKey, model, baseUrl, isConfigured: Boolean(apiKey && model) };
}

module.exports = { readOpenRouterEnv };
