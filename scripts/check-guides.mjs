import { readdirSync, readFileSync } from "node:fs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

// Runs every ```js run block in guides/ through the built server against the
// signed-in channel. Placeholders are replaced from the environment.
const placeholders = {
  VIDEO_ID: process.env.GUIDE_VIDEO_ID ?? "dQw4w9WgXcQ",
  PLAYLIST_ID: process.env.GUIDE_PLAYLIST_ID ?? "PLFgquLnL59alCl_2TQvOiD5Vgm1hCaGSI",
};

const dir = new URL("../guides/", import.meta.url);
const blocks = readdirSync(dir)
  .filter((f) => f.endsWith(".md"))
  .sort()
  .flatMap((f) =>
    [...readFileSync(new URL(f, dir), "utf8").matchAll(/```js run\n([\s\S]*?)```/g)].map((m, i) => ({
      name: `${f}#${i + 1}`,
      code: m[1].replace(/\b(VIDEO_ID|PLAYLIST_ID)\b/g, (k) => placeholders[k]),
    })),
  );

const client = new Client({ name: "check-guides", version: "0" });
await client.connect(new StdioClientTransport({ command: "node", args: [new URL("../dist/index.js", import.meta.url).pathname] }));

let failed = 0;
for (const b of blocks) {
  const res = await client.callTool({ name: "execute", arguments: { code: b.code } });
  const out = JSON.parse(res.content[0].text);
  if (!out.ok) failed++;
  const preview = JSON.stringify(out.ok ? out.result : out.error);
  console.log(`${out.ok ? "PASS" : "FAIL"} ${b.name} ${preview.length > 160 ? preview.slice(0, 160) + "..." : preview}`);
}
await client.close();
console.log(`${blocks.length - failed}/${blocks.length} guide blocks ran`);
process.exit(failed ? 1 : 0);
