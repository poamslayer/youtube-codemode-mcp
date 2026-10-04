import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { OpError } from "./bridge.js";
import type { Bucket } from "./ops.js";

export type Limits = Record<Bucket, number>;

export const DEFAULT_LIMITS: Limits = { units: 10_000, search: 100, upload: 100 };

type Day = { date: string; used: Record<Bucket, number> };

type LedgerFile = Record<string, Day>;

export function pacificDate(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles" }).format(now);
}

const EMPTY = (): Record<Bucket, number> => ({ units: 0, search: 0, upload: 0 });

export type QuotaLedger = ReturnType<typeof createLedger>;

// The file is re-read on every charge so two server processes (say Claude
// Desktop and Claude Code) sharing one Google project see each other's usage.
export function createLedger(path: string, limits: Limits = DEFAULT_LIMITS, now = () => new Date()) {
  function read(): LedgerFile {
    try {
      return JSON.parse(readFileSync(path, "utf8")) as LedgerFile;
    } catch {
      return {};
    }
  }

  function today(file: LedgerFile, project: string): Day {
    const date = pacificDate(now());
    const day = file[project];
    return day?.date === date ? { date, used: { ...EMPTY(), ...day.used } } : { date, used: EMPTY() };
  }

  return {
    charge(project: string, bucket: Bucket, cost: number, op: string) {
      const file = read();
      const day = today(file, project);
      if (day.used[bucket] + cost > limits[bucket]) {
        throw new OpError({
          status: 403,
          reason: "quotaExceeded",
          message: `${op} needs ${cost} ${bucket} quota but ${day.used[bucket]}/${limits[bucket]} is used today. Resets at midnight Pacific.`,
          details: { bucket, used: day.used[bucket], limit: limits[bucket], cost },
        });
      }
      day.used[bucket] += cost;
      file[project] = day;
      mkdirSync(dirname(path), { recursive: true });
      const tmp = `${path}.${process.pid}.tmp`;
      writeFileSync(tmp, JSON.stringify(file, null, 2));
      renameSync(tmp, path);
    },

    status(project: string) {
      const day = today(read(), project);
      const buckets = Object.fromEntries(
        (Object.keys(limits) as Bucket[]).map((b) => [b, { used: day.used[b], remaining: limits[b] - day.used[b], limit: limits[b] }]),
      );
      return { date: day.date, resetsAt: "midnight America/Los_Angeles", ...buckets };
    },
  };
}
