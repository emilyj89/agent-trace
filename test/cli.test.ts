import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseArgs, runCli, USAGE, VERSION } from '../src/cli.ts';

const SAMPLE_TRACE = [
  '{"type":"user","ts":1,"text":"hi"}',
  '{"type":"assistant","ts":2,"text":"ok","usage":{"input_tokens":10,"output_tokens":2}}',
  '{"type":"tool_call","ts":3,"id":"c1","name":"read_file","args":{"path":"a"}}',
  '{"type":"tool_result","ts":4,"id":"c1","ok":true,"durationMs":50}',
].join('\n');

function readFrom(text: string): (file: string) => string {
  return () => text;
}

test('parseArgs recognizes -h/--help and --version before checking the command', () => {
  assert.equal(parseArgs(['-h']), 'help');
  assert.equal(parseArgs(['--help']), 'help');
  assert.equal(parseArgs(['--version']), 'version');
  assert.equal(parseArgs(['--version', 'bogus']), 'version');
});

test('parseArgs collects options and leaves the rest at their defaults', () => {
  const parsed = parseArgs(['show', 'trace.jsonl', '--tool=run_tests', '--max-arg=40', '--no-text']);
  assert.deepEqual(parsed, {
    command: 'show',
    file: 'trace.jsonl',
    json: false,
    tool: 'run_tests',
    maxArgLength: 40,
    strict: false,
    hideText: true,
  });
});

test('--help prints usage and exits 0', () => {
  const result = runCli(['--help'], readFrom(''));
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout, USAGE);
  assert.equal(result.stderr, '');
});

test('--version prints the version and exits 0', () => {
  const result = runCli(['--version'], readFrom(''));
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout, `${VERSION}\n`);
});

test('unknown command fails with exit code 2', () => {
  const result = runCli(['bogus', 'trace.jsonl'], readFrom(''));
  assert.equal(result.exitCode, 2);
  assert.match(result.stderr, /unknown command: bogus/);
});

test('missing file argument fails with exit code 2', () => {
  const result = runCli(['stats'], readFrom(''));
  assert.equal(result.exitCode, 2);
  assert.match(result.stderr, /missing <file> argument/);
});

test('--json is rejected for the show command', () => {
  const result = runCli(['show', 'trace.jsonl', '--json'], readFrom(''));
  assert.equal(result.exitCode, 2);
  assert.match(result.stderr, /--json is only valid with the "stats" command/);
});

test('--max-arg rejects non-numeric and negative values', () => {
  const bad = runCli(['show', 'trace.jsonl', '--max-arg=nope'], readFrom(''));
  assert.equal(bad.exitCode, 2);
  assert.match(bad.stderr, /--max-arg must be a non-negative number/);

  const negative = runCli(['show', 'trace.jsonl', '--max-arg=-1'], readFrom(''));
  assert.equal(negative.exitCode, 2);
});

test('a reader failure is reported as exit code 2, not a crash', () => {
  const result = runCli(['stats', 'missing.jsonl'], () => {
    throw new Error('ENOENT: no such file or directory');
  });
  assert.equal(result.exitCode, 2);
  assert.match(result.stderr, /cannot read missing\.jsonl/);
});

test('stats renders the text summary by default and exits 0', () => {
  const result = runCli(['stats', 'trace.jsonl'], readFrom(SAMPLE_TRACE));
  assert.equal(result.exitCode, 0);
  assert.equal(result.stderr, '');
  assert.match(result.stdout, /events\s+4/);
  assert.match(result.stdout, /tokens\s+10 in \/ 2 out = 12 total/);
});

test('stats --json prints parseable JSON matching the text summary', () => {
  const result = runCli(['stats', 'trace.jsonl', '--json'], readFrom(SAMPLE_TRACE));
  assert.equal(result.exitCode, 0);
  const stats = JSON.parse(result.stdout);
  assert.equal(stats.totalEvents, 4);
  assert.equal(stats.toolCalls, 1);
  assert.equal(stats.completedCalls, 1);
});

test('show renders a timeline and exits 0', () => {
  const result = runCli(['show', 'trace.jsonl'], readFrom(SAMPLE_TRACE));
  assert.equal(result.exitCode, 0);
  assert.match(result.stdout, /read_file/);
});

test('a trace with no usable lines exits 1', () => {
  const result = runCli(['stats', 'trace.jsonl'], readFrom('not json\nalso not json'));
  assert.equal(result.exitCode, 1);
  assert.match(result.stderr, /nothing usable in trace/);
});

test('bad lines are reported to stderr but do not stop stats from running', () => {
  const text = `${SAMPLE_TRACE}\nnot json`;
  const result = runCli(['stats', 'trace.jsonl'], readFrom(text));
  assert.equal(result.exitCode, 0);
  assert.match(result.stderr, /line 5: invalid JSON/);
  assert.match(result.stdout, /events\s+4/);
});

test('--strict exits 1 on the first unusable line instead of skipping it', () => {
  const text = `${SAMPLE_TRACE}\nnot json`;
  const result = runCli(['stats', 'trace.jsonl', '--strict'], readFrom(text));
  assert.equal(result.exitCode, 1);
  assert.match(result.stderr, /line 5/);
  assert.equal(result.stdout, '');
});
