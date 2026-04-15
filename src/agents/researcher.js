import { complete } from '../utils/claude.js';
import { search } from '../tools/websearch.js';
import { writeReport } from '../tools/deliverable.js';

const SYSTEM_PROMPT =
  'You are a research assistant. ' +
  'Synthesize the provided search results into a comprehensive research summary. ' +
  'Include key findings, insights, and citations.';

/**
 * Format raw search results for inclusion in a prompt.
 * @param {{ title: string, url: string, snippet: string }[]} results
 * @returns {string}
 */
function formatSearchResults(results) {
  return results
    .map((r, i) => `[${i + 1}] ${r.title}\nURL: ${r.url}\n${r.snippet}`)
    .join('\n\n');
}

/**
 * Parse a free-form synthesis text into report sections.
 * Splits on markdown headings; falls back to a single "Summary" section.
 * @param {string} text
 * @returns {{ heading: string, content: string }[]}
 */
function parseSections(text) {
  const headingRe = /^#{1,3}\s+(.+)$/m;
  const parts = text.split(/(?=^#{1,3}\s)/m).filter(Boolean);

  if (parts.length > 1) {
    return parts.map((part) => {
      const lines = part.trim().split('\n');
      const heading = lines[0].replace(/^#+\s*/, '').trim();
      const content = lines.slice(1).join('\n').trim();
      return { heading, content };
    });
  }

  return [{ heading: 'Summary', content: text.trim() }];
}

/**
 * Research a step by searching the web and synthesizing the results with Claude.
 *
 * @param {object} step     - The Step object being executed.
 * @param {object} context  - Context object: { taskId, goal, previousResults }.
 * @returns {Promise<object>} AgentResult
 */
export async function execute(step, context) {
  const searchResults = await search(step.description, 5);

  const userMessage = [
    `Goal: ${context.goal}`,
    `Step: ${step.description}`,
    '',
    'Search Results:',
    formatSearchResults(searchResults),
  ].join('\n');

  const synthesisText = await complete(SYSTEM_PROMPT, userMessage, {
    model: 'claude-sonnet-4-6',
    maxTokens: 4096,
  });

  const sections = parseSections(synthesisText);
  await writeReport(context.taskId, step.description, sections);

  const sources = searchResults.map((r) => r.url);

  return {
    stepId: step.id,
    type: 'research',
    content: synthesisText,
    artifacts: [
      {
        filename: 'research-report.md',
        content: synthesisText,
        type: 'markdown',
      },
    ],
    sources,
  };
}
