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
