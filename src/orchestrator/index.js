import EventEmitter from 'events';
import { v4 as uuidv4 } from 'uuid';
import { plan } from '../agents/planner.js';
import { execute as researcherExecute } from '../agents/researcher.js';
import { execute as coderExecute } from '../agents/coder.js';
import { execute as analystExecute } from '../agents/analyst.js';
import { list } from '../tools/deliverable.js';
import { complete } from '../utils/claude.js';

const tasks = new Map();
export const emitter = new EventEmitter();

function now() {
  return new Date().toISOString();
}

function updateTask(taskId, patch) {
  const task = tasks.get(taskId);
  if (!task) return;
  Object.assign(task, patch, { updatedAt: now() });
  emitter.emit('task:update', task);
  return task;
}

export function createTask(goal) {
  const ts = now();
  const task = {
    id: uuidv4(),
    goal,
    status: 'pending',
    plan: [],
    results: [],
    deliverables: [],
    createdAt: ts,
    updatedAt: ts,
  };
  tasks.set(task.id, task);
  return task;
}

const AGENT_MAP = {
  researcher: researcherExecute,
  coder: coderExecute,
  analyst: analystExecute,
};

const SYNTHESIS_SYSTEM =
  'You are a synthesis expert. Given multiple agent results from an autonomous task, ' +
  'write exactly two paragraphs that summarize the key findings, outcomes, and value ' +
  'delivered. Be concise, specific, and professional.';

export async function executeTask(taskId) {
  const task = tasks.get(taskId);
  if (!task) throw new Error(`Task ${taskId} not found`);

  try {
    // 1. Planning
    updateTask(taskId, { status: 'planning' });

    const steps = await plan(task.goal, taskId);

    // 2. Update plan
    updateTask(taskId, { plan: steps, status: 'executing' });

    // 3. Execute each step
    for (const step of task.plan) {
      step.status = 'running';
      updateTask(taskId, {});
      emitter.emit('step:start', task);

      const agentFn = AGENT_MAP[step.agentType];
      if (!agentFn) throw new Error(`Unknown agentType: ${step.agentType}`);

      const context = {
        taskId,
        goal: task.goal,
        previousResults: [...task.results],
      };

      const agentResult = await agentFn(step, context);

      step.status = 'complete';
      step.result = agentResult;
      task.results.push(agentResult);
      updateTask(taskId, {});
      emitter.emit('step:complete', task);
    }

    // 4. Synthesize
    updateTask(taskId, { status: 'synthesizing' });

    const summaryInput = task.results
      .map((r, i) => `Result ${i + 1} (${r.type}):\n${r.content}`)
      .join('\n\n---\n\n');

    const synthesis = await complete(SYNTHESIS_SYSTEM, summaryInput, {
      model: 'claude-sonnet-4-6',
      maxTokens: 1024,
    });

    // 5. Collect deliverables
    const deliverables = await list(taskId);

    // 6. Complete
    updateTask(taskId, { status: 'complete', deliverables, synthesis });
    emitter.emit('task:complete', task);
  } catch (err) {
    updateTask(taskId, { status: 'error', error: err.message });
    emitter.emit('task:error', task);
  }
}

export function getTask(taskId) {
  return tasks.get(taskId) ?? null;
}

export function listTasks() {
  return Array.from(tasks.values()).sort(
    (a, b) => new Date(b.createdAt) - new Date(a.createdAt)
  );
}
