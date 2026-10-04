import { OpError, type CallArgs, type Dispatch, type RunContext } from "./bridge.js";
import type { Auth } from "./auth.js";
import { buildRequest, normalizeError, send } from "./google.js";
import { buildRegistry, closestOps, gateEffect, type Charge, type HelperOp, type Op, type RestOp } from "./ops.js";
import { pacificDate, type QuotaLedger } from "./quota.js";
import { suggest } from "./suggest.js";
import { fetchTranscript } from "./transcripts.js";
import { resolveThumbnail, resolveVideo, setThumbnail, uploadVideo } from "./upload.js";

const DEFAULT_RANGE_DAYS = 28;
const DEFAULT_DOWNLOAD_CHARS = 50_000;
const REPORTING_HOST = "youtubereporting.googleapis.com";

type AnalyticsResponse = { columnHeaders?: { name: string; columnType: string; dataType: string }[]; rows?: unknown[][] };

export type DispatchOptions = { uploadDir?: string };

export function analyticsDefaults(params: Record<string, unknown>, today: string): Record<string, unknown> {
  const end = (params.endDate as string | undefined) ?? today;
  const start = new Date(`${end}T00:00:00Z`);
  start.setUTCDate(start.getUTCDate() - DEFAULT_RANGE_DAYS);
  return { ids: "channel==MINE", startDate: start.toISOString().slice(0, 10), ...params, endDate: end };
}

export function toRows(res: AnalyticsResponse) {
  const columns = res.columnHeaders ?? [];
  return {
    columns,
    rows: (res.rows ?? []).map((row) => Object.fromEntries(columns.map((c, i) => [c.name, row[i]]))),
  };
}

// Host-side transfers can outlast the sandbox's wall clock, so the run's
// deadline is paused for their duration and resumed with the time it had left.
async function pausingDeadline<T>(run: RunContext, work: () => Promise<T>): Promise<T> {
  const remaining = run.deadlineAt - Date.now();
  run.deadlineAt = Infinity;
  try {
    return await work();
  } finally {
    run.deadlineAt = Date.now() + Math.max(remaining, 5_000);
  }
}

function dryRun(op: Op, args: CallArgs, effect: string) {
  const wouldCall =
    op.kind === "rest" ? { op: op.id, ...buildRequest(op, args.params, args.body) } : { op: op.id, params: args.params };
  return {
    dryRun: true,
    effect,
    wouldCall,
    cost: op.charge,
    toProceed: "Nothing was sent. Repeat the same call with { confirm: true } as the last argument once the user has approved this action.",
  };
}

export function createDispatch(auth: Auth, ledger: QuotaLedger, options: DispatchOptions = {}): Dispatch {
  function charge(c: Charge, id: string, run: RunContext) {
    if (!c) return;
    if (c.bucket === "units" && run.quotaBudget !== undefined && run.unitsSpent + c.cost > run.quotaBudget) {
      throw new OpError({
        status: 403,
        reason: "quotaBudgetExceeded",
        message: `${id} costs ${c.cost} units, which would take this run to ${run.unitsSpent + c.cost} of its ${run.quotaBudget}-unit quotaBudget. Nothing was sent.`,
        details: { spent: run.unitsSpent, budget: run.quotaBudget, cost: c.cost },
      });
    }
    ledger.charge(auth.projectId(), c.bucket, c.cost, id);
    if (c.bucket === "units") run.unitsSpent += c.cost;
  }

  async function callRest(op: RestOp, args: CallArgs, run: RunContext) {
    const req = buildRequest(op, args.params, args.body);
    const headers = await auth.headers(op.api === "youtube" && op.method.httpMethod === "GET");
    charge(op.charge, op.id, run);
    return send(req, headers);
  }

  const p = (args: CallArgs) => (args.params ?? {}) as Record<string, any>;

  const helpers: HelperOp[] = [
    { kind: "helper", id: "quota", charge: null, handler: async () => ledger.status(auth.projectId()) },
    { kind: "helper", id: "auth.status", charge: null, handler: () => auth.status() },
    { kind: "helper", id: "suggest", charge: null, handler: async (args) => suggest(String(p(args).query), p(args).lang) },
    { kind: "helper", id: "transcript", charge: null, handler: async (args) => fetchTranscript(String(p(args).videoId), p(args).lang) },
    {
      kind: "helper",
      id: "analytics.query",
      charge: null,
      handler: async (args, run) => {
        const params = analyticsDefaults(p(args), pacificDate());
        return toRows((await callRest(ops.get("analytics.reports.query") as RestOp, { params }, run)) as AnalyticsResponse);
      },
    },
    {
      kind: "helper",
      id: "reporting.download",
      charge: null,
      handler: async (args) => {
        const { downloadUrl, maxChars = DEFAULT_DOWNLOAD_CHARS } = p(args) as { downloadUrl?: string; maxChars?: number };
        const url = new URL(String(downloadUrl));
        if (url.protocol !== "https:" || url.hostname !== REPORTING_HOST) {
          throw new OpError({ status: 400, reason: "invalidParams", message: `downloadUrl must be an https://${REPORTING_HOST}/ URL from jobs.reports.list.` });
        }
        const res = await fetch(url, { headers: await auth.headers(false) });
        const csv = await res.text();
        if (!res.ok) throw new OpError(normalizeError(res.status, csv));
        return { csv: csv.slice(0, maxChars), totalChars: csv.length, truncated: csv.length > maxChars };
      },
    },
    {
      kind: "helper",
      id: "upload",
      charge: { bucket: "upload", cost: 1 },
      handler: async (args, run) => {
        const { filePath, metadata = {} } = p(args);
        const file = resolveVideo(filePath, options.uploadDir);
        const headers = await auth.headers(false);
        charge({ bucket: "upload", cost: 1 }, "upload", run);
        return pausingDeadline(run, () => uploadVideo(file, metadata, headers));
      },
    },
    {
      kind: "helper",
      id: "setThumbnail",
      charge: { bucket: "units", cost: 50 },
      handler: async (args, run) => {
        const { videoId, filePath } = p(args);
        const file = resolveThumbnail(filePath, options.uploadDir);
        const headers = await auth.headers(false);
        charge({ bucket: "units", cost: 50 }, "setThumbnail", run);
        return pausingDeadline(run, () => setThumbnail(String(videoId), file, headers));
      },
    },
  ];
  const ops = buildRegistry(helpers);

  return async (id, args, run) => {
    const op = ops.get(id);
    if (!op) {
      throw new OpError({
        status: 404,
        reason: "unknownMethod",
        message: `No method ${id}. Closest: ${closestOps(ops, id).join(", ")}. Use search() to browse the specs.`,
      });
    }
    const effect = gateEffect(id, args);
    if (effect && args.options?.confirm !== true) return dryRun(op, args, effect);
    return op.kind === "helper" ? op.handler(args, run) : callRest(op, args, run);
  };
}
