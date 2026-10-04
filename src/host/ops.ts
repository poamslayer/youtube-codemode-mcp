import { readFileSync } from "node:fs";
import type { CallArgs, RunContext } from "./bridge.js";

export type ApiAlias = "youtube" | "analytics" | "reporting";

export type Bucket = "units" | "search" | "upload";

export type ParamSpec = {
  location: "query" | "path";
  required?: boolean;
  repeated?: boolean;
  type?: string;
  description?: string;
  enum?: string[];
};

export type RestMethod = {
  httpMethod: "GET" | "POST" | "PUT" | "DELETE";
  path: string;
  parameters?: Record<string, ParamSpec>;
  parameterOrder?: string[];
  supportsMediaUpload?: boolean;
  mediaUpload?: { protocols: { resumable?: { path: string } } };
};

export type Charge = { bucket: Bucket; cost: number } | null;

export type RestOp = { kind: "rest"; id: string; api: ApiAlias; baseUrl: string; method: RestMethod; charge: Charge };

export type HelperOp = { kind: "helper"; id: string; charge: Charge; handler: (args: CallArgs, run: RunContext) => Promise<unknown> };

export type Op = RestOp | HelperOp;

type DiscoveryResource = { methods?: Record<string, RestMethod>; resources?: Record<string, DiscoveryResource> };

type DiscoveryDoc = { rootUrl: string; servicePath: string; resources: Record<string, DiscoveryResource> };

const SPECS_DIR = new URL("../../specs/", import.meta.url);

export function loadSpec(alias: ApiAlias): DiscoveryDoc {
  return JSON.parse(readFileSync(new URL(`${alias}.json`, SPECS_DIR), "utf8"));
}

// Source: developers.google.com/youtube/v3/determine_quota_cost, updated 2026-09-15.
// captions.download is absent from that table; 200 is its long-standing documented cost.
const DATA_API_CHARGES: Record<string, Charge> = {
  "youtube.search.list": { bucket: "search", cost: 1 },
  "youtube.videos.insert": { bucket: "upload", cost: 1 },
  "youtube.captions.list": { bucket: "units", cost: 50 },
  "youtube.captions.insert": { bucket: "units", cost: 400 },
  "youtube.captions.update": { bucket: "units", cost: 450 },
  "youtube.captions.download": { bucket: "units", cost: 200 },
};

const READ_METHODS = new Set(["list", "get", "getRating", "batchGetStats", "stream"]);

function chargeFor(id: string, api: ApiAlias, methodName: string): Charge {
  if (api !== "youtube") return null;
  return DATA_API_CHARGES[id] ?? { bucket: "units", cost: READ_METHODS.has(methodName) ? 1 : 50 };
}

function walk(api: ApiAlias, baseUrl: string, resources: Record<string, DiscoveryResource>, prefix: string, out: Map<string, Op>) {
  for (const [name, resource] of Object.entries(resources)) {
    const path = `${prefix}.${name}`;
    for (const [methodName, method] of Object.entries(resource.methods ?? {})) {
      const id = `${path}.${methodName}`;
      out.set(id, { kind: "rest", id, api, baseUrl, method, charge: chargeFor(id, api, methodName) });
    }
    walk(api, baseUrl, resource.resources ?? {}, path, out);
  }
}

export function buildRegistry(helpers: HelperOp[]): Map<string, Op> {
  const ops = new Map<string, Op>();
  for (const api of ["youtube", "analytics", "reporting"] as const) {
    const doc = loadSpec(api);
    walk(api, doc.rootUrl + doc.servicePath, doc.resources, api, ops);
  }
  for (const h of helpers) ops.set(h.id, h);
  return ops;
}

function editDistance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0]!;
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cur = row[j]!;
      row[j] = Math.min(row[j]! + 1, row[j - 1]! + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = cur;
    }
  }
  return row[b.length]!;
}

export function closestOps(ops: Map<string, Op>, id: string, n = 5): string[] {
  return [...ops.keys()]
    .map((k) => ({ k, d: editDistance(id.toLowerCase(), k.toLowerCase()) }))
    .sort((x, y) => x.d - y.d)
    .slice(0, n)
    .map((x) => x.k);
}

type GateArgs = { params?: Record<string, unknown>; body?: unknown };

const isPublic = (body: unknown) => (body as { status?: { privacyStatus?: string } } | undefined)?.status?.privacyStatus === "public";

const GATES: Record<string, (a: GateArgs) => string | null> = {
  "youtube.videos.insert": () => "Uploads a video to the channel.",
  "youtube.videos.update": (a) => (isPublic(a.body) ? "Sets the video's privacy to public." : null),
  "youtube.playlists.insert": (a) => (isPublic(a.body) ? "Creates a public playlist." : null),
  "youtube.playlists.update": (a) => (isPublic(a.body) ? "Sets the playlist's privacy to public." : null),
  "youtube.commentThreads.insert": () => "Posts a public comment as the channel.",
  "youtube.comments.insert": () => "Posts a public reply as the channel.",
  "youtube.thumbnails.set": () => "Replaces the video's thumbnail.",
  "youtube.captions.insert": () => "Publishes a caption track on the video.",
  "youtube.captions.update": () => "Replaces a caption track on the video.",
  "youtube.liveBroadcasts.transition": () => "Changes a live broadcast's state, which can start or end a public stream.",
  "reporting.jobs.create": () => "Creates a Reporting API job that generates reports daily.",
  upload: () => "Uploads a local video file to the channel.",
  setThumbnail: () => "Replaces the video's thumbnail with a local image.",
};

export function gateEffect(id: string, args: GateArgs): string | null {
  if (id.endsWith(".delete")) return `Permanently deletes ${JSON.stringify(args.params ?? {})} via ${id}. This cannot be undone.`;
  return GATES[id]?.(args) ?? null;
}
