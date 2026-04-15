import { complete } from '../utils/claude.js';
import { writeCode } from '../tools/deliverable.js';

const SYSTEM_PROMPT =
  'You are an expert software engineer. ' +
  'Generate clean, well-commented, production-quality code. ' +
  'Always wrap your implementation in a fenced code block (e.g. ```javascript). ' +
  'After the code block, provide a brief explanation of the implementation.';

/** Map common language names/aliases to file extensions. */
const LANG_EXT = {
  javascript: 'js',
  js: 'js',
  typescript: 'ts',
  ts: 'ts',
  python: 'py',
  py: 'py',
  ruby: 'rb',
  go: 'go',
  rust: 'rs',
  java: 'java',
  cpp: 'cpp',
  'c++': 'cpp',
  c: 'c',
  shell: 'sh',
  bash: 'sh',
  html: 'html',
  css: 'css',
  json: 'json',
  sql: 'sql',
};

/**
 * Parse the first fenced code block from a Claude response.
 * @param {string} text
 * @returns {{ code: string, language: string }}
 */
function parseCodeBlock(text) {
  const match = text.match(/```(\w+)?\s*\n([\s\S]*?)```/);
  if (match) {
    const language = (match[1] ?? 'javascript').toLowerCase();
    return { code: match[2].trim(), language };
  }
  return { code: text.trim(), language: 'javascript' };
}

/**
 * Extract the explanation that follows the first code block.
 * @param {string} text
 * @returns {string}
 */
function parseExplanation(text) {
  const afterBlock = text.replace(/```[\s\S]*?```/, '').trim();
  return afterBlock || 'See code artifact for implementation details.';
}

/**
 * Convert a step description to a snake_case filename with the proper extension.
 * @param {string} description
 * @param {string} language
 * @returns {string}
 */
function buildFilename(description, language) {
  const base = description
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 60);
  const ext = LANG_EXT[language] ?? language;
  return `${base}.${ext}`;
}

/**
 * Generate code for a step using Claude, write it to disk, and return an AgentResult.
 *
 * @param {object} step    - The Step object being executed.
 * @param {object} context - Context object: { taskId, goal, previousResults }.
 * @returns {Promise<object>} AgentResult
 */
export async function execute(step, context) {
  const previousContext = context.previousResults
    .map((r) => r.content)
    .join('\n\n---\n\n');

  const userMessage = [
    `Goal: ${context.goal}`,
    `Step: ${step.description}`,
    previousContext ? `\nResearch Context:\n${previousContext}` : '',
  ]
    .filter(Boolean)
    .join('\n');

  const rawResponse = await complete(SYSTEM_PROMPT, userMessage, {
    model: 'claude-opus-4-6',
    maxTokens: 8192,
  });

  const { code, language } = parseCodeBlock(rawResponse);
  const explanation = parseExplanation(rawResponse);
  const filename = buildFilename(step.description, language);

  await writeCode(context.taskId, filename, code, language);

  return {
    stepId: step.id,
    type: 'code',
    content: explanation,
    artifacts: [
      {
        filename,
        content: code,
        type: 'code',
      },
    ],
    sources: [],
  };
}
