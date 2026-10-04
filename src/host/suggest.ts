import { OpError } from "./bridge.js";

const SUGGEST_URL = "https://suggestqueries-clients6.youtube.com/complete/search";

// The endpoint answers with JSONP: window.google.ac.h(["query", [["suggestion", 0, [...]], ...], {...}])
export function parseSuggestions(body: string): string[] {
  const data = JSON.parse(body.slice(body.indexOf("(") + 1, body.lastIndexOf(")"))) as [string, [string, ...unknown[]][]];
  return data[1].map((item) => item[0]);
}

export async function suggest(query: string, lang = "en") {
  const url = `${SUGGEST_URL}?client=youtube&ds=yt&q=${encodeURIComponent(query)}&hl=${encodeURIComponent(lang)}`;
  const res = await fetch(url, { headers: { "user-agent": "Mozilla/5.0" } });
  if (!res.ok) throw new OpError({ status: res.status, reason: "suggestFailed", message: `Suggestion endpoint returned HTTP ${res.status}.` });
  return { query, suggestions: parseSuggestions(await res.text()) };
}
