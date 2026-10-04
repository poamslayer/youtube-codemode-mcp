import { writeFileSync } from "node:fs";

const APIS = { youtube: "youtube/v3", analytics: "youtubeAnalytics/v2", reporting: "youtubereporting/v1" };

for (const [alias, path] of Object.entries(APIS)) {
  const res = await fetch(`https://www.googleapis.com/discovery/v1/apis/${path}/rest`);
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
  const doc = await res.json();
  delete doc.icons;
  delete doc.etag;
  writeFileSync(new URL(`../specs/${alias}.json`, import.meta.url), JSON.stringify(doc, null, 1) + "\n");
  console.log(`specs/${alias}.json ${doc.revision}`);
}
