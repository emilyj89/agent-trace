export interface UsageInfo {
  inputTokens: number;
  outputTokens: number;
}

export interface UserEvent {
  type: 'user';
  ts?: number;
  text?: string;
}

export interface AssistantEvent {
  type: 'assistant';
  ts?: number;
  text?: string;
  usage?: UsageInfo;
}

export interface ToolCallEvent {
  type: 'tool_call';
  ts?: number;
  id?: string;
  name?: string;
  args?: unknown;
}

export interface ToolResultEvent {
  type: 'tool_result';
  ts?: number;
  id?: string;
  ok?: boolean;
  durationMs?: number;
  output?: unknown;
}

export type TraceEvent = UserEvent | AssistantEvent | ToolCallEvent | ToolResultEvent;

export interface ParseIssue {
  line: number;
  message: string;
  raw: string;
}

export interface ParseResult {
  events: TraceEvent[];
  issues: ParseIssue[];
}

export interface LineResult {
  event?: TraceEvent;
  issue?: ParseIssue;
}

export interface ToolSpan {
  id?: string;
  name?: string;
  call: ToolCallEvent;
  result?: ToolResultEvent;
  ok?: boolean;
  durationMs?: number;
}

export interface PairResult {
  spans: ToolSpan[];
  orphans: ToolResultEvent[];
}

export interface TokenTotals {
  inputTokens: number;
  outputTokens: number;
}

export interface ToolStats {
  name: string;
  calls: number;
  failures: number;
  totalMs: number;
  avgMs: number;
  maxMs: number;
  /** Fraction (0..1) of toolTimeMs spent in this tool. */
  timeShare: number;
}

export interface TraceStats {
  totalEvents: number;
  eventCounts: { user: number; assistant: number; tool_call: number; tool_result: number };
  /** Newest ts minus oldest ts across all events, undefined if fewer than two carry a ts. */
  wallClockMs?: number;
  /** Sum of every tool span's durationMs. */
  toolTimeMs: number;
  /** Fraction (0..1) of wallClockMs spent in tools, undefined if wallClockMs is unknown. */
  toolTimeShare?: number;
  toolCalls: number;
  completedCalls: number;
  pendingCalls: number;
  failedCalls: number;
  /** Fraction (0..1) of toolCalls that failed, undefined if there were no calls. */
  failureRate?: number;
  orphanResults: number;
  tokens: TokenTotals;
  /** Per tool, sorted by totalMs descending. */
  tools: ToolStats[];
}
