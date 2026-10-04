import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseTimedText, pickTrack, type CaptionTrack } from "../src/host/transcripts.js";
import { parseSuggestions } from "../src/host/suggest.js";

const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");
const tracks: CaptionTrack[] = JSON.parse(fixture("player-dQw4w9WgXcQ.json")).captions.playerCaptionsTracklistRenderer.captionTracks;

describe("parseTimedText", () => {
  it("parses recorded timedtext XML and undoes the double escaping", () => {
    const segments = parseTimedText(fixture("timedtext-dQw4w9WgXcQ-en.xml"));
    expect(segments.slice(0, 3)).toEqual([
      { text: "[♪♪♪]", start: 1.36, duration: 1.68 },
      { text: "♪ We're no strangers to love ♪", start: 18.64, duration: 3.24 },
      { text: "♪ You know the rules and so do I ♪", start: 22.64, duration: 4.32 },
    ]);
    expect(segments.every((s) => !/&[#a-z0-9]+;/i.test(s.text))).toBe(true);
  });

  it("strips formatting tags and skips empty cues", () => {
    expect(parseTimedText('<transcript><text start="0" dur="1">&lt;i&gt;hi&lt;/i&gt; &amp;amp; bye</text><text start="2"></text></transcript>')).toEqual([
      { text: "hi & bye", start: 0, duration: 1 },
    ]);
  });
});

describe("pickTrack", () => {
  it("prefers the manual track over auto-generated for the same language", () => {
    expect(pickTrack(tracks, "en").track).toMatchObject({ languageCode: "en" });
    expect(pickTrack(tracks, "en").track.kind).toBeUndefined();
  });

  it("matches a base language to a regional track", () => {
    expect(pickTrack(tracks, "de")).toMatchObject({ track: { languageCode: "de-DE" }, exact: true });
  });

  it("falls back to the first manual track when the language is missing", () => {
    expect(pickTrack(tracks, "fr")).toMatchObject({ track: { languageCode: "en" }, exact: false });
  });

  it("falls back to an auto-generated track when there is no manual one", () => {
    expect(pickTrack([{ baseUrl: "u", languageCode: "ko", kind: "asr" }], "fr")).toEqual({ track: { baseUrl: "u", languageCode: "ko", kind: "asr" }, exact: false });
  });
});

describe("parseSuggestions", () => {
  it("unwraps the JSONP autocomplete response", () => {
    const body = 'window.google.ac.h(["how to bake",[["how to bake a cake",0,[512,433]],["how to bake cookies",0,[512]]],{"k":1}])';
    expect(parseSuggestions(body)).toEqual(["how to bake a cake", "how to bake cookies"]);
  });
});
