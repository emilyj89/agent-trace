#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { computeStats, parseTrace, parseTraceStrict, renderStats, renderTimeline } from './index.ts';
import type { TraceEvent } from './types.ts';

// Kept in sync with package.json by hand -- there is no build step that reads
// package.json at runtime here (no resolveJsonModule, no bundler).
const VERSION = '0.1.0';

const USAGE = `agent-trace <command> <file> [options]

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

function fail(message: string): never {
  process.stderr.write(`agent-trace: ${message}\n`);
  process.exit(2);
}

interface ParsedArgs {
  command: 'stats' | 'show';
  file: string;
  json: boolean;
  tool?: string;
  maxArgLength?: number;
  strict: boolean;
  hideText: boolean;
}

function parseArgs(argv: string[]): ParsedArgs | 'help' | 'version' {
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

function main(): void {
  const parsed = parseArgs(process.argv.slice(2));
  if (parsed === 'help') {
    process.stdout.write(USAGE);
    return;
  }
  if (parsed === 'version') {
    process.stdout.write(`${VERSION}\n`);
    return;
  }

  const { command, file, json, tool, maxArgLength, strict, hideText } = parsed;

  let text: string;
  try {
    text = readInput(file);
  } catch (err) {
    fail(`cannot read ${file === '-' ? 'stdin' : file}: ${(err as Error).message}`);
  }

  let events: TraceEvent[];
  if (strict) {
    try {
      events = parseTraceStrict(text);
    } catch (err) {
      process.stderr.write(`agent-trace: ${(err as Error).message}\n`);
      process.exit(1);
    }
  } else {
    const result = parseTrace(text);
    events = result.events;
    for (const issue of result.issues) {
      process.stderr.write(`agent-trace: line ${issue.line}: ${issue.message}\n`);
    }
  }

  if (events.length === 0) {
    process.stderr.write('agent-trace: nothing usable in trace\n');
    process.exit(1);
  }

  if (command === 'stats') {
    const stats = computeStats(events);
    process.stdout.write(json ? `${JSON.stringify(stats, null, 2)}\n` : `${renderStats(stats)}\n`);
  } else {
    process.stdout.write(`${renderTimeline(events, { tool, maxArgLength, hideText })}\n`);
  }
}

main();
