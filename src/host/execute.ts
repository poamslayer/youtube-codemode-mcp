import { randomUUID } from "node:crypto";
import type { Bridge } from "./bridge.js";
import { runSandbox, type SandboxError } from "./sandbox.js";

export const MAX_OUTPUT_CHARS = 100_000;

export type ExecuteLimits = { timeoutMs: number; maxCalls: number; quotaBudget?: number };

export const DEFAULT_LIMITS: ExecuteLimits = { timeoutMs: 60_000, maxCalls: 500 };

export type ExecuteResult =
  | { ok: true; result: unknown; logs: string[]; truncated?: true; hint?: string }
  | { ok: false; error: SandboxError; logs: string[] };

export function shapeOutput(json: string | undefined): { result: unknown; truncated?: true; hint?: string } {
  if (json === undefined) return { result: null };
  if (json.length <= MAX_OUTPUT_CHARS) return { result: JSON.parse(json) };
  return {
    result: json.slice(0, MAX_OUTPUT_CHARS),
    truncated: true,
    hint: `Result was ${json.length} chars serialized, over the ${MAX_OUTPUT_CHARS} cap. Aggregate, filter, or pick fields in code and return less.`,
  };
}

export async function execute(bridge: Bridge, code: string, limits: ExecuteLimits = DEFAULT_LIMITS): Promise<ExecuteResult> {
  const runId = randomUUID();
  const run = { runId, callsUsed: 0, maxCalls: limits.maxCalls, deadlineAt: Date.now() + limits.timeoutMs, quotaBudget: limits.quotaBudget, unitsSpent: 0 };
  bridge.register(run);
  try {
    const outcome = await runSandbox({ runId, code, timeoutMs: limits.timeoutMs, deadlineAt: () => run.deadlineAt, bridge });
    if (!outcome.ok) return outcome;
    return { ok: true, logs: outcome.logs, ...shapeOutput(outcome.json) };
  } finally {
    bridge.unregister(runId);
  }
}
