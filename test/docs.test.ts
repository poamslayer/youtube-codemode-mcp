import { describe, expect, it } from "vitest";
import { docs, loadGuides } from "../src/host/docs.js";

const guides = loadGuides();
const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;

describe("docs", () => {
  it("lists every topic in the index", () => {
    expect([...guides.keys()]).toEqual(["analytics", "auth", "comments", "discovery", "overview", "playlists", "publishing", "quota", "reporting", "transcripts"]);
    expect(docs(guides).text).toContain("- overview: the yt client, return shape, limits, and the confirm rule");
  });

  it("returns a guide by topic and rejects unknown topics with the index", () => {
    expect(docs(guides, "Quota ").text.startsWith("# quota:")).toBe(true);
    expect(docs(guides, "nope")).toMatchObject({ ok: false, text: expect.stringContaining("- analytics:") });
  });

  it("every js block in every guide parses as an execute() body", () => {
    const broken: string[] = [];
    for (const g of guides.values()) {
      for (const [, code] of g.body.matchAll(/```js(?: run)?\n([\s\S]*?)```/g)) {
        const body = /^\s*(status|snippet):/.test(code!) ? `({${code}})` : code!;
        try {
          new AsyncFunction("yt", body);
        } catch (e) {
          broken.push(`${g.topic}: ${(e as Error).message}\n${code!.slice(0, 80)}`);
        }
      }
    }
    expect(broken).toEqual([]);
  });
});
