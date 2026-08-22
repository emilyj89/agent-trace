import assert from 'node:assert/strict';
import { test } from 'node:test';
import { computeStats } from '../src/stats.ts';
import type { TraceEvent } from '../src/types.ts';

test('counts events by type', () => {
  const events: TraceEvent[] = [
    { type: 'user', text: 'hi' },
    { type: 'assistant', text: 'ok' },
    { type: 'tool_call', id: 'c1', name: 'read_file' },
    { type: 'tool_result', id: 'c1', ok: true },
  ];

  const stats = computeStats(events);
  assert.equal(stats.totalEvents, 4);
  assert.deepEqual(stats.eventCounts, { user: 1, assistant: 1, tool_call: 1, tool_result: 1 });
});

test('wall clock is the span between the oldest and newest timestamp', () => {
  const events: TraceEvent[] = [
    { type: 'user', ts: 1000, text: 'a' },
    { type: 'assistant', ts: 1400, text: 'b' },
  ];

  assert.equal(computeStats(events).wallClockMs, 400);
});

test('wall clock is undefined when fewer than two events carry a timestamp', () => {
  assert.equal(computeStats([{ type: 'user', text: 'a' }]).wallClockMs, undefined);
  assert.equal(computeStats([{ type: 'user', ts: 5, text: 'a' }]).wallClockMs, undefined);
});

test('sums token usage across assistant events', () => {
  const events: TraceEvent[] = [
    { type: 'assistant', text: 'a', usage: { inputTokens: 10, outputTokens: 2 } },
    { type: 'assistant', text: 'b', usage: { inputTokens: 5, outputTokens: 1 } },
    { type: 'assistant', text: 'c' },
  ];

  assert.deepEqual(computeStats(events).tokens, { inputTokens: 15, outputTokens: 3 });
});

test('per-tool timing, failure rate and time share match the worked example', () => {
  const events: TraceEvent[] = [
    { type: 'user', ts: 0, text: 'go' },
    { type: 'tool_call', ts: 0, id: 'c1', name: 'run_tests' },
    { type: 'tool_result', ts: 1760, id: 'c1', ok: false, durationMs: 1760 },
    { type: 'tool_call', ts: 1760, id: 'c2', name: 'run_tests' },
    { type: 'tool_result', ts: 3515, id: 'c2', ok: true, durationMs: 1755 },
    { type: 'tool_call', ts: 3515, id: 'c3', name: 'apply_patch' },
    { type: 'tool_result', ts: 3573, id: 'c3', ok: true, durationMs: 58 },
    { type: 'tool_call', ts: 3573, id: 'c4', name: 'apply_patch' },
    { type: 'tool_result', ts: 3633, id: 'c4', ok: true, durationMs: 60 },
    { type: 'tool_call', ts: 3633, id: 'c5', name: 'read_file' },
    { type: 'tool_result', ts: 3674, id: 'c5', ok: true, durationMs: 41 },
    { type: 'tool_call', ts: 3674, id: 'c6', name: 'read_file' },
    { type: 'tool_result', ts: 3728, id: 'c6', ok: true, durationMs: 54 },
    { type: 'assistant', ts: 3728, text: 'done' },
  ];

  const stats = computeStats(events);
  assert.equal(stats.toolCalls, 6);
  assert.equal(stats.completedCalls, 6);
  assert.equal(stats.pendingCalls, 0);
  assert.equal(stats.failedCalls, 1);
  assert.equal(stats.failureRate, 1 / 6);
  assert.equal(stats.toolTimeMs, 1760 + 1755 + 58 + 60 + 41 + 54);
  assert.equal(stats.orphanResults, 0);

  assert.equal(stats.tools.length, 3);
  assert.equal(stats.tools[0].name, 'run_tests');
  assert.equal(stats.tools[0].calls, 2);
  assert.equal(stats.tools[0].failures, 1);
  assert.equal(stats.tools[0].totalMs, 3515);
  assert.equal(stats.tools[0].avgMs, 1757.5);
  assert.equal(stats.tools[0].maxMs, 1760);
});

test('pending calls and orphan results are counted but do not add tool time', () => {
  const events: TraceEvent[] = [
    { type: 'tool_call', id: 'c1', name: 'read_file' },
    { type: 'tool_result', id: 'does-not-exist', ok: true, durationMs: 10 },
  ];

  const stats = computeStats(events);
  assert.equal(stats.toolCalls, 1);
  assert.equal(stats.completedCalls, 0);
  assert.equal(stats.pendingCalls, 1);
  assert.equal(stats.orphanResults, 1);
  assert.equal(stats.toolTimeMs, 0);
  assert.equal(stats.tools[0].avgMs, 0);
  assert.equal(stats.tools[0].maxMs, 0);
});

test('failure rate and time share are undefined when there is nothing to divide by', () => {
  const stats = computeStats([{ type: 'user', text: 'hi' }]);
  assert.equal(stats.failureRate, undefined);
  assert.equal(stats.toolTimeShare, undefined);
});
