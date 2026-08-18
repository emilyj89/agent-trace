import type { LineResult, ParseIssue, ParseResult, TraceEvent, UsageInfo } from './types.ts';

const KNOWN_TYPES = new Set(['user', 'assistant', 'tool_call', 'tool_result']);

// Runtimes disagree on token field names too, so accept both spellings.
function normalizeUsage(raw: unknown): UsageInfo | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined;
  const obj = raw as Record<string, unknown>;
  const input = obj.input_tokens ?? obj.inputTokens;
  const output = obj.output_tokens ?? obj.outputTokens;
  if (typeof input !== 'number' && typeof output !== 'number') return undefined;
  return {
    inputTokens: typeof input === 'number' ? input : 0,
    outputTokens: typeof output === 'number' ? output : 0,
  };
}

/**
 * Parse a single JSONL line. Never throws: anything it cannot make sense of
 * comes back as an issue rather than aborting the caller's loop.
 */
export function parseTraceLine(raw: string, line = 1): LineResult {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return {};
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch (err) {
    return { issue: { line, message: `invalid JSON: ${(err as Error).message}`, raw } };
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { issue: { line, message: 'line is not a JSON object', raw } };
  }

  const record = parsed as Record<string, unknown>;
  const type = record.type ?? record.role;
  if (typeof type !== 'string' || !KNOWN_TYPES.has(type)) {
    return { issue: { line, message: `unknown or missing type: ${JSON.stringify(type)}`, raw } };
  }

  const tsRaw = record.ts ?? record.timestamp;
  const ts = typeof tsRaw === 'number' ? tsRaw : undefined;
  const text = typeof record.text === 'string' ? record.text : undefined;

  switch (type) {
    case 'user':
      return { event: { type, ts, text } };

    case 'assistant':
      return { event: { type, ts, text, usage: normalizeUsage(record.usage) } };

    case 'tool_call': {
      const id = typeof record.id === 'string' ? record.id : undefined;
      const nameRaw = record.name ?? record.tool;
      const name = typeof nameRaw === 'string' ? nameRaw : undefined;
      const args = record.args ?? record.arguments;
      return { event: { type, ts, id, name, args } };
    }

    case 'tool_result': {
      const id = typeof record.id === 'string' ? record.id : undefined;
      const ok = typeof record.ok === 'boolean' ? record.ok : undefined;
      const durationMs = typeof record.durationMs === 'number' ? record.durationMs : undefined;
      return { event: { type, ts, id, ok, durationMs, output: record.output } };
    }

    default:
      // Unreachable: KNOWN_TYPES already narrowed `type`.
      return { issue: { line, message: `unhandled type: ${type}`, raw } };
  }
}

/**
 * Parse a full JSONL trace. Blank lines are skipped. A line that cannot be
 * understood is recorded in `issues` (with its 1-based line number) rather
 * than stopping the parse, since a single malformed line from a crashed
 * runtime shouldn't take down the whole report.
 */
export function parseTrace(text: string): ParseResult {
  const events: TraceEvent[] = [];
  const issues: ParseIssue[] = [];
  const lines = text.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    if (raw.trim().length === 0) continue;

    const { event, issue } = parseTraceLine(raw, i + 1);
    if (event) events.push(event);
    if (issue) issues.push(issue);
  }

  return { events, issues };
}

/** Same as parseTrace, but throws on the first unusable line instead of collecting issues. */
export function parseTraceStrict(text: string): TraceEvent[] {
  const { events, issues } = parseTrace(text);
  if (issues.length > 0) {
    const first = issues[0];
    throw new Error(
      `parseTraceStrict: line ${first.line}: ${first.message} (${issues.length} unusable line(s) total)`,
    );
  }
  return events;
}
