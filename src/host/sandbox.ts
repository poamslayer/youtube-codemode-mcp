import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import readline from "node:readline";
import type { Readable } from "node:stream";

const SANDBOX_DIR = fileURLToPath(new URL("../../sandbox/", import.meta.url));
const CONFIG = `${SANDBOX_DIR}workerd.capnp`;
const RUNTIME_SOURCE = readFileSync(`${SANDBOX_DIR}runtime.js`, "utf8");
const WORKERD_BIN: string = createRequire(import.meta.url)("workerd").default;

export type SandboxError = { name: string; message: string; status?: number; reason?: string; details?: unknown };

export type SandboxOutcome =
  | { ok: true; json: string | undefined; logs: string[] }
  | { ok: false; error: SandboxError; logs: string[] };

export type SandboxRun = {
  runId: string;
  code: string;
  timeoutMs: number;
  deadlineAt?: () => number;
  bridge?: { port: number; secret: string };
  spec?: unknown;
};

function mainModule(code: string, withYt: boolean, withSpec: boolean): string {
  return `import { WorkerEntrypoint } from "cloudflare:workers";
import { run, formatDuration, durationSeconds, isLikelyShort, toRows } from "./runtime.js";
${withSpec ? 'import spec from "./spec.json";' : ""}
export default class extends WorkerEntrypoint {
  run() {
    return run(${withYt ? "this.env.YT" : "undefined"}, async (yt) => {
${code}
    });
  }
}
`;
}

function waitForPort(controlFd: Readable): Promise<number> {
  return new Promise((resolve) => {
    readline.createInterface({ input: controlFd }).on("line", (line) => {
      const msg = JSON.parse(line) as { event: string; socket?: string; port?: number };
      if (msg.event === "listen" && msg.socket === "http" && msg.port) resolve(msg.port);
    });
  });
}

export async function runSandbox(r: SandboxRun): Promise<SandboxOutcome> {
  const secret = r.bridge?.secret ?? "unused";
  const child = spawn(
    WORKERD_BIN,
    [
      "serve",
      "--experimental",
      "--control-fd=3",
      "--socket-addr=http=127.0.0.1:0",
      `--external-addr=bridge=127.0.0.1:${r.bridge?.port ?? 9}`,
      CONFIG,
    ],
    { stdio: ["ignore", "ignore", "pipe", "pipe"], env: { YT_SANDBOX_SECRET: secret } },
  );
  let stderr = "";
  child.stderr!.on("data", (c: Buffer) => (stderr = (stderr + c.toString()).slice(-4000)));
  const exited = new Promise<"exited">((resolve) => child.once("exit", () => resolve("exited")));

  const started = Date.now();
  const deadlineAt = r.deadlineAt ?? (() => started + r.timeoutMs);
  let timedOut = false;
  const timer = setInterval(() => {
    if (Date.now() < deadlineAt()) return;
    timedOut = true;
    child.kill("SIGKILL");
  }, 100);

  try {
    const port = await Promise.race([waitForPort(child.stdio[3] as Readable), exited]);
    if (port === "exited") throw new Error(`workerd exited before listening: ${stderr.trim()}`);

    const res = await fetch(`http://127.0.0.1:${port}/`, {
      method: "POST",
      headers: { authorization: `Bearer ${secret}`, "content-type": "application/json" },
      body: JSON.stringify({
        runId: r.runId,
        bindYt: Boolean(r.bridge),
        modules: {
          "main.js": mainModule(r.code, Boolean(r.bridge), r.spec !== undefined),
          "runtime.js": RUNTIME_SOURCE,
          ...(r.spec === undefined ? {} : { "spec.json": { json: r.spec } }),
        },
      }),
    });
    return (await res.json()) as SandboxOutcome;
  } catch (e) {
    if (timedOut) {
      return {
        ok: false,
        error: { name: "TimeoutError", message: `Execution exceeded its ${r.timeoutMs}ms limit and was stopped. Logs from the run are lost.` },
        logs: [],
      };
    }
    throw e;
  } finally {
    clearInterval(timer);
    child.kill("SIGKILL");
  }
}
