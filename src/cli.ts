#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { computeStats, parseTrace, parseTraceStrict, renderStats, renderTimeline } from './index.ts';
import type { TraceEvent } from './types.ts';

// Kept in sync with package.json by hand -- there is no build step that reads
// package.json at runtime here (no resolveJsonModule, no bundler).
export const VERSION = '0.1.0';

export const USAGE = `agent-trace <command> <file> [options]

Commands:
  stats   totals, per-tool timing, token usage
  show    indented timeline of the session

Options:
  --json          print stats as JSON instead of a table (stats only)
  --tool=<name>   restrict show to a single tool
  --max-arg=<n>   truncate tool arguments to n characters (default 80)
  --no-text       hide user and assistant messages
  --strict        exit 1 if any line failed to parse
  -h, --help      show this help
  --version       show version

Pass - as <file> to read the trace from stdin.
`;

// Thrown for bad usage instead of exiting directly, so parseArgs and runCli
// stay plain functions that tests can call without spawning a process.
export class CliError extends Error {
  constructor(
    message: string,
    readonly exitCode = 2,
  ) {
    super(message);
  }
}

function fail(message: string): never {
  throw new CliError(message);
}

export interface ParsedArgs {
  command: 'stats' | 'show';
  file: string;
  json: boolean;
  tool?: string;
  maxArgLength?: number;
  strict: boolean;
  hideText: boolean;
}

export function parseArgs(argv: string[]): ParsedArgs | 'help' | 'version' {
  if (argv.includes('-h') || argv.includes('--help')) return 'help';
  if (argv.includes('--version')) return 'version';

  const [command, ...rest] = argv;
  if (command !== 'stats' && command !== 'show') {
    fail(`unknown command: ${command ?? '(none)'} (expected "stats" or "show")`);
  }

  let file: string | undefined;
  let json = false;
  let tool: string | undefined;
  let maxArgLength: number | undefined;
  let strict = false;
  let hideText = false;

  for (const arg of rest) {
    if (arg === '--json') {
      json = true;
      continue;
    }
    if (arg === '--strict') {
      strict = true;
      continue;
    }
    if (arg === '--no-text') {
      hideText = true;
      continue;
    }
    if (arg.startsWith('--tool=')) {
      tool = arg.slice('--tool='.length);
      continue;
    }
    if (arg.startsWith('--max-arg=')) {
      const raw = arg.slice('--max-arg='.length);
      const value = Number(raw);
      if (!Number.isFinite(value) || value < 0) fail(`--max-arg must be a non-negative number, got ${raw}`);
      maxArgLength = value;
      continue;
    }
    if (arg.startsWith('-')) fail(`unknown option: ${arg}`);
    if (file !== undefined) fail(`unexpected extra argument: ${arg}`);
    file = arg;
  }

  if (file === undefined) fail('missing <file> argument (pass - for stdin)');
  if (json && command === 'show') fail('--json is only valid with the "stats" command');

  return { command, file, json, tool, maxArgLength, strict, hideText };
}

function readInput(file: string): string {
  return readFileSync(file === '-' ? 0 : file, 'utf8');
}

export interface RunResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

// Pure aside from the injected reader, so tests exercise the whole command
// pipeline (arg parsing, parse issues, stats/show rendering) without files,
// stdin or process.exit.
export function runCli(argv: string[], readTrace: (file: string) => string): RunResult {
  let stdout = '';
  let stderr = '';

  try {
    const parsed = parseArgs(argv);
    if (parsed === 'help') return { stdout: USAGE, stderr: '', exitCode: 0 };
    if (parsed === 'version') return { stdout: `${VERSION}\n`, stderr: '', exitCode: 0 };

    const { command, file, json, tool, maxArgLength, strict, hideText } = parsed;

    let text: string;
    try {
      text = readTrace(file);
    } catch (err) {
      throw new CliError(`cannot read ${file === '-' ? 'stdin' : file}: ${(err as Error).message}`);
    }

    let events: TraceEvent[];
    if (strict) {
      events = parseTraceStrict(text);
    } else {
      const result = parseTrace(text);
      events = result.events;
      for (const issue of result.issues) {
        stderr += `agent-trace: line ${issue.line}: ${issue.message}\n`;
      }
    }

    if (events.length === 0) {
      return { stdout, stderr: `${stderr}agent-trace: nothing usable in trace\n`, exitCode: 1 };
    }

    if (command === 'stats') {
      const stats = computeStats(events);
      stdout += json ? `${JSON.stringify(stats, null, 2)}\n` : `${renderStats(stats)}\n`;
    } else {
      stdout += `${renderTimeline(events, { tool, maxArgLength, hideText })}\n`;
    }

    return { stdout, stderr, exitCode: 0 };
  } catch (err) {
    if (err instanceof CliError) {
      return { stdout, stderr: `agent-trace: ${err.message}\n`, exitCode: err.exitCode };
    }
    // parseTraceStrict throws a plain Error naming the first bad line.
    return { stdout, stderr: `agent-trace: ${(err as Error).message}\n`, exitCode: 1 };
  }
}

function main(): void {
  const result = runCli(process.argv.slice(2), readInput);
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.exitCode !== 0) process.exit(result.exitCode);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
