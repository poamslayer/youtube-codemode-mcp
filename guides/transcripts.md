# transcripts: captions of any public video

`yt.transcript(videoId, { lang = "en" })` reads captions the way the YouTube web player does. It works on any public video with captions and uses no quota.

```js run
const t = await yt.transcript("jNQXAC9IVRw");
return { language: t.language, isGenerated: t.isGenerated, segments: t.segments.length, text: t.fullText.slice(0, 200), available: t.available };
```

The result:

| Field | Meaning |
|---|---|
| `language` | Language code of the track returned |
| `isGenerated` | `true` for YouTube's automatic captions |
| `fullText` | All segments joined with spaces |
| `segments` | `[{ text, start, duration }]`, times in seconds |
| `available` | Every track: `[{ languageCode, isGenerated }]` |
| `note` | Present when `lang` had no track and another language came back |

Manual tracks win over automatic ones. `lang: "de"` matches `de-DE`. There is no machine translation. When the language is missing, you get the first manual track and a `note`, so translate the text yourself.

## Errors

| reason | Meaning |
|---|---|
| `transcriptsDisabled` | The video has no captions. |
| `videoUnavailable` | Private, deleted, or a bad id. |
| `ageRestricted` | Needs a signed-in browser session. Not supported. |
| `requestBlocked` | YouTube rate-limited this IP. Wait several minutes. |
| `poTokenRequired`, `transcriptFetchFailed` | YouTube changed something. The scraper needs an update. |

This uses YouTube's unofficial web endpoints, not the Data API. It can break without notice. Fetch transcripts one at a time; bursts trigger `requestBlocked`.

For your own videos, the official route is `yt.data.captions.list({ part: "snippet", videoId })` and `yt.data.captions.download({ id, tfmt: "srt" })`. That costs 50 and 200 units.
