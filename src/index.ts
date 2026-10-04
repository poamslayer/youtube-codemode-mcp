#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { join } from "node:path";
import { createAuth, configFromEnv } from "./host/auth.js";
import { startBridge } from "./host/bridge.js";
import { createDispatch } from "./host/dispatch.js";
import { docs, loadGuides } from "./host/docs.js";
import { DEFAULT_LIMITS, execute } from "./host/execute.js";
import { createLedger } from "./host/quota.js";
import { buildSpec, search } from "./host/search.js";

function text(value: unknown, isError = false) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }], isError };
}

const authConfig = configFromEnv();
const auth = createAuth(authConfig);
const ledger = createLedger(join(authConfig.configDir, "quota.json"));
const bridge = await startBridge(createDispatch(auth, ledger, { uploadDir: process.env.YOUTUBE_MCP_UPLOAD_DIR || undefined }));
const spec = buildSpec();
const guides = loadGuides();
const server = new McpServer({ name: "youtube-codemode-mcp", version: "1.0.0" });

server.registerTool(
  "docs",
  {
    description: `Guides for the yt client used by execute(): the API surface, quota rules, analytics recipes, publishing gotchas, and error reasons. Read docs("overview") before the first execute() call. Topics: ${[...guides.keys()].join(", ")}.`,
    inputSchema: { topic: z.string().optional().describe("Omit for the topic index.") },
  },
  async ({ topic }) => {
    const out = docs(guides, topic);
    return { content: [{ type: "text" as const, text: out.text }], isError: !out.ok };
  },
);

server.registerTool(
  "search",
  {
    description: `Explore the YouTube API specs by running a JavaScript async function body. No network, no auth, no quota.

A global \`spec\` holds:
- spec.youtube: Data API v3 Discovery doc. Methods live at spec.youtube.resources.<resource>.methods.<method>, with httpMethod, parameters (description, required, repeated, enum), and request/response $ref schemas in spec.youtube.schemas.
- spec.analytics: YouTube Analytics v2 Discovery doc (reports.query, groups, groupItems).
- spec.analyticsFields: { metrics, dimensions } with descriptions, since the Analytics Discovery doc does not list them.
- spec.reporting: YouTube Reporting v1 Discovery doc.
- spec.quotaCosts: { "youtube.videos.list": { bucket, cost }, ... }.

Return only what you need. Examples:
  return Object.entries(spec.youtube.resources.videos.methods).map(([k, m]) => ({ k, params: Object.keys(m.parameters ?? {}) }))
  return spec.youtube.schemas.VideoSnippet.properties
  return Object.keys(spec.analyticsFields.metrics).filter((m) => /revenue/i.test(m))

Method ids found here map 1:1 to execute(): spec.youtube.resources.videos.methods.list is yt.data.videos.list(params).`,
    inputSchema: { code: z.string().describe("Async function body. Use return.") },
  },
  async ({ code }) => {
    const out = await search(spec, code);
    return text(out, !out.ok);
  },
);

server.registerTool(
  "execute",
  {
    description: `Run a JavaScript async function body against the user's YouTube channel. Call docs() first for recipes, quota rules, and gotchas. Use search() to look up method parameters.

The \`yt\` client:
  yt.data.<resource>.<method>(params, body?, { confirm? })   YouTube Data API v3, e.g. yt.data.videos.list({ part: "snippet,statistics", id: ["a", "b"] })
  yt.analytics.query(params)                                 YouTube Analytics v2 reports.query; ids defaults to channel==MINE, dates to the last 28 days; returns { columns, rows: object[] }
  yt.reporting.<resource>.<method>(params, body?)            YouTube Reporting v1
  yt.reporting.download(downloadUrl, { maxChars? })          CSV text of a report, default cap 50,000 chars
  yt.paginate(fn, params, { max })                           follows nextPageToken, returns items
  yt.transcript(videoId, { lang? })                          captions of any public video, no quota: { language, isGenerated, fullText, segments, available }
  yt.suggest(query, { lang? })                               YouTube search autocomplete, no quota
  yt.upload(absPath, { snippet, status }, { confirm })       resumable upload from local disk
  yt.setThumbnail(videoId, absPath, { confirm })             JPEG or PNG, 2 MB max
  yt.quota()  yt.auth.status()

Confirm gate: deletes, uploads, comments, thumbnails, captions, reporting jobs, live transitions, and anything that sets privacyStatus to public return a dry run ({ dryRun, effect, wouldCall, cost }) and send nothing unless the call passes { confirm: true } as its last argument. Show the user the dry run and get approval before confirming.
Helpers in scope: formatDuration(iso), durationSeconds(iso), isLikelyShort(iso), toRows(analyticsResponse).

Chain many calls in one program and return a compact, aggregated result. Errors thrown by yt carry status, reason (e.g. quotaExceeded, authRequired, invalidParams), and message, and can be caught. The sandbox has no network, env, or filesystem; credentials stay on the host. Limits: 60s wall clock, 500 yt calls, 100 KB of returned JSON.`,
    inputSchema: {
      code: z.string().describe("Async function body. Use return."),
      quotaBudget: z.number().int().positive().optional().describe("Max Data API units this run may spend. Calls past it throw quotaBudgetExceeded and send nothing."),
    },
  },
  async ({ code, quotaBudget }) => {
    const out = await execute(bridge, code, { ...DEFAULT_LIMITS, quotaBudget });
    return text(out, !out.ok);
  },
);

await server.connect(new StdioServerTransport());

// The bridge's HTTP listener keeps the event loop alive, so exit when the client closes stdin.
process.stdin.once("end", async () => {
  await bridge.close();
  process.exit(0);
});
