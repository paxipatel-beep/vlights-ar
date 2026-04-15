import { complete } from '../utils/claude.js';

const SYSTEM_PROMPT =
  'You are a task planner. Given a user goal, decompose it into 3-6 concrete steps. ' +
  'Each step must have: id (step-1, step-2...), type (research/code/analysis/synthesis), ' +
  'description, agentType (researcher/coder/analyst). ' +
  'Return ONLY valid JSON array.';

/**
 * Extract a JSON array from a Claude response that may be wrapped in a markdown code block.
 * @param {string} text
 * @returns {unknown[]}
 */
function parseSteps(text) {
  // Strip optional ```json ... ``` or ``` ... ``` fences
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = fenced ? fenced[1].trim() : text.trim();
  return JSON.parse(raw);
}

/**
 * Decompose a user goal into an ordered list of Steps.
 *
 * @param {string} goal   - The high-level task the user wants to accomplish.
 * @param {string} taskId - Unique identifier for the current task session.
 * @returns {Promise<import('../orchestrator/types.js').Step[]>}
 */
export async function plan(goal, taskId) {
  const response = await complete(SYSTEM_PROMPT, goal, {
    model: 'claude-sonnet-4-6',
    maxTokens: 2048,
  });

  const steps = parseSteps(response);

  return steps.map((step) => ({
    ...step,
    status: 'pending',
  }));
}
