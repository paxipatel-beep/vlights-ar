import express from 'express';
import cors from 'cors';
import { rateLimit } from 'express-rate-limit';
import path from 'path';
import { fileURLToPath } from 'url';
import { createReadStream } from 'fs';
import 'dotenv/config';
import { createTask, executeTask, getTask, listTasks, emitter } from '../orchestrator/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '../../');
const OUTPUT_DIR = process.env.OUTPUT_DIR ?? path.join(PROJECT_ROOT, 'output');

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(PROJECT_ROOT, 'public')));

const taskLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
});

// POST /api/tasks
app.post('/api/tasks', taskLimiter, (req, res) => {
  const { goal } = req.body ?? {};
  if (!goal || typeof goal !== 'string' || !goal.trim()) {
    return res.status(400).json({ error: 'goal must be a non-empty string' });
  }
  const task = createTask(goal.trim());
  executeTask(task.id); // fire and forget
  res.status(201).json(task);
});

// GET /api/tasks
app.get('/api/tasks', (_req, res) => {
  res.json(listTasks());
});

// GET /api/tasks/:id
app.get('/api/tasks/:id', (req, res) => {
  const task = getTask(req.params.id);
  if (!task) return res.status(404).json({ error: 'Task not found' });
  res.json(task);
});

// GET /api/tasks/:id/stream  — SSE
app.get('/api/tasks/:id/stream', (req, res) => {
  const { id } = req.params;

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const send = (event) => {
    if (event.id === id) {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    }
  };

  const events = ['task:update', 'step:start', 'step:complete', 'task:complete', 'task:error'];
  events.forEach((name) => emitter.on(name, send));

  // Send current state immediately
  const current = getTask(id);
  if (current) res.write(`data: ${JSON.stringify(current)}\n\n`);

  // Keepalive every 15s
  const keepalive = setInterval(() => res.write(': keepalive\n\n'), 15000);

  req.on('close', () => {
    clearInterval(keepalive);
    events.forEach((name) => emitter.off(name, send));
  });
});

// GET /api/output/:taskId/:filename
app.get('/api/output/:taskId/:filename', (req, res) => {
  const { taskId, filename } = req.params;
  // Sanitize: disallow path traversal
  if (filename.includes('/') || filename.includes('..')) {
    return res.status(400).json({ error: 'Invalid filename' });
  }
  const filepath = path.join(OUTPUT_DIR, taskId, filename);
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  const stream = createReadStream(filepath);
  stream.on('error', () => res.status(404).json({ error: 'File not found' }));
  stream.pipe(res);
});

// Error middleware
app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: err.message });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

export default app;
