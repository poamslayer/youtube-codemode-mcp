import { OpError, type OpErrorInfo } from "./bridge.js";
import type { RestOp } from "./ops.js";

export type HttpRequest = { method: string; url: string; body?: string };

const SYSTEM_PARAMS = new Set(["fields", "prettyPrint", "quotaUser"]);

function badRequest(message: string): OpError {
  return new OpError({ status: 400, reason: "invalidParams", message });
}

function scalar(v: unknown): string {
  return typeof v === "string" ? v : typeof v === "object" && v !== null ? JSON.stringify(v) : String(v);
}

export function buildRequest(op: RestOp, params: Record<string, unknown> = {}, body?: unknown): HttpRequest {
  const specs = op.method.parameters ?? {};
  const unknown = Object.keys(params).filter((k) => !specs[k] && !SYSTEM_PARAMS.has(k));
  if (unknown.length) {
    throw badRequest(`${op.id} has no parameter ${unknown.join(", ")}. Valid: ${Object.keys(specs).sort().join(", ")}`);
  }
  const missing = Object.entries(specs)
    .filter(([k, s]) => s.required && params[k] === undefined)
    .map(([k]) => k);
  if (missing.length) throw badRequest(`${op.id} requires ${missing.join(", ")}.`);

  const path = op.method.path.replace(/\{(\+?)([^}]+)\}/g, (_, reserved: string, name: string) => {
    const v = scalar(params[name]);
    return reserved ? encodeURI(v) : encodeURIComponent(v);
  });
  const url = new URL(op.baseUrl + path);
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || specs[k]?.location === "path") continue;
    if (Array.isArray(v)) {
      if (specs[k]?.repeated) for (const item of v) url.searchParams.append(k, scalar(item));
      else url.searchParams.set(k, v.map(scalar).join(","));
    } else {
      url.searchParams.set(k, scalar(v));
    }
  }
  return { method: op.method.httpMethod, url: url.toString(), ...(body === undefined ? {} : { body: JSON.stringify(body) }) };
}

type GoogleErrorBody = { error?: { code?: number; message?: string; status?: string; errors?: { reason?: string; message?: string }[] } };

export function normalizeError(status: number, text: string): OpErrorInfo {
  let parsed: GoogleErrorBody = {};
  try {
    parsed = JSON.parse(text);
  } catch {}
  const e = parsed.error;
  return {
    status,
    reason: e?.errors?.[0]?.reason ?? e?.status ?? `http${status}`,
    message: e?.message ?? (text.slice(0, 500) || `HTTP ${status}`),
  };
}

export async function send(req: HttpRequest, headers: Record<string, string>): Promise<unknown> {
  const res = await fetch(req.url, {
    method: req.method,
    headers: { ...headers, ...(req.body ? { "content-type": "application/json" } : {}) },
    body: req.body,
  });
  const text = await res.text();
  if (!res.ok) throw new OpError(normalizeError(res.status, text));
  if (!text) return null;
  return res.headers.get("content-type")?.includes("json") ? JSON.parse(text) : text;
}
