import fs from 'fs/promises';
import path from 'path';
import 'dotenv/config';

const OUTPUT_DIR = process.env.OUTPUT_DIR ?? './output';

async function ensureTaskDir(taskId) {
  const dir = path.resolve(OUTPUT_DIR, taskId);
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

export async function write(taskId, filename, content) {
  const dir = await ensureTaskDir(taskId);
  const filepath = path.join(dir, filename);
  await fs.writeFile(filepath, content, 'utf8');
  return filepath;
}

export async function writeReport(taskId, title, sections) {
  const timestamp = Date.now();
  const filename = `report-${timestamp}.md`;

  const lines = [`# ${title}`, ''];
  for (const { heading, content } of sections) {
    lines.push(`## ${heading}`, '', content, '');
  }

  return write(taskId, filename, lines.join('\n'));
}

export async function writeCode(taskId, filename, code, language) {
  const header = `# Language: ${language}\n\n`;
  return write(taskId, filename, header + code);
}

export async function writeData(taskId, filename, data) {
  return write(taskId, filename, JSON.stringify(data, null, 2));
}

export async function list(taskId) {
  const dir = path.resolve(OUTPUT_DIR, taskId);
  try {
    const entries = await fs.readdir(dir);
    return entries.map((entry) => path.join(dir, entry));
  } catch {
    return [];
  }
}
