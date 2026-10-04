import { describe, expect, it } from "vitest";
import { buildSpec, search } from "../src/host/search.js";

const spec = buildSpec();

describe("search", () => {
  it("runs the documented example against the YouTube spec", async () => {
    const out = await search(
      spec,
      `return Object.entries(spec.youtube.resources.videos.methods).map(([k, m]) => ({ k, params: Object.keys(m.parameters ?? {}) })).find((m) => m.k === "list")`,
    );
    expect(out).toMatchObject({ ok: true, result: { k: "list", params: expect.arrayContaining(["part", "id", "chart", "myRating"]) } });
  });

  it("exposes quota costs keyed by op id", async () => {
    const out = await search(spec, `return [spec.quotaCosts["youtube.search.list"], spec.quotaCosts["youtube.playlists.insert"]]`);
    expect(out).toEqual({ ok: true, result: [{ bucket: "search", cost: 1 }, { bucket: "units", cost: 50 }], logs: [] });
  });

  it("exposes analytics metrics and dimensions", async () => {
    const out = await search(spec, `return ["views", "audienceWatchRatio"].every((m) => m in spec.analyticsFields.metrics) && "creatorContentType" in spec.analyticsFields.dimensions`);
    expect(out).toEqual({ ok: true, result: true, logs: [] });
  });

  it("has no yt client and no network", async () => {
    const out = await search(spec, `return [typeof yt, await fetch("https://example.com").then(() => "reached", (e) => e.message.slice(0, 40))]`);
    expect(out).toEqual({ ok: true, result: ["undefined", "This worker is not permitted to access t"], logs: [] });
  });
});
