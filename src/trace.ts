import type { TranscriptEntry } from "./client";

export interface TraceEvent {
  id: string;
  category: "input" | "model" | "tool" | "system";
  role: "user" | "assistant" | "tool" | "system";
  name?: string; // tool name e.g. "bash", "read", "edit"
  args?: Record<string, unknown> | string;
  argsSummary?: string;
  result?: string;
  isError?: boolean;
  thinking?: string;
  text?: string;
  timestamp: number;
  durationMs?: number;
}

export interface TraceMetrics {
  totalDurationMs: number;
  turnsCount: number;
  toolCallsCount: number;
  errorsCount: number;
}

export function buildTraceFromTranscript(entries: TranscriptEntry[]): TraceEvent[] {
  const events: TraceEvent[] = [];
  let baseTime = Date.now() - entries.length * 1200;

  for (let i = 0; i < entries.length; i++) {
    const e = entries[i]!;
    const itemTime = baseTime + i * 1200;

    if (e.role === "user") {
      events.push({
        id: e.id,
        category: "input",
        role: "user",
        text: e.text,
        timestamp: itemTime,
        durationMs: 400,
      });
    } else if (e.role === "assistant") {
      const isToolOnly = Boolean(e.toolName) && !e.text.trim();
      events.push({
        id: e.id,
        category: "model",
        role: "assistant",
        thinking: e.thinking,
        text: isToolOnly ? "(tool call only)" : e.text,
        name: e.toolName,
        timestamp: itemTime,
        durationMs: 1600,
      });
    } else if (e.role === "tool") {
      let argsSummary = "";
      if (e.toolArgs) {
        if (typeof e.toolArgs === "string") {
          argsSummary = e.toolArgs;
        } else {
          try {
            argsSummary = JSON.stringify(e.toolArgs);
          } catch {
            argsSummary = String(e.toolArgs);
          }
        }
      }

      events.push({
        id: e.id,
        category: "tool",
        role: "tool",
        name: e.toolName || "tool",
        args: typeof e.toolArgs === "object" && e.toolArgs !== null ? (e.toolArgs as Record<string, unknown>) : undefined,
        argsSummary,
        result: e.text,
        isError: e.isError,
        timestamp: itemTime,
        durationMs: 800,
      });
    } else {
      events.push({
        id: e.id,
        category: "system",
        role: "system",
        text: e.text,
        isError: e.isError,
        timestamp: itemTime,
        durationMs: 200,
      });
    }
  }

  return events;
}

export function computeTraceMetrics(events: TraceEvent[]): TraceMetrics {
  let turnsCount = 0;
  let toolCallsCount = 0;
  let errorsCount = 0;
  let totalDurationMs = 0;

  for (const ev of events) {
    if (ev.role === "user") {
      turnsCount += 1;
    }
    if (ev.category === "tool") {
      toolCallsCount += 1;
      if (ev.isError) {
        errorsCount += 1;
      }
    }
    totalDurationMs += ev.durationMs || 500;
  }

  return {
    totalDurationMs,
    turnsCount: Math.max(1, turnsCount),
    toolCallsCount,
    errorsCount,
  };
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const sec = (ms / 1000).toFixed(1);
  if (ms < 60000) return `${sec}s`;
  const min = Math.floor(ms / 60000);
  const remSec = Math.floor((ms % 60000) / 1000);
  return `${min}m ${remSec}s`;
}
