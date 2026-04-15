import { complete } from '../utils/claude.js';
import { writeReport, writeData } from '../tools/deliverable.js';

const SYSTEM_PROMPT =
  'You are a data analyst and researcher. ' +
  'Analyze the provided information and produce structured insights. ' +
  'Structure your response with these exact sections:\n' +
  '## Key Findings\n' +
  '(bullet list of the most important findings)\n\n' +
  '## Data Insights\n' +
  '(patterns, correlations, and notable observations)\n\n' +
  '## Recommendations\n' +
  '(actionable recommendations based on the analysis)\n\n' +
  '## Summary\n' +
  '(concise overall summary)';

/**
 * Parse a structured analysis response into named sections.
 * Falls back to empty strings for any missing section.
 * @param {string} text
 * @returns {{ findings: string, insights: string, recommendations: string, summary: string }}
 */
function parseAnalysisSections(text) {
  const extract = (heading) => {
    const re = new RegExp(
      `##\\s+${heading}\\s*\\n([\\s\\S]*?)(?=\\n##\\s|$)`,
      'i'
    );
    const match = text.match(re);
    return match ? match[1].trim() : '';
  };

  return {
    findings: extract('Key Findings'),
    insights: extract('Data Insights'),
    recommendations: extract('Recommendations'),
    summary: extract('Summary'),
  };
}

/**
 * Convert parsed section strings into the format expected by writeReport.
 * @param {{ findings: string, insights: string, recommendations: string, summary: string }} sections
 * @returns {{ heading: string, content: string }[]}
 */
function toReportSections({ findings, insights, recommendations, summary }) {
  return [
    { heading: 'Key Findings', content: findings },
    { heading: 'Data Insights', content: insights },
    { heading: 'Recommendations', content: recommendations },
    { heading: 'Summary', content: summary },
  ].filter((s) => s.content);
}

/**
 * Analyze all previous results and produce a structured report + JSON data file.
 *
 * @param {object} step    - The Step object being executed.
 * @param {object} context - Context object: { taskId, goal, previousResults }.
 * @returns {Promise<object>} AgentResult
 */
export async function execute(step, context) {
  const allContext = context.previousResults.map((r) => r.content).join('\n\n---\n\n');

  const userMessage = [
    `Goal: ${context.goal}`,
    `Step: ${step.description}`,
    allContext ? `\nPrevious Research & Results:\n${allContext}` : '',
  ]
    .filter(Boolean)
    .join('\n');

  const analysisText = await complete(SYSTEM_PROMPT, userMessage, {
    model: 'claude-sonnet-4-6',
    maxTokens: 4096,
  });

  const { findings, insights, recommendations, summary } =
    parseAnalysisSections(analysisText);

  const reportSections = toReportSections({ findings, insights, recommendations, summary });

  const [reportPath, dataPath] = await Promise.all([
    writeReport(context.taskId, step.description, reportSections),
    writeData(context.taskId, 'analysis.json', {
      findings,
      insights,
      recommendations,
      summary,
    }),
  ]);

  return {
    stepId: step.id,
    type: 'analysis',
    content: analysisText,
    artifacts: [
      {
        filename: 'analysis-report.md',
        content: analysisText,
        type: 'markdown',
      },
      {
        filename: 'analysis.json',
        content: JSON.stringify({ findings, insights, recommendations, summary }, null, 2),
        type: 'json',
      },
    ],
    sources: [],
  };
}
