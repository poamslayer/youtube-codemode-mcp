import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { OpError, startBridge, type Bridge, type CallArgs } from "../src/host/bridge.js";
import { execute, MAX_OUTPUT_CHARS } from "../src/host/execute.js";

let bridge: Bridge;
const calls: { op: string; args: CallArgs }[] = [];

beforeAll(async () => {
  bridge = await startBridge(async (op, args) => {
    calls.push({ op, args });
    if (op === "youtube.videos.delete") throw new OpError({ status: 403, reason: "forbidden", message: "nope" });
    return { echoed: op, params: args.params };
  });
});
afterAll(() => bridge.close());

describe("execute", () => {
  it("returns the value of the code", async () => {
    expect(await execute(bridge, "return 1 + 1")).toEqual({ ok: true, result: 2, logs: [] });
  });

  it("captures console output", async () => {
    const out = await execute(bridge, `console.log("a", { b: 1 }); console.warn("w"); return null`);
    expect(out).toEqual({ ok: true, result: null, logs: ['a {"b":1}', "[warn] w"] });
  });

  it("routes yt.data calls through the bridge as dotted ops", async () => {
    const out = await execute(bridge, `return await yt.data.channels.list({ part: "snippet", mine: true })`);
    expect(out).toEqual({ ok: true, result: { echoed: "youtube.channels.list", params: { part: "snippet", mine: true } }, logs: [] });
  });

  it("routes nested reporting resources", async () => {
    const out = await execute(bridge, `return (await yt.reporting.jobs.reports.list({ jobId: "j" })).echoed`);
    expect(out).toEqual({ ok: true, result: "reporting.jobs.reports.list", logs: [] });
  });

  it("rethrows host errors with status and reason the code can catch", async () => {
    const out = await execute(
      bridge,
      `try { await yt.data.videos.delete({ id: "x" }) } catch (e) { return [e instanceof Error, e.status, e.reason, e.message] }`,
    );
    expect(out).toEqual({ ok: true, result: [true, 403, "forbidden", "nope"], logs: [] });
  });

  it("reports uncaught errors", async () => {
    const out = await execute(bridge, `throw new TypeError("bad")`);
    expect(out).toEqual({ ok: false, error: { name: "TypeError", message: "bad" }, logs: [] });
  });

  it("reports syntax errors instead of crashing", async () => {
    const out = await execute(bridge, `return (`);
    expect(out.ok).toBe(false);
    expect(!out.ok && out.error.message).toMatch(/SyntaxError|Unexpected/);
  });

  it("blocks direct network access", async () => {
    const out = await execute(bridge, `const r = await fetch("https://example.com"); return r.status`);
    expect(out).toMatchObject({ ok: false, error: { message: expect.stringContaining("not permitted to access the internet") } });
  });

  it("sees no host env, secrets, or files", async () => {
    const out = await execute(
      bridge,
      `const fs = await import("node:fs");
       const read = (p) => { try { return fs.readFileSync(p, "utf8").length } catch (e) { return e.code } };
       return [process.env, typeof require, read("/etc/passwd"), read(${JSON.stringify(import.meta.filename)}), fs.readdirSync("/").sort()]`,
    );
    expect(out).toEqual({ ok: true, result: [{}, "undefined", "ENOENT", "ENOENT", ["bundle", "dev", "tmp"]], logs: [] });
  });

  it("stops a runaway loop at the deadline", async () => {
    const t0 = Date.now();
    const out = await execute(bridge, `while (true) {}`, { timeoutMs: 1000, maxCalls: 10 });
    expect(out).toMatchObject({ ok: false, error: { name: "TimeoutError" } });
    expect(Date.now() - t0).toBeLessThan(3000);
  });

  it("runs in parallel without interference", async () => {
    const outs = await Promise.all([1, 2, 3, 4].map((n) => execute(bridge, `return ${n} * 10`)));
    expect(outs.map((o) => o.ok && o.result)).toEqual([10, 20, 30, 40]);
  });

  it("caps yt calls per run", async () => {
    const out = await execute(bridge, `for (let i = 0; i < 5; i++) await yt.quota(); return 1`, { timeoutMs: 10_000, maxCalls: 3 });
    expect(out).toMatchObject({ ok: false, error: { reason: "callLimit" } });
  });

  it("truncates oversized output with a hint", async () => {
    const out = await execute(bridge, `return "x".repeat(${MAX_OUTPUT_CHARS + 10})`);
    expect(out).toMatchObject({ ok: true, truncated: true, hint: expect.stringContaining("Aggregate") });
    expect(out.ok && (out.result as string).length).toBe(MAX_OUTPUT_CHARS);
  });

  it("paginates with nextPageToken", async () => {
    const out = await execute(
      bridge,
      `const pages = { "": { items: [1, 2], nextPageToken: "p2" }, p2: { items: [3], nextPageToken: "p3" }, p3: { items: [4] } };
       return yt.paginate(async (p) => pages[p.pageToken ?? ""], {}, { max: 3 })`,
    );
    expect(out).toEqual({ ok: true, result: [1, 2, 3], logs: [] });
  });

  it("stops paginating when YouTube repeats a token on an empty page", async () => {
    const out = await execute(
      bridge,
      `let calls = 0;
       const pages = { "": { items: [1, 2], nextPageToken: "p2" }, p2: { items: [3], nextPageToken: "end" }, end: { items: [], nextPageToken: "end" } };
       const items = await yt.paginate(async (p) => (calls++, pages[p.pageToken ?? ""]), {}, { max: 500 });
       return { items, calls }`,
    );
    expect(out).toEqual({ ok: true, result: { items: [1, 2, 3], calls: 3 }, logs: [] });
  });

  it("ships formatting utilities", async () => {
    const out = await execute(
      bridge,
      `return [formatDuration("PT1H2M3S"), formatDuration("PT0S"), formatDuration("P1DT1M"), isLikelyShort("PT59S"), isLikelyShort("PT3M1S"),
        toRows({ columnHeaders: [{ name: "day" }, { name: "views" }], rows: [["2026-01-01", 5]] })]`,
    );
    expect(out).toEqual({
      ok: true,
      result: ["1h 2m 3s", "0s", "24h 1m", true, false, [{ day: "2026-01-01", views: 5 }]],
      logs: [],
    });
  });
});
