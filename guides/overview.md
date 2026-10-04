# overview: the yt client, return shape, limits, and the confirm rule

`execute(code)` runs your code as the body of an async function in a sandbox. Use `return` to send a value back. It must be JSON-serializable. `console.log` output comes back as `logs`.

The sandbox has no network, no environment variables, and no host files. Every call to YouTube goes through `yt`, and the host attaches the OAuth token, charges quota, and applies the confirm rule.

## The yt client

| Call | What it does |
|---|---|
| `yt.data.<resource>.<method>(params, body?, { confirm? })` | Any YouTube Data API v3 method, e.g. `yt.data.videos.list({ part: "snippet", id: "abc" })`. |
| `yt.analytics.query(params)` | Analytics `reports.query`. `ids` defaults to `channel==MINE`, dates to the last 28 days. Returns `{ columns, rows }` with rows as objects. |
| `yt.analytics.<resource>.<method>(params, body?)` | Raw Analytics API, e.g. `yt.analytics.groups.list({ mine: true })`. |
| `yt.reporting.<resource>.<method>(params, body?)` | Reporting API, e.g. `yt.reporting.jobs.reports.list({ jobId })`. |
| `yt.reporting.download(downloadUrl, { maxChars? })` | Report CSV text, capped at 50,000 chars by default. |
| `yt.paginate(fn, params, { max })` | Calls `fn` with each `pageToken` and returns all `items`, up to `max` (default 500). |
| `yt.transcript(videoId, { lang? })` | Captions of any public video. No quota. See `docs("transcripts")`. |
| `yt.suggest(query, { lang? })` | YouTube search autocomplete. No quota. |
| `yt.upload(absPath, { snippet, status }, { confirm })` | Upload a local video. See `docs("publishing")`. |
| `yt.setThumbnail(videoId, absPath, { confirm })` | Set a JPEG or PNG thumbnail, 2 MB max. |
| `yt.quota()` | Today's estimated usage per bucket. |
| `yt.auth.status()` | Sign-in state, granted scopes, file paths. |

Helpers in scope: `formatDuration(iso)` gives `"1h 2m 3s"`, `durationSeconds(iso)`, `isLikelyShort(iso, maxSeconds = 180)`, and `toRows(rawAnalyticsResponse)`.

Method names and parameters match the Discovery docs exactly. Use `search()` to look them up. An unknown parameter is an error that lists the valid ones.

## Errors

Every failed `yt` call throws an `Error` with `status`, `reason`, and `message`. Catch it to recover.

| reason | Meaning |
|---|---|
| `authRequired` | Not signed in. A consent page opened in the user's browser. Ask them to approve, then rerun. |
| `authNotConfigured` | No OAuth client file. See `docs("auth")`. |
| `quotaExceeded` | The day's quota is used up. Resets at midnight Pacific. |
| `invalidParams` | Missing or unknown parameter. The message lists the valid ones. |
| `unknownMethod` | No such method. The message lists close matches. |
| `forbidden`, `insufficientPermissions` | The signed-in account cannot do this. Analytics needs the channel owner account. |
| `callLimit` | More than 500 `yt` calls in one run. Batch ids instead. |
| `quotaBudgetExceeded` | The run hit the `quotaBudget` passed to `execute`. Nothing was sent. |

## Limits

- 60 seconds of wall clock per run. Time spent in an upload does not count.
- 500 `yt` calls per run.
- 100 KB of returned JSON. Larger results come back truncated with `truncated: true`. Aggregate in code and return less.
- Optional `quotaBudget` on `execute`: the most Data API units this run may spend. Pass one for loops over many pages or videos.

## The confirm rule

These calls return a dry run and send nothing unless the last argument is `{ confirm: true }`:

- any `*.delete`
- `videos.insert` and `yt.upload`
- `videos.update`, `playlists.insert`, or `playlists.update` that set `status.privacyStatus` to `"public"`
- `commentThreads.insert`, `comments.insert`
- `thumbnails.set` and `yt.setThumbnail`
- `captions.insert`, `captions.update`
- `liveBroadcasts.transition`
- `reporting.jobs.create`

The dry run looks like `{ dryRun: true, effect, wouldCall: { op, method, url, body }, cost }`. Show it to the user. Repeat the call with `{ confirm: true }` only after they approve.

```js run
const dry = await yt.data.videos.delete({ id: "VIDEO_ID" });
return { dryRun: dry.dryRun, effect: dry.effect };
```

## Example: the channel's uploads with stats

The uploads playlist lists every video. `videos.list` takes up to 50 ids per call.

```js run
const ch = await yt.data.channels.list({ part: "contentDetails,statistics", mine: true });
const uploads = ch.items[0].contentDetails.relatedPlaylists.uploads;
const items = await yt.paginate((p) => yt.data.playlistItems.list(p), { part: "contentDetails", playlistId: uploads, maxResults: 50 }, { max: 200 });
const ids = items.map((i) => i.contentDetails.videoId);
const videos = [];
for (let i = 0; i < ids.length; i += 50) {
  const page = await yt.data.videos.list({ part: "snippet,statistics,contentDetails", id: ids.slice(i, i + 50) });
  videos.push(...page.items);
}
return videos.map((v) => ({
  id: v.id,
  title: v.snippet.title,
  published: v.snippet.publishedAt,
  duration: formatDuration(v.contentDetails.duration),
  views: Number(v.statistics.viewCount ?? 0),
  likes: Number(v.statistics.likeCount ?? 0),
}));
```

A brand-new channel's uploads playlist may not exist yet, and `playlistItems.list` then fails with `playlistNotFound`. Treat that as zero videos.
