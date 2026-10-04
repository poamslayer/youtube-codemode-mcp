import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createLedger, pacificDate } from "../src/host/quota.js";

const ledgerPath = () => join(mkdtempSync(join(tmpdir(), "quota-")), "quota.json");
const at = (iso: string) => () => new Date(iso);

describe("quota ledger", () => {
  it("persists usage across ledger instances, like a server restart", () => {
    const path = ledgerPath();
    createLedger(path).charge("p", "units", 50, "youtube.videos.update");
    createLedger(path).charge("p", "units", 1, "youtube.videos.list");
    expect(createLedger(path).status("p")).toMatchObject({ units: { used: 51, remaining: 9949, limit: 10000 } });
  });

  it("blocks a charge that would cross the limit, with a catchable reason", () => {
    const ledger = createLedger(ledgerPath(), { units: 100, search: 100, upload: 100 });
    ledger.charge("p", "units", 60, "a");
    expect(() => ledger.charge("p", "units", 50, "youtube.videos.update")).toThrow(
      "youtube.videos.update needs 50 units quota but 60/100 is used today. Resets at midnight Pacific.",
    );
    ledger.charge("p", "units", 40, "b");
    expect(ledger.status("p")).toMatchObject({ units: { used: 100, remaining: 0 } });
  });

  it("keeps search and upload in their own buckets", () => {
    const ledger = createLedger(ledgerPath(), { units: 10, search: 2, upload: 1 });
    ledger.charge("p", "search", 1, "youtube.search.list");
    ledger.charge("p", "search", 1, "youtube.search.list");
    expect(() => ledger.charge("p", "search", 1, "youtube.search.list")).toThrow(/2\/2/);
    expect(ledger.status("p")).toMatchObject({ units: { used: 0 }, search: { used: 2 }, upload: { used: 0 } });
  });

  it("tracks projects separately", () => {
    const ledger = createLedger(ledgerPath());
    ledger.charge("a", "units", 5, "x");
    expect(ledger.status("b")).toMatchObject({ units: { used: 0 } });
  });

  it("resets at midnight Pacific, not midnight UTC", () => {
    const path = ledgerPath();
    createLedger(path, undefined, at("2026-10-04T06:00:00Z")).charge("p", "units", 7, "x");
    expect(createLedger(path, undefined, at("2026-10-04T06:59:00Z")).status("p")).toMatchObject({ date: "2026-10-03", units: { used: 7 } });
    expect(createLedger(path, undefined, at("2026-10-04T07:00:00Z")).status("p")).toMatchObject({ date: "2026-10-04", units: { used: 0 } });
  });

  it("formats Pacific dates", () => {
    expect(pacificDate(new Date("2026-01-01T07:59:00Z"))).toBe("2025-12-31");
  });
});
