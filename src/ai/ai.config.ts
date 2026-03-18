/**
 * AI Suite configuration. When AI_ENABLED=false, all AI endpoints return fallback/deterministic results.
 */
export const aiConfig = () => ({
  enabled: process.env.AI_ENABLED === 'true',
  provider: process.env.AI_PROVIDER || 'openai',
  model: process.env.AI_MODEL || 'gpt-4.1-mini',
  temperature: Math.min(1, Math.max(0, parseFloat(process.env.AI_TEMPERATURE || '0.3'))),
  maxTokens: Math.min(4096, Math.max(100, parseInt(process.env.AI_MAX_TOKENS || '900', 10))),
  apiKey: process.env.OPENAI_API_KEY || process.env.AI_API_KEY || '',
});

export type AiConfig = ReturnType<typeof aiConfig>;
