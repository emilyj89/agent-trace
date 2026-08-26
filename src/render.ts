import { pairToolEvents } from './pair.ts';
import type {
  ToolCallEvent,
  ToolResultEvent,
  ToolSpan,
  TraceEvent,
  TraceStats,
  TimelineOptions,
} from './types.ts';

// Rounds to the nearest millisecond first so formatting never depends on
// binary floating point representing a decimal fraction exactly (1757.5ms
// must read as "1.758s", not "1.757s" because of how /1000 happens to round).
function formatMs(ms: number): string {
  const rounded = Math.round(ms);
  const sign = rounded < 0 ? '-' : '';
  const abs = Math.abs(rounded);
  if (abs < 1000) return `${sign}${abs}ms`;
  const wholeSeconds = Math.floor(abs / 1000);
  const millis = abs % 1000;
  return `${sign}${wholeSeconds}.${String(millis).padStart(3, '0')}s`;
}

// Same reasoning as formatMs: round to tenths of a percent as an integer
// rather than trusting toFixed on a fraction*100 float.
function formatPercent(fraction: number): string {
  const permille = Math.round(fraction * 1000);
  const whole = Math.floor(permille / 10);
  const tenth = permille % 10;
  return `${whole}.${tenth}%`;
}

const LABEL_WIDTH = 14;

function labelLine(label: string, value: string): string {
  return label.padEnd(LABEL_WIDTH) + value;
}

/** Render a TraceStats as the fixed-width summary + per-tool table shown in the README. */
export function renderStats(stats: TraceStats): string {
  const lines: string[] = [];
  const counts = stats.eventCounts;

  lines.push(
    labelLine(
      'events',
      `${stats.totalEvents}  (user ${counts.user}, assistant ${counts.assistant}, ` +
        `tool_call ${counts.tool_call}, tool_result ${counts.tool_result})`,
    ),
  );

  lines.push(labelLine('wall clock', stats.wallClockMs !== undefined ? formatMs(stats.wallClockMs) : 'n/a'));

  const toolTimeSuffix =
    stats.toolTimeShare !== undefined ? `  (${formatPercent(stats.toolTimeShare)} of wall clock)` : '';
  lines.push(labelLine('tool time', formatMs(stats.toolTimeMs) + toolTimeSuffix));

  const failureSuffix = stats.failureRate !== undefined ? ` = ${formatPercent(stats.failureRate)} failure rate` : '';
  lines.push(
    labelLine(
      'tool calls',
      `${stats.toolCalls}  (${stats.completedCalls} completed, ${stats.pendingCalls} pending, ` +
        `${stats.failedCalls} failed${failureSuffix})`,
    ),
  );

  if (stats.orphanResults > 0) {
    const noun = stats.orphanResults === 1 ? 'result' : 'results';
    lines.push(labelLine('orphans', `${stats.orphanResults}  (tool ${noun} with no matching call)`));
  }

  lines.push(
    labelLine(
      'tokens',
      `${stats.tokens.inputTokens} in / ${stats.tokens.outputTokens} out = ` +
        `${stats.tokens.inputTokens + stats.tokens.outputTokens} total`,
    ),
  );

  if (stats.tools.length > 0) {
    const nameWidth = Math.max('tool'.length, ...stats.tools.map((t) => t.name.length)) + 1;
    lines.push('');
    lines.push(
      'tool'.padEnd(nameWidth) +
        'calls'.padStart(6) +
        'fail'.padStart(6) +
        'total'.padStart(8) +
        'avg'.padStart(8) +
        'max'.padStart(8) +
        'share'.padStart(7),
    );
    for (const tool of stats.tools) {
      lines.push(
        tool.name.padEnd(nameWidth) +
          String(tool.calls).padStart(6) +
          String(tool.failures).padStart(6) +
          formatMs(tool.totalMs).padStart(8) +
          formatMs(tool.avgMs).padStart(8) +
          formatMs(tool.maxMs).padStart(8) +
          formatPercent(tool.timeShare).padStart(7),
      );
    }
  }

  return lines.join('\n');
}

function truncate(text: string, maxLength: number): string {
  if (maxLength <= 0) return '';
  return text.length > maxLength ? `${text.slice(0, maxLength)}…` : text;
}

function formatOffset(ts: number | undefined, baseTs: number | undefined): string {
  if (ts === undefined || baseTs === undefined) return ' '.repeat(9);
  const delta = ts - baseTs;
  const sign = delta < 0 ? '-' : '+';
  return (sign + formatMs(Math.abs(delta))).padStart(9);
}

function formatLine(ts: number | undefined, baseTs: number | undefined, indentLevel: number, label: string, content: string): string {
  const indent = '  '.repeat(indentLevel);
  return `${formatOffset(ts, baseTs)}  ${indent}${label.padEnd(11)} ${content}`;
}

function formatSpan(span: { name?: string; call: ToolCallEvent; result?: ToolResultEvent; ok?: boolean; durationMs?: number }, maxArgLength: number): string {
  const name = span.name ?? '(unknown)';
  const argsStr = span.call.args !== undefined ? truncate(JSON.stringify(span.call.args), maxArgLength) : '';
  const status = span.result === undefined ? 'pending' : span.ok === false ? 'FAILED' : 'ok';
  const durationSuffix = span.durationMs !== undefined ? ` in ${formatMs(span.durationMs)}` : '';
  return `${name}(${argsStr}) -> ${status}${durationSuffix}`;
}

/**
 * Render events as an indented, chronological timeline. tool_call/tool_result
 * pairs collapse onto a single line; a result with no matching call (an
 * orphan) is shown on its own. With `tool` set, user/assistant text and
 * other tools' calls are dropped so only that tool's activity remains.
 */
export function renderTimeline(events: TraceEvent[], options: TimelineOptions = {}): string {
  const { tool, maxArgLength = 80, hideText = false } = options;
  const { spans, orphans } = pairToolEvents(events);

  const spanByCall = new Map<ToolCallEvent, ToolSpan>();
  for (const span of spans) spanByCall.set(span.call, span);
  const orphanSet = new Set<ToolResultEvent>(orphans);

  const baseTs = events.find((e) => typeof e.ts === 'number')?.ts;
  const lines: string[] = [];

  for (const event of events) {
    if (event.type === 'user') {
      if (hideText || tool !== undefined) continue;
      lines.push(formatLine(event.ts, baseTs, 0, 'user', event.text ?? ''));
      continue;
    }

    if (event.type === 'assistant') {
      if (hideText || tool !== undefined) continue;
      const usageSuffix = event.usage ? `  (${event.usage.inputTokens} in / ${event.usage.outputTokens} out)` : '';
      lines.push(formatLine(event.ts, baseTs, 0, 'assistant', (event.text ?? '') + usageSuffix));
      continue;
    }

    if (event.type === 'tool_call') {
      const span = spanByCall.get(event) ?? { call: event, name: event.name };
      const name = span.name ?? '(unknown)';
      if (tool !== undefined && name !== tool) continue;
      lines.push(formatLine(event.ts, baseTs, 1, 'tool_call', formatSpan(span, maxArgLength)));
      continue;
    }

    if (event.type === 'tool_result') {
      if (!orphanSet.has(event) || tool !== undefined) continue;
      const idPart = event.id !== undefined ? ` (id ${event.id})` : '';
      const okPart = event.ok !== undefined ? `, ok=${event.ok}` : '';
      lines.push(formatLine(event.ts, baseTs, 1, 'tool_result', `orphan result${idPart}${okPart}`));
    }
  }

  return lines.join('\n');
}
