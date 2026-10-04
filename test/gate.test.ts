import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execute } from "../src/host/execute.js";
import { startTestHost } from "./host.js";

const root = mkdtempSync(join(tmpdir(), "uploads-"));
const allowed = join(root, "allowed");
mkdirSync(allowed);
const video = join(allowed, "clip.mp4");
writeFileSync(video, Buffer.alloc(4096, 1));
const thumb = join(allowed, "thumb.png");
writeFileSync(thumb, Buffer.alloc(100, 2));
const outside = join(root, "secret.mp4");
writeFileSync(outside, "x");
symlinkSync(outside, join(allowed, "sneaky.mp4"));

const SESSION = "https://www.googleapis.com/upload/youtube/v3/videos?upload_id=abc";
let host: Awaited<ReturnType<typeof startTestHost>>;

beforeAll(async () => {
  host = await startTestHost(
    async ({ method, url }) => {
      if (url.includes("uploadType=resumable")) return new Response(null, { status: 200, headers: { location: SESSION } });
      if (url === SESSION) {
        await new Promise((r) => setTimeout(r, 1500));
        return Response.json({ id: "newVideo", status: { uploadStatus: "uploaded" } });
      }
      if (url.includes("thumbnails/set")) return Response.json({ items: [{ default: { url: "t" } }] });
      return method === "DELETE" ? new Response(null, { status: 204 }) : Response.json({ id: "v1" });
    },
    { uploadDir: allowed },
  );
});
afterAll(() => host.close());

const run = (code: string, timeoutMs = 10_000) => execute(host.bridge, code, { timeoutMs, maxCalls: 50 });

describe("confirm gate", () => {
  it("returns a dry run for a delete and sends nothing", async () => {
    const before = host.requests.length;
    const out = await run(`return yt.data.videos.delete({ id: "abc" })`);
    expect(out).toMatchObject({
      ok: true,
      result: {
        dryRun: true,
        effect: expect.stringContaining("Permanently deletes"),
        wouldCall: { op: "youtube.videos.delete", method: "DELETE", url: "https://youtube.googleapis.com/youtube/v3/videos?id=abc" },
        cost: { bucket: "units", cost: 50 },
      },
    });
    expect(host.requests.length).toBe(before);
  });

  it("sends the delete once confirmed", async () => {
    const out = await run(`return yt.data.videos.delete({ id: "abc" }, undefined, { confirm: true })`);
    expect(out).toEqual({ ok: true, result: null, logs: [] });
    expect(host.requests.at(-1)).toMatchObject({ method: "DELETE", url: "https://youtube.googleapis.com/youtube/v3/videos?id=abc" });
  });

  it("gates a privacy change to public but not a private edit", async () => {
    const before = host.requests.length;
    const pub = await run(`return yt.data.videos.update({ part: "status" }, { id: "v1", status: { privacyStatus: "public" } })`);
    expect(pub).toMatchObject({ ok: true, result: { dryRun: true, effect: "Sets the video's privacy to public." } });
    expect(host.requests.length).toBe(before);
    const priv = await run(`return yt.data.videos.update({ part: "status" }, { id: "v1", status: { privacyStatus: "private" } })`);
    expect(priv).toEqual({ ok: true, result: { id: "v1" }, logs: [] });
  });

  it("gates posting a comment", async () => {
    const out = await run(`return yt.data.commentThreads.insert({ part: "snippet" }, { snippet: {} })`);
    expect(out).toMatchObject({ ok: true, result: { dryRun: true } });
  });

  it("does not gate reads", async () => {
    expect(await run(`return yt.data.videos.list({ part: "id", id: "v1" })`)).toEqual({ ok: true, result: { id: "v1" }, logs: [] });
  });
});

describe("upload", () => {
  it("dry-runs without confirm", async () => {
    const out = await run(`return yt.upload(${JSON.stringify(video)}, { snippet: { title: "t" } })`);
    expect(out).toMatchObject({ ok: true, result: { dryRun: true, cost: { bucket: "upload", cost: 1 } } });
  });

  it("uploads resumably and outlives the run deadline while the transfer runs", async () => {
    const out = await run(
      `const v = await yt.upload(${JSON.stringify(video)}, { snippet: { title: "t" }, status: { privacyStatus: "private" } }, { confirm: true });
       return [v.id, (await yt.quota()).upload.used]`,
      1000,
    );
    expect(out).toEqual({ ok: true, result: ["newVideo", 1], logs: [] });
    const [start, put] = host.requests.slice(-2);
    expect(start).toMatchObject({
      method: "POST",
      url: "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet%2Cstatus",
      auth: "Bearer tok",
      body: { snippet: { title: "t" }, status: { privacyStatus: "private" } },
    });
    expect(put).toMatchObject({ method: "PUT", url: SESSION, bodyBytes: 4096 });
  });

  it("rejects relative, missing, and out-of-dir paths, including symlinks", async () => {
    const reason = async (p: string) => {
      const out = await run(`try { await yt.upload(${JSON.stringify(p)}, {}, { confirm: true }) } catch (e) { return e.reason + ": " + e.message }`);
      return out.ok ? out.result : out;
    };
    expect(await reason("clip.mp4")).toMatch(/^invalidFile: filePath must be an absolute path/);
    expect(await reason(join(allowed, "nope.mp4"))).toMatch(/^invalidFile: .* does not exist/);
    expect(await reason(outside)).toMatch(/^invalidFile: .* is outside YOUTUBE_MCP_UPLOAD_DIR/);
    expect(await reason(join(allowed, "sneaky.mp4"))).toMatch(/^invalidFile: .* is outside YOUTUBE_MCP_UPLOAD_DIR/);
    expect(await reason(thumb)).toMatch(/^invalidFile: .* unsupported extension/);
  });

  it("sets a thumbnail from a local image once confirmed", async () => {
    const out = await run(`return yt.setThumbnail("v1", ${JSON.stringify(thumb)}, { confirm: true })`);
    expect(out).toMatchObject({ ok: true, result: { items: [{ default: { url: "t" } }] } });
    expect(host.requests.at(-1)).toMatchObject({ method: "POST", url: "https://www.googleapis.com/upload/youtube/v3/thumbnails/set?uploadType=media&videoId=v1", bodyBytes: 100 });
  });
});
