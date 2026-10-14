/**
 * agentOrchestrator.js — Multi-Agent Parallel Execution Swarm
 *
 * When a user command requires multiple actions (e.g., "Analyse emails +
 * Create Google Sheet + Book Calendar Meeting"), the orchestrator:
 *   1. Receives an array of tool tasks.
 *   2. Spawns specialized sub-agents concurrently using Promise.allSettled.
 *   3. Aggregates results into a single, clean summary card.
 *
 * Example:
 *   const { summary } = await orchestrateParallel([
 *     { toolName: 'gmail_read_inbox',    args: { maxResults: 10 } },
 *     { toolName: 'sheets_append_rows',  args: { spreadsheetId: 'abc', values: [[1,2]] } },
 *     { toolName: 'calendar_create_event', args: { title: 'Standup' } },
 *   ]);
 */

import { executeGoogleConnectorFunction } from './googleConnectorTools';

// ─── Sub-Agent Registry ───────────────────────────────────────────────────────

const AGENT_REGISTRY = [
  {
    key: 'gmail',
    label: 'Gmail Agent',
    icon: '📧',
    color: '#EA4335',
    patterns: ['gmail', 'email', 'inbox', 'send_email', 'reply', 'draft'],
  },
  {
    key: 'calendar',
    label: 'Calendar Agent',
    icon: '📅',
    color: '#4285F4',
    patterns: ['calendar', 'event', 'meeting', 'schedule', 'appointment'],
  },
  {
    key: 'sheets',
    label: 'Sheets Agent',
    icon: '📊',
    color: '#0F9D58',
    patterns: ['sheets', 'spreadsheet', 'append_rows', 'update_cell', 'get_values'],
  },
  {
    key: 'drive',
    label: 'Drive Agent',
    icon: '📁',
    color: '#F4B400',
    patterns: ['drive', 'file', 'upload', 'list_files', 'read_file'],
  },
  {
    key: 'computer',
    label: 'Computer Agent',
    icon: '💻',
    color: '#6366F1',
    patterns: ['computer', 'browser', 'screenshot', 'scan_system', 'click', 'navigate'],
  },
];

const FALLBACK_AGENT = { key: 'general', label: 'General Agent', icon: '🤖', color: '#8B5CF6' };

/**
 * Resolve which registered agent owns a given tool name.
 * @param {string} toolName
 * @returns {object} Agent descriptor
 */
function resolveAgent(toolName) {
  const name = String(toolName || '').toLowerCase();
  return (
    AGENT_REGISTRY.find(a => a.patterns.some(p => name.includes(p))) ||
    FALLBACK_AGENT
  );
}

// ─── Core Execution ───────────────────────────────────────────────────────────

/**
 * Run a single sub-agent task.
 * @param {{ toolName: string, args: object, sessionTokens?: Map }} task
 * @returns {Promise<TaskResult>}
 */
async function runTask({ toolName, args = {}, sessionTokens }) {
  const agent = resolveAgent(toolName);
  const start = Date.now();
  try {
    const result = await executeGoogleConnectorFunction(toolName, args, sessionTokens);
    return {
      agent,
      toolName,
      result,
      status: 'fulfilled',
      durationMs: Date.now() - start,
    };
  } catch (err) {
    return {
      agent,
      toolName,
      error: String(err?.message || err),
      status: 'rejected',
      durationMs: Date.now() - start,
    };
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * orchestrateParallel
 * Runs all tasks concurrently and returns an aggregated result.
 *
 * @param {Array<{ toolName: string, args?: object }>} tasks
 * @param {{ sessionTokens?: Map, onProgress?: (results: TaskResult[]) => void }} options
 * @returns {Promise<OrchestrationResult>}
 *
 * OrchestrationResult: {
 *   results:   TaskResult[]
 *   summary:   string   — Markdown summary card
 *   succeeded: number
 *   failed:    number
 *   totalMs:   number
 * }
 */
export async function orchestrateParallel(tasks = [], options = {}) {
  if (!tasks.length) {
    return {
      results: [],
      summary: 'No tasks provided.',
      succeeded: 0,
      failed: 0,
      totalMs: 0,
    };
  }

  const { sessionTokens, onProgress } = options;
  const wallStart = Date.now();

  // 🚀 Fire all sub-agents simultaneously — non-blocking
  const settled = await Promise.allSettled(
    tasks.map(task => runTask({ ...task, sessionTokens }))
  );

  const results = settled.map(outcome =>
    outcome.status === 'fulfilled'
      ? outcome.value
      : {
          status: 'rejected',
          error: outcome.reason?.message || String(outcome.reason),
          toolName: 'unknown',
          agent: FALLBACK_AGENT,
          durationMs: 0,
        }
  );

  const succeeded = results.filter(r => r.status === 'fulfilled').length;
  const failed = results.filter(r => r.status === 'rejected').length;
  const totalMs = Date.now() - wallStart;

  // ── Build human-readable summary card ──────────────────────────────────────
  const lines = results.map(r => {
    const tick = r.status === 'fulfilled' ? '✅' : '❌';
    const label = r.agent?.label || r.toolName;
    const detail =
      r.status === 'fulfilled'
        ? typeof r.result === 'string'
          ? r.result.slice(0, 150)
          : JSON.stringify(r.result).slice(0, 150)
        : `Error: ${r.error}`;
    return `${tick} **${label}** *(${r.durationMs}ms)*\n   ${detail}`;
  });

  const summary = [
    `## 🤖 Multi-Agent Execution Complete`,
    `**${succeeded}/${tasks.length} tasks succeeded** · ${totalMs}ms total`,
    '',
    ...lines,
  ].join('\n');

  onProgress?.(results);

  return { results, summary, succeeded, failed, totalMs };
}

/**
 * Convenience wrapper — accepts Gemini-style function-call objects:
 * [{ name: 'gmail_read_inbox', arguments: { maxResults: 5 } }, ...]
 *
 * @param {Array<{ name: string, arguments?: object }>} functionCalls
 * @param {object} options
 * @returns {Promise<OrchestrationResult>}
 */
export async function orchestrateFunctionCalls(functionCalls = [], options = {}) {
  const tasks = functionCalls.map(fc => ({
    toolName: fc.name || fc.toolName,
    args: fc.arguments || fc.args || {},
  }));
  return orchestrateParallel(tasks, options);
}

export default orchestrateParallel;

