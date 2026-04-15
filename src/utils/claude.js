import Anthropic from '@anthropic-ai/sdk';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import 'dotenv/config';

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const agentsConfig = require(join(__dirname, '../../config/agents.json'));

const { models, routing } = agentsConfig;

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

/**
 * Complete a single turn with the Claude API.
 * Adds ephemeral cache_control to the system prompt for prompt caching.
 * Retries up to 3 times with exponential backoff on 529/overload errors.
 * @param {string} systemPrompt
 * @param {string} userMessage
 * @param {{ model?: string, maxTokens?: number, temperature?: number }} [options]
 * @returns {Promise<string>}
 */
export async function complete(systemPrompt, userMessage, options = {}) {
  const { model = models.capable, maxTokens = 4096, temperature } = options;
  const delays = [1000, 2000, 4000];

  for (let attempt = 0; attempt <= delays.length; attempt++) {
    try {
      const params = {
        model,
        max_tokens: maxTokens,
        system: [
          {
            type: 'text',
            text: systemPrompt,
            cache_control: { type: 'ephemeral' },
          },
        ],
        messages: [{ role: 'user', content: userMessage }],
      };
      if (temperature !== undefined) params.temperature = temperature;

      const response = await client.messages.create(params);

      for (const block of response.content) {
        if (block.type === 'text') return block.text;
      }
      return '';
    } catch (error) {
      const isOverload =
        error instanceof Anthropic.APIError &&
        (error.status === 529 || (error.message ?? '').toLowerCase().includes('overload'));

      if (isOverload && attempt < delays.length) {
        await new Promise((r) => setTimeout(r, delays[attempt]));
        continue;
      }
      throw error;
    }
  }
}

/**
 * Stream a response from the Claude API.
 * Calls onChunk(text) for each text delta.
 * @param {string} systemPrompt
 * @param {string} userMessage
 * @param {(chunk: string) => void} onChunk
 * @param {{ model?: string, maxTokens?: number, temperature?: number }} [options]
 * @returns {Promise<string>} Full accumulated text
 */
export async function stream(systemPrompt, userMessage, onChunk, options = {}) {
  const { model = models.capable, maxTokens = 8192, temperature } = options;

  const params = {
    model,
    max_tokens: maxTokens,
    system: [
      {
        type: 'text',
        text: systemPrompt,
        cache_control: { type: 'ephemeral' },
      },
    ],
    messages: [{ role: 'user', content: userMessage }],
  };
  if (temperature !== undefined) params.temperature = temperature;

  const messageStream = client.messages.stream(params);
  messageStream.on('text', (delta) => onChunk(delta));

  const final = await messageStream.finalMessage();
  let full = '';
  for (const block of final.content) {
    if (block.type === 'text') full += block.text;
  }
  return full;
}

/**
 * Route to a model based on task complexity.
 * @param {number} complexityScore - 0.0–1.0
 * @returns {string} Model ID
 */
export function routeModel(complexityScore) {
  if (complexityScore < routing.thresholds.fast) return models.fast;
  if (complexityScore < routing.thresholds.capable) return models.capable;
  return models.powerful;
}
