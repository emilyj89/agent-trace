import assert from 'node:assert/strict';
import { test } from 'node:test';
import { pairToolEvents } from '../src/pair.ts';
import type { TraceEvent } from '../src/types.ts';

test('matches a call and result by id', () => {
  const events: TraceEvent[] = [
    { type: 'tool_call', ts: 0, id: 'c1', name: 'read_file', args: { path: 'a' } },
    { type: 'tool_result', ts: 54, id: 'c1', ok: true, durationMs: 50, output: 'ok' },
  ];

  const { spans, orphans } = pairToolEvents(events);
  assert.equal(spans.length, 1);
  assert.equal(orphans.length, 0);
  assert.equal(spans[0].name, 'read_file');
  assert.equal(spans[0].ok, true);
  assert.equal(spans[0].durationMs, 50);
  assert.equal(spans[0].result, events[1]);
});

test('falls back to the timestamp delta when durationMs is absent', () => {
  const events: TraceEvent[] = [
    { type: 'tool_call', ts: 1000, id: 'c1', name: 'run_tests' },
    { type: 'tool_result', ts: 1120, id: 'c1', ok: true },
  ];

  const { spans } = pairToolEvents(events);
  assert.equal(spans[0].durationMs, 120);
});

test('a result with no id matches the oldest still-open call', () => {
  const events: TraceEvent[] = [
    { type: 'tool_call', id: 'c1', name: 'read_file' },
    { type: 'tool_call', id: 'c2', name: 'apply_patch' },
    { type: 'tool_result', ok: true },
    { type: 'tool_result', ok: false },
  ];

  const { spans, orphans } = pairToolEvents(events);
  assert.equal(orphans.length, 0);
  assert.equal(spans[0].name, 'read_file');
  assert.equal(spans[0].ok, true);
  assert.equal(spans[1].name, 'apply_patch');
  assert.equal(spans[1].ok, false);
});

test('a result whose id matches nothing is an orphan, not attached to another call', () => {
  const events: TraceEvent[] = [
    { type: 'tool_call', id: 'c1', name: 'read_file' },
    { type: 'tool_result', id: 'does-not-exist', ok: true },
  ];

  const { spans, orphans } = pairToolEvents(events);
  assert.equal(orphans.length, 1);
  assert.equal(orphans[0].id, 'does-not-exist');
  assert.equal(spans[0].result, undefined);
});

test('an id-less result with no open calls is an orphan', () => {
  const events: TraceEvent[] = [{ type: 'tool_result', ok: true }];

  const { spans, orphans } = pairToolEvents(events);
  assert.equal(spans.length, 0);
  assert.equal(orphans.length, 1);
});

test('a call that never gets a result stays pending', () => {
  const events: TraceEvent[] = [{ type: 'tool_call', id: 'c1', name: 'read_file' }];

  const { spans, orphans } = pairToolEvents(events);
  assert.equal(spans.length, 1);
  assert.equal(spans[0].result, undefined);
  assert.equal(spans[0].ok, undefined);
  assert.equal(orphans.length, 0);
});

test('non-tool events are ignored', () => {
  const events: TraceEvent[] = [
    { type: 'user', text: 'hi' },
    { type: 'assistant', text: 'ok' },
  ];

  const { spans, orphans } = pairToolEvents(events);
  assert.equal(spans.length, 0);
  assert.equal(orphans.length, 0);
});
