# quota: costs, daily limits, and how to spend less

The YouTube Data API meters each Google Cloud project per day. Limits reset at midnight Pacific time. `yt.quota()` shows this server's running estimate. Google's count is the real one and also includes any other app on the same project.

## Buckets

Google's quota table, updated 2026-09-15, has three separate allowances:

| Bucket | Daily limit | What uses it |
|---|---|---|
| `units` | 10,000 | Every Data API method except the two below |
| `search` | 100 calls | `search.list`, 1 per call |
| `upload` | 100 calls | `videos.insert` and `yt.upload`, 1 per call |

## Costs in the units bucket

| Method | Cost |
|---|---|
| Most `list` calls, `videos.getRating` | 1 |
| `captions.list` | 50 |
| Inserts, updates, deletes, `thumbnails.set`, `videos.rate`, `watermarks.set` | 50 |
| `captions.insert` | 400 |
| `captions.update` | 450 |
| `captions.download` | 200 |

Analytics, Reporting, `yt.transcript`, and `yt.suggest` use no Data API quota.

`search()` has the full table: `spec.quotaCosts["youtube.videos.list"]`.

## Spend less

- Every page of a paginated call costs again. Set `maxResults` to the maximum (50 for most lists) and stop early with `yt.paginate(..., { max })`.
- `videos.list` takes up to 50 ids in one call that costs 1. Never loop one id at a time.
- Use the uploads playlist (`docs("overview")`) to list a channel's videos. It costs 1 per 50 videos. `search.list` uses a scarce search call and returns at most 500 results.
- Ask only for the `part` values you need.
- Analytics answers most performance questions without touching Data API quota.

When a call would cross a limit, it throws `reason: "quotaExceeded"` before anything is sent, with `details: { bucket, used, limit, cost }`.

```js run
const q = await yt.quota();
return { date: q.date, units: q.units, search: q.search, upload: q.upload };
```
