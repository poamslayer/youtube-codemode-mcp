import { describe, expect, it } from "vitest";
import { analyticsDefaults, toRows } from "../src/host/dispatch.js";

describe("analyticsDefaults", () => {
  it("fills channel==MINE and the last 28 days ending today", () => {
    expect(analyticsDefaults({ metrics: "views" }, "2026-10-03")).toEqual({
      ids: "channel==MINE",
      startDate: "2026-09-05",
      endDate: "2026-10-03",
      metrics: "views",
    });
  });

  it("anchors the default start to an explicit endDate and keeps explicit values", () => {
    expect(analyticsDefaults({ metrics: "views", endDate: "2026-03-01" }, "2026-10-03")).toMatchObject({ startDate: "2026-02-01", endDate: "2026-03-01" });
    expect(analyticsDefaults({ metrics: "views", ids: "channel==UC1", startDate: "2026-01-01" }, "2026-10-03")).toMatchObject({
      ids: "channel==UC1",
      startDate: "2026-01-01",
    });
  });
});

describe("toRows", () => {
  it("zips column headers onto each row", () => {
    const res = {
      columnHeaders: [
        { name: "video", columnType: "DIMENSION", dataType: "STRING" },
        { name: "views", columnType: "METRIC", dataType: "INTEGER" },
      ],
      rows: [["a", 10], ["b", 4]],
    };
    expect(toRows(res)).toEqual({ columns: res.columnHeaders, rows: [{ video: "a", views: 10 }, { video: "b", views: 4 }] });
  });

  it("returns no rows when the API omits them", () => {
    expect(toRows({ columnHeaders: [] })).toEqual({ columns: [], rows: [] });
  });
});
