import { pairToolEvents } from './pair.ts';
import type { ToolSpan, TraceEvent, TraceStats } from './types.ts';

function computeWallClockMs(events: TraceEvent[]): number | undefined {
  let min: number | undefined;
  let max: number | undefined;
  for (const event of events) {
    if (typeof event.ts !== 'number') continue;
    if (min === undefined || event.ts < min) min = event.ts;
    if (max === undefined || event.ts > max) max = event.ts;
  }
  return min !== undefined && max !== undefined && min !== max ? max - min : undefined;
}

function computeToolStats(spans: ToolSpan[]): { tools: TraceStats['tools']; toolTimeMs: number } {
  const byName = new Map<string, { calls: number; failures: number; durations: number[] }>();

  for (const span of spans) {
    const name = span.name ?? '(unknown)';
    let bucket = byName.get(name);
    if (bucket === undefined) {
      bucket = { calls: 0, failures: 0, durations: [] };
      byName.set(name, bucket);
    }
    bucket.calls++;
    if (span.ok === false) bucket.failures++;
    if (typeof span.durationMs === 'number') bucket.durations.push(span.durationMs);
  }

  const toolTimeMs = spans.reduce((sum, span) => sum + (span.durationMs ?? 0), 0);

  const tools = Array.from(byName.entries()).map(([name, bucket]) => {
    const totalMs = bucket.durations.reduce((sum, ms) => sum + ms, 0);
    return {
      name,
      calls: bucket.calls,
      failures: bucket.failures,
      totalMs,
      avgMs: bucket.durations.length > 0 ? totalMs / bucket.durations.length : 0,
      maxMs: bucket.durations.length > 0 ? Math.max(...bucket.durations) : 0,
      timeShare: toolTimeMs > 0 ? totalMs / toolTimeMs : 0,
    };
  });
  tools.sort((a, b) => b.totalMs - a.totalMs);

  return { tools, toolTimeMs };
}

/** Wall clock, tool timing and token totals over a parsed trace. Pure: does not read or throw. */
export function computeStats(events: TraceEvent[]): TraceStats {
  const eventCounts = { user: 0, assistant: 0, tool_call: 0, tool_result: 0 };
  const tokens = { inputTokens: 0, outputTokens: 0 };

  for (const event of events) {
    eventCounts[event.type]++;
    if (event.type === 'assistant' && event.usage) {
      tokens.inputTokens += event.usage.inputTokens;
      tokens.outputTokens += event.usage.outputTokens;
    }
  }

  const { spans, orphans } = pairToolEvents(events);
  const { tools, toolTimeMs } = computeToolStats(spans);
  const wallClockMs = computeWallClockMs(events);

  const toolCalls = spans.length;
  const completedCalls = spans.filter((span) => span.result !== undefined).length;
  const failedCalls = spans.filter((span) => span.ok === false).length;

  return {
    totalEvents: events.length,
    eventCounts,
    wallClockMs,
    toolTimeMs,
    toolTimeShare: wallClockMs !== undefined && wallClockMs > 0 ? toolTimeMs / wallClockMs : undefined,
    toolCalls,
    completedCalls,
    pendingCalls: toolCalls - completedCalls,
    failedCalls,
    failureRate: toolCalls > 0 ? failedCalls / toolCalls : undefined,
    orphanResults: orphans.length,
    tokens,
    tools,
  };
}
