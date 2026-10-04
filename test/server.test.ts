import { afterAll, beforeAll, expect, it } from "vitest";
import { spawn } from "node:child_process";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const client = new Client({ name: "test", version: "0.0.0" });

beforeAll(async () => {
  await client.connect(new StdioClientTransport({ command: process.execPath, args: ["--import", "tsx", "src/index.ts"] }));
}, 30_000);
afterAll(() => client.close());

it("lists exactly docs, search, execute", async () => {
  const { tools } = await client.listTools();
  expect(tools.map((t) => t.name).sort()).toEqual(["docs", "execute", "search"]);
});

it("runs execute over stdio", async () => {
  const res = await client.callTool({ name: "execute", arguments: { code: "return 6 * 7" } });
  expect(res.isError).toBe(false);
  expect(JSON.parse((res.content as { text: string }[])[0]!.text)).toEqual({ ok: true, result: 42, logs: [] });
});

it("exits when its client closes stdin", async () => {
  const child = spawn(process.execPath, ["--import", "tsx", "src/index.ts"], { stdio: ["pipe", "ignore", "ignore"] });
  await new Promise((resolve) => setTimeout(resolve, 2_000));
  const exited = new Promise<number | null>((resolve) => child.on("exit", (code) => resolve(code)));
  child.stdin.end();
  const code = await Promise.race([exited, new Promise<"timeout">((resolve) => setTimeout(() => resolve("timeout"), 5_000))]);
  if (code === "timeout") child.kill("SIGKILL");
  expect(code).toBe(0);
}, 15_000);
