import type { PairResult, ToolCallEvent, ToolResultEvent, ToolSpan, TraceEvent } from './types.ts';

function resolveDuration(call: ToolCallEvent, result: ToolResultEvent): number | undefined {
  if (typeof result.durationMs === 'number') return result.durationMs;
  if (typeof call.ts === 'number' && typeof result.ts === 'number') return result.ts - call.ts;
  return undefined;
}

/**
 * Match tool_call events to their tool_result by id. A result with no id is
 * matched to the oldest still-open call, since that is what sequential
 * (non-concurrent) agents produce. A result whose id matches no open call --
 * or that arrives once there are no open calls left to guess from -- is an
 * orphan. Calls that never get a result stay in `spans` with `result` unset.
 */
export function pairToolEvents(events: TraceEvent[]): PairResult {
  const spans: ToolSpan[] = [];
  const open: ToolSpan[] = [];
  const openById = new Map<string, ToolSpan>();
  const orphans: ToolResultEvent[] = [];

  for (const event of events) {
    if (event.type === 'tool_call') {
      const span: ToolSpan = { id: event.id, name: event.name, call: event };
      spans.push(span);
      open.push(span);
      if (event.id !== undefined) openById.set(event.id, span);
      continue;
    }

    if (event.type !== 'tool_result') continue;

    const span = event.id !== undefined ? openById.get(event.id) : open[0];
    if (span === undefined) {
      orphans.push(event);
      continue;
    }

    span.result = event;
    span.ok = event.ok;
    span.durationMs = resolveDuration(span.call, event);

    const openIndex = open.indexOf(span);
    if (openIndex !== -1) open.splice(openIndex, 1);
    if (span.id !== undefined) openById.delete(span.id);
  }

  return { spans, orphans };
}
