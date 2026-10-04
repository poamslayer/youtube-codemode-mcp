# analytics: recipes for channel and video performance

`yt.analytics.query(params)` wraps the YouTube Analytics `reports.query` method. Defaults are `ids: "channel==MINE"`, `endDate` today (Pacific), and `startDate` 28 days before `endDate`. The result is `{ columns, rows }` with each row an object keyed by column name.

Analytics uses no Data API quota.

## Rules that are easy to get wrong

- **Sign in as the channel owner.** A manager or editor account gets `forbidden`.
- **Data lags about two days.** A range ending today returns rows only up to two days ago.
- **Filter values are lowercase.** Use `creatorContentType==shorts`, `video_on_demand`, `live_stream`, or `story`. Uppercase values such as `SHORTS`, which Google's docs list, are rejected with `400 Invalid value`.
- **`dimensions: "video"` needs both `sort` and `maxResults`,** and `maxResults` can be at most 200. Leaving either out returns `400 The query is not supported`.
- **Not every metric pairs with every dimension.** A bad pair also returns `400 The query is not supported`. Check `spec.analyticsFields` in `search()` and Google's available reports list.
- **Revenue needs the YouTube Partner Program.** Without it, revenue queries succeed but return no rows.

## Channel overview

```js run
const { rows } = await yt.analytics.query({
  metrics: "views,estimatedMinutesWatched,averageViewDuration,subscribersGained,subscribersLost,likes,comments,shares",
});
return rows[0];
```

## Top long-form videos and top Shorts

Run the same query with a different content-type filter. Add titles from `videos.list`.

```js run
const top = (type) =>
  yt.analytics.query({
    metrics: "views,estimatedMinutesWatched,averageViewDuration,likes,comments,shares",
    dimensions: "video",
    filters: `creatorContentType==${type}`,
    sort: "-views",
    maxResults: 10,
  });
const [longForm, shorts] = await Promise.all([top("video_on_demand"), top("shorts")]);
const ids = [...longForm.rows, ...shorts.rows].map((r) => r.video);
const titles = ids.length ? Object.fromEntries((await yt.data.videos.list({ part: "snippet", id: ids })).items.map((v) => [v.id, v.snippet.title])) : {};
const named = (rows) => rows.map((r) => ({ title: titles[r.video], ...r }));
return { longForm: named(longForm.rows), shorts: named(shorts.rows) };
```

## Shorts vs long-form vs live

```js run
const types = ["shorts", "video_on_demand", "live_stream"];
const out = {};
for (const type of types) {
  const { rows } = await yt.analytics.query({
    metrics: "views,estimatedMinutesWatched,averageViewDuration,likes,comments,shares",
    filters: `creatorContentType==${type}`,
  });
  out[type] = rows[0] ?? null;
}
return out;
```

## One video over time

```js run
const videoId = "VIDEO_ID";
const { rows } = await yt.analytics.query({
  metrics: "views,estimatedMinutesWatched,averageViewDuration,likes,comments,shares,subscribersGained,subscribersLost",
  dimensions: "day",
  filters: `video==${videoId}`,
  sort: "day",
});
return rows;
```

## Audience retention curve

Returns 100 points from `elapsedVideoTimeRatio` 0.01 to 1.0. `audienceWatchRatio` is the share of viewers still watching. `relativeRetentionPerformance` compares against similar videos, where 0.5 is average.

```js run
const videoId = "VIDEO_ID";
const { rows } = await yt.analytics.query({
  metrics: "audienceWatchRatio,relativeRetentionPerformance",
  dimensions: "elapsedVideoTimeRatio",
  filters: `video==${videoId}`,
  sort: "elapsedVideoTimeRatio",
});
return rows.filter((_, i) => i % 10 === 9);
```

## Traffic sources

Add `filters: "video==ID"` for one video.

```js run
const { rows } = await yt.analytics.query({ metrics: "views,estimatedMinutesWatched", dimensions: "insightTrafficSourceType", sort: "-views" });
return rows;
```

## Demographics

```js run
const { rows } = await yt.analytics.query({ metrics: "viewerPercentage", dimensions: "ageGroup,gender", sort: "-viewerPercentage" });
return rows;
```

## Geography

```js run
const { rows } = await yt.analytics.query({ metrics: "views,estimatedMinutesWatched", dimensions: "country", sort: "-views", maxResults: 25 });
return rows;
```

## Daily trend

```js run
const { rows } = await yt.analytics.query({
  metrics: "views,estimatedMinutesWatched,averageViewDuration,subscribersGained,likes,shares",
  dimensions: "day",
  sort: "day",
});
return rows;
```

## Day of week

The API has no weekday dimension. Query by day and average in code.

```js run
const { rows } = await yt.analytics.query({ metrics: "views,estimatedMinutesWatched,likes,shares", dimensions: "day", sort: "day", startDate: "2026-01-01" });
const names = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const acc = names.map((day) => ({ day, views: 0, minutes: 0, days: 0 }));
for (const r of rows) {
  const a = acc[new Date(`${r.day}T00:00:00Z`).getUTCDay()];
  a.views += r.views;
  a.minutes += r.estimatedMinutesWatched;
  a.days += 1;
}
return acc.map((a) => ({ day: a.day, avgViews: a.days ? +(a.views / a.days).toFixed(1) : 0, avgMinutes: a.days ? +(a.minutes / a.days).toFixed(1) : 0, sampleDays: a.days }));
```

## Revenue

Needs the YouTube Partner Program and the monetary scope, which this server requests.

```js run
const { rows } = await yt.analytics.query({ metrics: "estimatedRevenue,estimatedAdRevenue,grossRevenue,estimatedRedPartnerRevenue" });
return rows[0] ?? { note: "No revenue rows. The channel is likely not in the YouTube Partner Program." };
```

For revenue per video, add `dimensions: "video", sort: "-estimatedRevenue", maxResults: 50` and drop `estimatedRedPartnerRevenue`.
