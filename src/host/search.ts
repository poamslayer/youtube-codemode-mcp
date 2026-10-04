import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { shapeOutput, type ExecuteResult } from "./execute.js";
import { buildRegistry, loadSpec } from "./ops.js";
import { runSandbox } from "./sandbox.js";

export const SEARCH_TIMEOUT_MS = 10_000;

export function buildSpec() {
  const quotaCosts = Object.fromEntries(
    [...buildRegistry([]).values()].flatMap((op) => (op.charge ? [[op.id, op.charge]] : [])),
  );
  return {
    youtube: loadSpec("youtube"),
    analytics: loadSpec("analytics"),
    reporting: loadSpec("reporting"),
    analyticsFields: JSON.parse(readFileSync(new URL("../../specs/analytics-fields.json", import.meta.url), "utf8")),
    quotaCosts,
  };
}

export async function search(spec: unknown, code: string): Promise<ExecuteResult> {
  const outcome = await runSandbox({ runId: randomUUID(), code, timeoutMs: SEARCH_TIMEOUT_MS, spec });
  if (!outcome.ok) return outcome;
  return { ok: true, logs: outcome.logs, ...shapeOutput(outcome.json) };
}
