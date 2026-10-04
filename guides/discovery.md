# discovery: search, trending, suggestions, and categories

## Search

`search.list` draws from its own bucket of 100 calls per day. Prefer cheaper calls when you can. To list one channel's videos, use its uploads playlist (`docs("overview")`) instead.

```js run
const res = await yt.data.search.list({ part: "snippet", q: "sourdough starter", type: "video", maxResults: 10, order: "relevance" });
const ids = res.items.map((i) => i.id.videoId);
const stats = await yt.data.videos.list({ part: "statistics,contentDetails", id: ids });
const byId = Object.fromEntries(stats.items.map((v) => [v.id, v]));
return res.items.map((i) => ({
  id: i.id.videoId,
  title: i.snippet.title,
  channel: i.snippet.channelTitle,
  views: Number(byId[i.id.videoId]?.statistics.viewCount ?? 0),
  duration: formatDuration(byId[i.id.videoId]?.contentDetails.duration),
}));
```

- `type` is `video`, `channel`, or `playlist`. The id is under `id.videoId`, `id.channelId`, or `id.playlistId`.
- `order` is `relevance`, `date`, `viewCount`, `rating`, or `title`.
- Narrow with `publishedAfter` (RFC 3339), `regionCode`, `relevanceLanguage`, `videoDuration` (`short` under 4 minutes, `medium`, `long` over 20), and `channelId`.
- Search results carry no statistics. Join with `videos.list`, which costs 1 per 50 ids.
- Search snippet titles are HTML-escaped (`Flour &amp; Water`). Take titles from the `videos.list` join instead, which returns them plain.

## Trending

```js run
const res = await yt.data.videos.list({ part: "snippet,statistics", chart: "mostPopular", regionCode: "US", maxResults: 10 });
return res.items.map((v) => ({ id: v.id, title: v.snippet.title, channel: v.snippet.channelTitle, views: Number(v.statistics.viewCount) }));
```

Add `videoCategoryId` to narrow by category.

## Autocomplete suggestions

Real queries people type, from YouTube's search box. No quota.

```js run
const seeds = ["how to bake", "how to bake bread"];
const out = {};
for (const q of seeds) out[q] = (await yt.suggest(q)).suggestions;
return out;
```

## Categories

```js run
const res = await yt.data.videoCategories.list({ part: "snippet", regionCode: "US" });
return res.items.filter((c) => c.snippet.assignable).map((c) => ({ id: c.id, title: c.snippet.title }));
```

## Channels by id or handle

```js run
const res = await yt.data.channels.list({ part: "snippet,statistics", forHandle: "@YouTube" });
const c = res.items[0];
return { id: c.id, title: c.snippet.title, subscribers: c.statistics.subscriberCount, videos: c.statistics.videoCount };
```
