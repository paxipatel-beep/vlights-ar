import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import 'dotenv/config';

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const agentsConfig = require(join(__dirname, '../../config/agents.json'));

const { routing } = agentsConfig;
const PROVIDER = (process.env.LLM_PROVIDER || 'anthropic').toLowerCase();

// Clients (lazy — only used if that provider is active)
const anthropic = PROVIDER === 'anthropic'
  ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  : null;

const openai = PROVIDER === 'openai'
  ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  : null;

// Model maps per provider
const MODELS = {
  anthropic: {
    fast:     agentsConfig.models.fast     || 'claude-haiku-4-5-20251001',
    capable:  agentsConfig.models.capable  || 'claude-sonnet-4-6',
    powerful: agentsConfig.models.powerful || 'claude-opus-4-6',
  },
  openai: {
    fast:     agentsConfig.openaiModels?.fast     || 'gpt-4o-mini',
    capable:  agentsConfig.openaiModels?.capable  || 'gpt-4o',
    powerful: agentsConfig.openaiModels?.powerful || 'gpt-4o',
  },
};

const models = MODELS[PROVIDER] || MODELS.anthropic;

/**
 * Complete a single turn with the configured LLM provider.
 * Retries up to 3 times with exponential backoff on overload errors.
 */
export async function complete(systemPrompt, userMessage, options = {}) {
  const { model = models.capable, maxTokens = 4096, temperature } = options;
  const delays = [1000, 2000, 4000];

  for (let attempt = 0; attempt <= delays.length; attempt++) {
    try {
      if (PROVIDER === 'openai') {
        const params = {
          model,
          max_tokens: maxTokens,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user',   content: userMessage },
          ],
        };
        if (temperature !== undefined) params.temperature = temperature;
        const res = await openai.chat.completions.create(params);
        return res.choices[0]?.message?.content || '';
      }

      // Anthropic (default)
      const params = {
        model,
        max_tokens: maxTokens,
        system: [{ type: 'text', text: systemPrompt, cache_control: { type: 'ephemeral' } }],
        messages: [{ role: 'user', content: userMessage }],
      };
      if (temperature !== undefined) params.temperature = temperature;
      const response = await anthropic.messages.create(params);
      for (const block of response.content) {
        if (block.type === 'text') return block.text;
      }
      return '';

    } catch (error) {
      const msg = (error.message ?? '').toLowerCase();
      const isOverload = error.status === 529 || error.status === 429 ||
        msg.includes('overload') || msg.includes('rate limit');

      if (isOverload && attempt < delays.length) {
        await new Promise((r) => setTimeout(r, delays[attempt]));
        continue;
      }
      throw error;
    }
  }
}

/**
 * Stream a response from the configured LLM provider.
 * Calls onChunk(text) for each text delta. Returns full accumulated text.
 */
export async function stream(systemPrompt, userMessage, onChunk, options = {}) {
  const { model = models.capable, maxTokens = 8192, temperature } = options;

  if (PROVIDER === 'openai') {
    const params = {
      model,
      max_tokens: maxTokens,
      stream: true,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user',   content: userMessage },
      ],
    };
    if (temperature !== undefined) params.temperature = temperature;
    const s = await openai.chat.completions.create(params);
    let full = '';
    for await (const chunk of s) {
      const delta = chunk.choices[0]?.delta?.content || '';
      if (delta) { onChunk(delta); full += delta; }
    }
    return full;
  }

  // Anthropic
  const params = {
    model,
    max_tokens: maxTokens,
    system: [{ type: 'text', text: systemPrompt, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: userMessage }],
  };
  if (temperature !== undefined) params.temperature = temperature;
  const messageStream = anthropic.messages.stream(params);
  messageStream.on('text', (delta) => onChunk(delta));
  const final = await messageStream.finalMessage();
  let full = '';
  for (const block of final.content) {
    if (block.type === 'text') full += block.text;
  }
  return full;
}

/**
 * Route to a model tier based on task complexity (0.0–1.0).
 */
export function routeModel(complexityScore) {
  if (complexityScore < routing.thresholds.fast)    return models.fast;
  if (complexityScore < routing.thresholds.capable) return models.capable;
  return models.powerful;
}

export { PROVIDER, models };
