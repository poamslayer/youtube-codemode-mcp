import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
// Acceptance checks for a built server against the signed-in channel. Uses a little real quota.
// Usage: ACCEPT_VIDEO_ID=<one of your videos> node scripts/acceptance.mjs [path/to/bin]
const BIN = process.argv[2] ?? new URL("../dist/index.js", import.meta.url).pathname;
const VIDEO = process.env.ACCEPT_VIDEO_ID;
if (!VIDEO) throw new Error("Set ACCEPT_VIDEO_ID to a video on the signed-in channel.");
const connect = async () => { const c = new Client({ name: "accept", version: "0" }); await c.connect(new StdioClientTransport({ command: "node", args: [BIN] })); return c; };
const exec = async (c, code, extra = {}) => JSON.parse((await c.callTool({ name: "execute", arguments: { code, ...extra } })).content[0].text);
const check = (name, pass, detail) => console.log(`${pass ? "PASS" : "FAIL"} ${name}${detail ? "  " + JSON.stringify(detail).slice(0, 200) : ""}`);

let c = await connect();
const tools = (await c.listTools()).tools.map((t) => t.name).sort();
check("only 3 tools listed", JSON.stringify(tools) === '["docs","execute","search"]', tools);

const net = await exec(c, `try { await fetch("https://example.com"); return "reached" } catch (e) { return e.message.slice(0, 50) }`);
const env = await exec(c, `const fs = await import("node:fs"); let f; try { fs.readFileSync(${JSON.stringify(process.env.HOME + "/.youtube-mcp/token.json")}); f = "read" } catch (e) { f = e.code } return { env: process.env, file: f }`);
check("sandbox: no network", net.result.startsWith("This worker is not permitted"), net.result);
check("sandbox: no env, cannot read token file", JSON.stringify(env.result) === '{"env":{},"file":"ENOENT"}', env.result);

const shorts = await exec(c, `const { rows } = await yt.analytics.query({ metrics: "views", dimensions: "video", filters: "creatorContentType==shorts", sort: "-views", maxResults: 10 }); return { rows: rows.length }`);
check("top Shorts last 28 days runs", shorts.ok, shorts.result ?? shorts.error);
const ret = await exec(c, `const { rows } = await yt.analytics.query({ metrics: "audienceWatchRatio,relativeRetentionPerformance", dimensions: "elapsedVideoTimeRatio", filters: "video==${VIDEO}", sort: "elapsedVideoTimeRatio", startDate: "2025-01-01" }); return { points: rows.length, first: rows[0] }`);
check("retention curve (own video)", ret.ok && ret.result.points === 100, ret.result);
const list = await exec(c, (await c.callTool({ name: "docs", arguments: { topic: "overview" } })).content[0].text.match(/## Example: the channel's uploads with stats[\s\S]*?```js run\n([\s\S]*?)```/)[1] + "", { quotaBudget: 50 });
check("channel video list with stats", list.ok && list.result.length > 0, { videos: list.result?.length, first: list.result?.[0] });
const tx = await exec(c, `const t = await yt.transcript("jNQXAC9IVRw"); return { segments: t.segments.length, lang: t.language }`);
check("transcript of a public video", tx.ok && tx.result.segments > 0, tx.result ?? tx.error);

const q1 = await exec(c, `return (await yt.quota())`);
const s = await exec(c, `await yt.data.search.list({ part: "id", q: "test", maxResults: 1 }); return (await yt.quota())`);
check("search uses 1 search call, 0 units", s.result.search.used === q1.result.search.used + 1 && s.result.units.used === q1.result.units.used, { before: q1.result.search, after: s.result.search });

const del = await exec(c, `const r = await yt.data.videos.delete({ id: "${VIDEO}" }); return { r, units: (await yt.quota()).units.used }`);
const q2 = await exec(c, `return (await yt.quota()).units.used`);
check("delete without confirm is a dry run, no charge", del.result.r.dryRun === true && del.result.units === q2.result, del.result.r.effect);

const budget = await exec(c, `let n = 0; try { for (;;) { await yt.data.videos.list({ part: "id", id: "${VIDEO}" }); n++ } } catch (e) { return [n, e.reason] }`, { quotaBudget: 2 });
check("quotaBudget stops the run", JSON.stringify(budget.result) === '[2,"quotaBudgetExceeded"]', budget.result);

const usedBefore = (await exec(c, `return (await yt.quota()).units.used`)).result;
await c.close();
c = await connect();
const usedAfter = (await exec(c, `return (await yt.quota()).units.used`)).result;
check("quota persists across a server restart", usedBefore === usedAfter && usedAfter > 0, { usedBefore, usedAfter });
const docsIdx = (await c.callTool({ name: "docs", arguments: {} })).content[0].text;
const srch = JSON.parse((await c.callTool({ name: "search", arguments: { code: "return Object.keys(spec.youtube.resources.videos.methods)" } })).content[0].text);
check("docs index and search work", docsIdx.includes("- analytics:") && srch.result.includes("list"), srch.result);
await c.close();
