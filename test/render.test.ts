import assert from 'node:assert/strict';
import { test } from 'node:test';
import { computeStats } from '../src/stats.ts';
import { renderStats, renderTimeline } from '../src/render.ts';
import type { TraceEvent } from '../src/types.ts';

// Same session as the README's worked example: 17 events, 6 tool calls
// across 3 tools, one failure, wall clock 7.400s.
const README_EVENTS: TraceEvent[] = [
  { type: 'user', ts: 0, text: 'go' },
  { type: 'tool_call', ts: 100, id: 'c1', name: 'run_tests' },
  { type: 'tool_result', ts: 200, id: 'c1', ok: false, durationMs: 1760 },
  { type: 'tool_call', ts: 300, id: 'c2', name: 'run_tests' },
  { type: 'tool_result', ts: 400, id: 'c2', ok: true, durationMs: 1755 },
  { type: 'assistant', ts: 500, text: 'tests are failing, patching', usage: { inputTokens: 1180, outputTokens: 96 } },
  { type: 'tool_call', ts: 600, id: 'c3', name: 'apply_patch' },
  { type: 'tool_result', ts: 700, id: 'c3', ok: true, durationMs: 58 },
  { type: 'tool_call', ts: 800, id: 'c4', name: 'apply_patch' },
  { type: 'tool_result', ts: 900, id: 'c4', ok: true, durationMs: 60 },
  { type: 'assistant', ts: 1000, text: 'rerunning', usage: { inputTokens: 3000, outputTokens: 150 } },
  { type: 'tool_call', ts: 1100, id: 'c5', name: 'read_file' },
  { type: 'tool_result', ts: 1200, id: 'c5', ok: true, durationMs: 41 },
  { type: 'tool_call', ts: 1300, id: 'c6', name: 'read_file' },
  { type: 'tool_result', ts: 1400, id: 'c6', ok: true, durationMs: 54 },
  { type: 'assistant', ts: 1500, text: 'confirming', usage: { inputTokens: 4000, outputTokens: 200 } },
  { type: 'assistant', ts: 7400, text: 'done', usage: { inputTokens: 2150, outputTokens: 90 } },
];

test('renderStats matches the README worked example byte for byte', () => {
  const stats = computeStats(README_EVENTS);
  const expected = [
    'events        17  (user 1, assistant 4, tool_call 6, tool_result 6)',
    'wall clock    7.400s',
    'tool time     3.728s  (50.4% of wall clock)',
    'tool calls    6  (6 completed, 0 pending, 1 failed = 16.7% failure rate)',
    'tokens        10330 in / 536 out = 10866 total',
    '',
    'tool         calls  fail   total     avg     max  share',
    'run_tests        2     1  3.515s  1.758s  1.760s  94.3%',
    'apply_patch      2     0   118ms    59ms    60ms   3.2%',
    'read_file        2     0    95ms    48ms    54ms   2.5%',
  ].join('\n');

  assert.equal(renderStats(stats), expected);
});

test('renderStats omits the table when there are no tool calls', () => {
  const stats = computeStats([{ type: 'user', ts: 0, text: 'hi' }]);
  const text = renderStats(stats);
  assert.equal(text.includes('tool'), false);
  assert.match(text, /wall clock {4}n\/a/);
});

test('renderStats shows an orphans line only when there are orphan results', () => {
  const withOrphan = computeStats([
    { type: 'tool_result', id: 'ghost', ok: true, durationMs: 10 },
  ]);
  assert.match(renderStats(withOrphan), /orphans {7}1 {2}\(tool result with no matching call\)/);

  const withoutOrphan = computeStats([{ type: 'user', text: 'hi' }]);
  assert.equal(renderStats(withoutOrphan).includes('orphans'), false);
});

test('renderTimeline merges a tool_call and its result onto one line', () => {
  const events: TraceEvent[] = [
    { type: 'tool_call', ts: 0, id: 'c1', name: 'read_file', args: { path: 'a.ts' } },
    { type: 'tool_result', ts: 54, id: 'c1', ok: true, durationMs: 54 },
  ];

  const text = renderTimeline(events);
  assert.equal(text.split('\n').length, 1);
  assert.match(text, /tool_call/);
  assert.match(text, /read_file\(\{"path":"a\.ts"\}\) -> ok in 54ms/);
});

test('renderTimeline marks a call with no result as pending and a failed one as FAILED', () => {
  const events: TraceEvent[] = [
    { type: 'tool_call', ts: 0, id: 'c1', name: 'run_tests' },
    { type: 'tool_call', ts: 0, id: 'c2', name: 'run_tests' },
    { type: 'tool_result', ts: 10, id: 'c2', ok: false, durationMs: 10 },
  ];

  const lines = renderTimeline(events).split('\n');
  assert.match(lines[0], /run_tests\(\) -> pending/);
  assert.match(lines[1], /run_tests\(\) -> FAILED in 10ms/);
});

test('renderTimeline reports an unmatched result as an orphan on its own line', () => {
  const events: TraceEvent[] = [{ type: 'tool_result', ts: 0, id: 'ghost', ok: true, durationMs: 5 }];
  const text = renderTimeline(events);
  assert.match(text, /orphan result \(id ghost\), ok=true/);
});

test('renderTimeline --tool filters to a single tool and drops user/assistant text', () => {
  const events: TraceEvent[] = [
    { type: 'user', ts: 0, text: 'go' },
    { type: 'tool_call', ts: 0, id: 'c1', name: 'run_tests' },
    { type: 'tool_result', ts: 10, id: 'c1', ok: true, durationMs: 10 },
    { type: 'tool_call', ts: 10, id: 'c2', name: 'apply_patch' },
    { type: 'tool_result', ts: 20, id: 'c2', ok: true, durationMs: 10 },
    { type: 'assistant', ts: 20, text: 'done' },
  ];

  const lines = renderTimeline(events, { tool: 'run_tests' }).split('\n');
  assert.equal(lines.length, 1);
  assert.match(lines[0], /run_tests/);
});

test('renderTimeline hideText drops user and assistant lines but keeps tool lines', () => {
  const events: TraceEvent[] = [
    { type: 'user', ts: 0, text: 'go' },
    { type: 'tool_call', ts: 0, id: 'c1', name: 'run_tests' },
    { type: 'tool_result', ts: 10, id: 'c1', ok: true, durationMs: 10 },
    { type: 'assistant', ts: 10, text: 'done' },
  ];

  const lines = renderTimeline(events, { hideText: true }).split('\n');
  assert.equal(lines.length, 1);
  assert.match(lines[0], /tool_call/);
});

test('renderTimeline maxArgLength truncates long JSON args with an ellipsis', () => {
  const events: TraceEvent[] = [
    { type: 'tool_call', ts: 0, id: 'c1', name: 'write_file', args: { path: 'a.ts', contents: 'x'.repeat(100) } },
  ];

  const text = renderTimeline(events, { maxArgLength: 20 });
  const argsMatch = text.match(/write_file\((.*)\) ->/);
  assert.ok(argsMatch);
  assert.equal(argsMatch[1].length, 21); // 20 chars + ellipsis
  assert.ok(argsMatch[1].endsWith('…'));
});
