import { describe, expect, it } from "vitest";
import { buildRequest, normalizeError } from "../src/host/google.js";
import { buildRegistry, closestOps, type RestOp } from "../src/host/ops.js";

const ops = buildRegistry([]);
const rest = (id: string) => ops.get(id) as RestOp;

describe("buildRequest", () => {
  it("builds a Data API list call with a repeated id array", () => {
    expect(buildRequest(rest("youtube.videos.list"), { part: "snippet,statistics", id: ["a", "b"] })).toEqual({
      method: "GET",
      url: "https://youtube.googleapis.com/youtube/v3/videos?part=snippet%2Cstatistics&id=a&id=b",
    });
  });

  it("joins arrays for non-repeated params", () => {
    const params = { ids: "channel==MINE", startDate: "2026-09-01", endDate: "2026-09-28", metrics: ["views", "likes"] };
    expect(buildRequest(rest("analytics.reports.query"), params).url).toBe(
      "https://youtubeanalytics.googleapis.com/v2/reports?ids=channel%3D%3DMINE&startDate=2026-09-01&endDate=2026-09-28&metrics=views%2Clikes",
    );
  });

  it("fills path params and sends a JSON body", () => {
    expect(buildRequest(rest("reporting.jobs.reports.get"), { jobId: "j 1", reportId: "r2" }).url).toBe(
      "https://youtubereporting.googleapis.com/v1/jobs/j%201/reports/r2",
    );
    expect(buildRequest(rest("youtube.videos.update"), { part: "snippet" }, { id: "v", snippet: { title: "t" } })).toEqual({
      method: "PUT",
      url: "https://youtube.googleapis.com/youtube/v3/videos?part=snippet",
      body: '{"id":"v","snippet":{"title":"t"}}',
    });
  });

  it("keeps slashes in reserved path params", () => {
    expect(buildRequest(rest("reporting.media.download"), { resourceName: "a/b c" }).url).toBe(
      "https://youtubereporting.googleapis.com/v1/media/a/b%20c",
    );
  });

  it("rejects unknown params and lists the valid ones", () => {
    expect(() => buildRequest(rest("youtube.search.list"), { part: "snippet", query: "x" })).toThrow(/has no parameter query\. Valid: .*\bq\b/);
  });

  it("rejects missing required params", () => {
    expect(() => buildRequest(rest("youtube.videos.list"), {})).toThrow("youtube.videos.list requires part.");
  });
});

describe("registry", () => {
  it("prices Data API methods from the 2026-09 quota table", () => {
    const charge = (id: string) => ops.get(id)!.charge;
    expect(charge("youtube.videos.list")).toEqual({ bucket: "units", cost: 1 });
    expect(charge("youtube.videos.update")).toEqual({ bucket: "units", cost: 50 });
    expect(charge("youtube.search.list")).toEqual({ bucket: "search", cost: 1 });
    expect(charge("youtube.videos.insert")).toEqual({ bucket: "upload", cost: 1 });
    expect(charge("youtube.captions.list")).toEqual({ bucket: "units", cost: 50 });
    expect(charge("analytics.reports.query")).toBe(null);
  });

  it("suggests close method names", () => {
    expect(closestOps(ops, "youtube.video.list", 2)).toEqual(["youtube.videos.list", "youtube.videos.rate"]);
  });
});

describe("normalizeError", () => {
  it("pulls reason and message from a Google error body", () => {
    const body = JSON.stringify({ error: { code: 403, message: "Quota exceeded.", errors: [{ reason: "quotaExceeded" }] } });
    expect(normalizeError(403, body)).toEqual({ status: 403, reason: "quotaExceeded", message: "Quota exceeded." });
  });

  it("falls back for non-JSON bodies", () => {
    expect(normalizeError(502, "Bad Gateway")).toEqual({ status: 502, reason: "http502", message: "Bad Gateway" });
  });
});
