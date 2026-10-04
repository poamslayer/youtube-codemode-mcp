import http from "node:http";
import { randomBytes } from "node:crypto";
import type { AddressInfo } from "node:net";

export type CallArgs = { params?: Record<string, unknown>; body?: unknown; options?: { confirm?: boolean } };

export type OpErrorInfo = { status?: number; reason: string; message: string; details?: unknown };

export class OpError extends Error {
  constructor(readonly info: OpErrorInfo) {
    super(info.message);
  }
}

export type RunContext = { runId: string; callsUsed: number; maxCalls: number; deadlineAt: number; quotaBudget?: number; unitsSpent: number };

export type Dispatch = (op: string, args: CallArgs, run: RunContext) => Promise<unknown>;

type BridgeResult = { ok: true; value: unknown } | { ok: false; error: OpErrorInfo };

export type Bridge = {
  port: number;
  secret: string;
  register(run: RunContext): void;
  unregister(runId: string): void;
  close(): Promise<void>;
};

const MAX_BODY = 10 * 1024 * 1024;

export async function startBridge(dispatch: Dispatch): Promise<Bridge> {
  const secret = randomBytes(32).toString("hex");
  const runs = new Map<string, RunContext>();

  async function handle(raw: string): Promise<BridgeResult> {
    const { runId, op, args } = JSON.parse(raw) as { runId: string; op: string; args: CallArgs };
    const run = runs.get(runId);
    if (!run) return { ok: false, error: { reason: "runEnded", message: "This execute() run has already ended." } };
    if (++run.callsUsed > run.maxCalls) {
      return {
        ok: false,
        error: { reason: "callLimit", message: `More than ${run.maxCalls} yt calls in one execute(). Batch ids (videos.list takes 50) or split the work.` },
      };
    }
    try {
      return { ok: true, value: await dispatch(op, args ?? {}, run) };
    } catch (e) {
      if (e instanceof OpError) return { ok: false, error: e.info };
      return { ok: false, error: { reason: "internal", message: e instanceof Error ? e.message : String(e) } };
    }
  }

  const server = http.createServer((req, res) => {
    if (req.method !== "POST" || req.url !== "/call" || req.headers.authorization !== `Bearer ${secret}`) {
      res.writeHead(403).end();
      return;
    }
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY) req.destroy();
      else chunks.push(c);
    });
    req.on("end", async () => {
      const result = await handle(Buffer.concat(chunks).toString("utf8"));
      res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(result));
    });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));

  return {
    port: (server.address() as AddressInfo).port,
    secret,
    register: (run) => void runs.set(run.runId, run),
    unregister: (runId) => void runs.delete(runId),
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}
