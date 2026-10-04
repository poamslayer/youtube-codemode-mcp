import { writeFileSync } from "node:fs";

const decode = (s) =>
  s.replace(/<[^>]+>/g, " ").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();

async function parse(page) {
  const html = await (await fetch(`https://developers.google.com/youtube/analytics/${page}?hl=en`, { headers: { "accept-language": "en-US" } })).text();
  const out = {};
  for (const m of html.matchAll(/<dt[^>]*>([\s\S]*?)<\/dt>\s*<dd[^>]*>([\s\S]*?)<\/dd>/g)) {
    const name = /itemprop="property">([^<]+)</.exec(m[1])?.[1]?.trim();
    if (!name || out[name]) continue;
    const description = decode(m[2]);
    out[name] = { core: /core (metric|dimension)/.test(m[1]), description: description.length > 6000 ? `${description.slice(0, 6000)}...` : description };
  }
  return out;
}

const fields = {
  source: "https://developers.google.com/youtube/analytics/metrics and /dimensions",
  fetched: new Date().toISOString().slice(0, 10),
  metrics: await parse("metrics"),
  dimensions: await parse("dimensions"),
};
writeFileSync(new URL("../specs/analytics-fields.json", import.meta.url), JSON.stringify(fields, null, 1) + "\n");
console.log(`metrics ${Object.keys(fields.metrics).length}, dimensions ${Object.keys(fields.dimensions).length}`);
