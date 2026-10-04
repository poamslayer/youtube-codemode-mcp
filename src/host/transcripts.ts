import { OpError } from "./bridge.js";

// Same unofficial path as the Python youtube-transcript-api 1.2.x: read the
// InnerTube key from the watch page, ask the player endpoint as the ANDROID
// client for caption tracks, then fetch timedtext XML. Expect this to break
// when YouTube changes its internals; the fixtures in test/fixtures pin the
// shapes it currently relies on.
const WATCH_URL = "https://www.youtube.com/watch?v=";
const PLAYER_URL = "https://www.youtube.com/youtubei/v1/player?key=";
const CLIENT = { clientName: "ANDROID", clientVersion: "20.10.38" };
const HEADERS = {
  "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36",
  "accept-language": "en-US",
};

export type CaptionTrack = { baseUrl: string; languageCode: string; kind?: string; isTranslatable?: boolean; name?: { runs?: { text: string }[]; simpleText?: string } };

type PlayerResponse = {
  playabilityStatus?: { status?: string; reason?: string };
  captions?: { playerCaptionsTracklistRenderer?: { captionTracks?: CaptionTrack[] } };
};

export type Segment = { text: string; start: number; duration: number };

function fail(reason: string, message: string, status = 404): never {
  throw new OpError({ status, reason, message });
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") return String.fromCodePoint(e[1]?.toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

// Timedtext text is escaped twice (an apostrophe arrives as &amp;#39;), so
// decode once for XML and once more for the HTML inside it.
export function parseTimedText(xml: string): Segment[] {
  const segments: Segment[] = [];
  for (const m of xml.matchAll(/<text\b([^>]*)>([\s\S]*?)<\/text>/g)) {
    const attrs = m[1]!;
    const text = decodeEntities(decodeEntities(m[2]!)).replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();
    if (!text) continue;
    segments.push({
      text,
      start: Number(/\bstart="([\d.]+)"/.exec(attrs)?.[1] ?? 0),
      duration: Number(/\bdur="([\d.]+)"/.exec(attrs)?.[1] ?? 0),
    });
  }
  return segments;
}

// Machine translation (&tlang=) answers 429 to unsigned requests as of
// 2026-10, so a missing language falls back to the best available track.
export function pickTrack(tracks: CaptionTrack[], lang: string): { track: CaptionTrack; exact: boolean } {
  const matches = (t: CaptionTrack) => t.languageCode === lang || t.languageCode.split("-")[0] === lang;
  const manual = tracks.filter((t) => t.kind !== "asr");
  const track = manual.find(matches) ?? tracks.find(matches);
  return track ? { track, exact: true } : { track: manual[0] ?? tracks[0]!, exact: false };
}

function assertPlayable(status: PlayerResponse["playabilityStatus"], videoId: string) {
  if (!status?.status || status.status === "OK") return;
  const reason = status.reason ?? status.status;
  if (/bot|sign in to confirm/i.test(reason)) fail("requestBlocked", `YouTube blocked the transcript request for ${videoId} as automated traffic.`, 429);
  if (/age/i.test(reason)) fail("ageRestricted", `${videoId} is age-restricted; transcripts need a signed-in session.`, 403);
  fail("videoUnavailable", `${videoId} is not playable: ${reason}`);
}

async function get(url: string, init?: RequestInit): Promise<Response> {
  const res = await fetch(url, { ...init, headers: { ...HEADERS, ...init?.headers } });
  if (res.status === 429) fail("requestBlocked", "YouTube rate-limited transcript requests from this IP. Wait and retry.", 429);
  if (!res.ok) fail("transcriptFetchFailed", `${url.split("?")[0]} returned HTTP ${res.status}.`, res.status);
  return res;
}

export async function fetchTranscript(videoId: string, lang = "en") {
  if (!/^[\w-]{11}$/.test(videoId)) fail("invalidParams", `"${videoId}" is not an 11-character video id.`, 400);
  const html = await (await get(WATCH_URL + videoId)).text();
  const key = /"INNERTUBE_API_KEY":\s*"([\w-]+)"/.exec(html)?.[1];
  if (!key) fail("transcriptFetchFailed", "Could not find the InnerTube key on the watch page. YouTube may have changed its page.", 502);

  const player = (await (
    await get(PLAYER_URL + key, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ context: { client: CLIENT }, videoId }) })
  ).json()) as PlayerResponse;
  assertPlayable(player.playabilityStatus, videoId);
  const tracks = player.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? [];
  if (!tracks.length) fail("transcriptsDisabled", `${videoId} has no caption tracks.`);

  const { track, exact } = pickTrack(tracks, lang);
  if (track.baseUrl.includes("&exp=xpe")) fail("poTokenRequired", `YouTube requires a proof-of-origin token for ${videoId}'s captions.`, 403);
  const segments = parseTimedText(await (await get(track.baseUrl.replace("&fmt=srv3", ""))).text());

  return {
    videoId,
    language: track.languageCode,
    ...(exact ? {} : { note: `No ${lang} track; returned ${track.languageCode}. Translate the text yourself if needed.` }),
    isGenerated: track.kind === "asr",
    source: "innertube",
    fullText: segments.map((s) => s.text).join(" "),
    segments,
    available: tracks.map((t) => ({ languageCode: t.languageCode, isGenerated: t.kind === "asr" })),
  };
}
