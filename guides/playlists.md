# playlists: list, create, edit, and manage items

## List the channel's playlists

```js run
const items = await yt.paginate((p) => yt.data.playlists.list(p), { part: "snippet,contentDetails,status", mine: true, maxResults: 50 });
return items.map((p) => ({ id: p.id, title: p.snippet.title, videos: p.contentDetails.itemCount, privacy: p.status.privacyStatus }));
```

## Videos in a playlist

```js run
const playlistId = "PLAYLIST_ID";
const items = await yt.paginate((p) => yt.data.playlistItems.list(p), { part: "snippet,contentDetails", playlistId, maxResults: 50 }, { max: 500 });
return items.map((i) => ({ itemId: i.id, videoId: i.contentDetails.videoId, title: i.snippet.title, position: i.snippet.position }));
```

Each item has two ids. `contentDetails.videoId` is the video. `id` is the playlist item, which you need to remove or reorder it.

## Create

```js
const pl = await yt.data.playlists.insert({ part: "snippet,status" }, {
  snippet: { title: "Best of 2026", description: "..." },
  status: { privacyStatus: "private" },
});
```

A public playlist is gated and needs `{ confirm: true }`.

## Edit

`playlists.update` replaces each part you send, like `videos.update`. List the playlist first and send back the full `snippet` (it must include `title`) and, if you change privacy, the full `status`.

## Add, move, remove videos

```js
await yt.data.playlistItems.insert({ part: "snippet" }, { snippet: { playlistId, resourceId: { kind: "youtube#video", videoId }, position: 0 } });
await yt.data.playlistItems.update({ part: "snippet" }, { id: itemId, snippet: { playlistId, resourceId: { kind: "youtube#video", videoId }, position: 3 } });
await yt.data.playlistItems.delete({ id: itemId }, undefined, { confirm: true });
```

Each insert, update, or delete costs 50 units. `position` only works on playlists sorted manually.
