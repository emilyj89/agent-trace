import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseTrace, parseTraceLine, parseTraceStrict } from '../src/parse.ts';

test('parses one event of each known type', () => {
  const line = parseTraceLine('{"type":"user","ts":1,"text":"hi"}');
  assert.deepEqual(line.event, { type: 'user', ts: 1, text: 'hi' });

  const call = parseTraceLine('{"type":"tool_call","id":"c1","name":"read_file","args":{"path":"a"}}');
  assert.deepEqual(call.event, {
    type: 'tool_call',
    ts: undefined,
    id: 'c1',
    name: 'read_file',
    args: { path: 'a' },
  });

  const result = parseTraceLine('{"type":"tool_result","id":"c1","ok":true,"durationMs":50}');
  assert.deepEqual(result.event, {
    type: 'tool_result',
    ts: undefined,
    id: 'c1',
    ok: true,
    durationMs: 50,
    output: undefined,
  });
});

test('assistant usage is normalized to camelCase', () => {
  const { event } = parseTraceLine(
    '{"type":"assistant","text":"ok","usage":{"input_tokens":10,"output_tokens":2}}',
  );
  assert.deepEqual(event, {
    type: 'assistant',
    ts: undefined,
    text: 'ok',
    usage: { inputTokens: 10, outputTokens: 2 },
  });
});

test('accepts alternate field names', () => {
  const { event } = parseTraceLine(
    '{"role":"tool_call","timestamp":5,"tool":"run_tests","arguments":{"path":"x"}}',
  );
  assert.deepEqual(event, { type: 'tool_call', ts: 5, id: undefined, name: 'run_tests', args: { path: 'x' } });
});

test('reports invalid JSON as an issue, not a throw', () => {
  const { event, issue } = parseTraceLine('{not json', 3);
  assert.equal(event, undefined);
  assert.equal(issue?.line, 3);
  assert.match(issue?.message ?? '', /invalid JSON/);
});

test('reports a JSON array or scalar as not an object', () => {
  assert.match(parseTraceLine('[1,2,3]').issue?.message ?? '', /not a JSON object/);
  assert.match(parseTraceLine('"just a string"').issue?.message ?? '', /not a JSON object/);
});

test('reports missing or unknown type', () => {
  assert.match(parseTraceLine('{"text":"no type field"}').issue?.message ?? '', /unknown or missing type/);
  assert.match(parseTraceLine('{"type":"heartbeat"}').issue?.message ?? '', /unknown or missing type/);
});

test('blank line produces neither an event nor an issue', () => {
  const result = parseTraceLine('   ');
  assert.equal(result.event, undefined);
  assert.equal(result.issue, undefined);
});

test('parseTrace skips blank lines and collects issues with correct line numbers', () => {
  const text = [
    '{"type":"user","text":"a"}',
    '',
    'not json at all',
    '{"type":"assistant","text":"b"}',
  ].join('\n');

  const { events, issues } = parseTrace(text);
  assert.equal(events.length, 2);
  assert.equal(issues.length, 1);
  assert.equal(issues[0].line, 3);
});

test('parseTraceStrict throws when any line is unusable', () => {
  assert.throws(() => parseTraceStrict('{"type":"user","text":"a"}\nnot json'), /line 2/);
});

test('parseTraceStrict returns events when the whole trace is clean', () => {
  const events = parseTraceStrict('{"type":"user","text":"a"}\n{"type":"assistant","text":"b"}');
  assert.equal(events.length, 2);
});
