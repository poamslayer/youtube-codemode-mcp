# publishing: upload, edit metadata, schedule, and thumbnails

## Edit a video: read, modify, write

`videos.update` replaces every field of each `part` you send. A field you leave out is cleared. Always `list` the parts first, change what you need, and send the whole part back.

- `snippet` must include `title` and `categoryId`. Titles max out at 100 characters and descriptions at 5,000.
- `status` must carry every mutable field you want to keep, including `privacyStatus`, `selfDeclaredMadeForKids`, `embeddable`, `license`, and `publicStatsViewable`.

```js run
const videoId = "VIDEO_ID";
const [video] = (await yt.data.videos.list({ part: "snippet,status", id: videoId })).items;
if (!video) return { error: `No video ${videoId} on this channel` };
const snippet = { ...video.snippet, title: video.snippet.title.slice(0, 100) };
delete snippet.thumbnails;
delete snippet.localized;
return { wouldSend: { id: videoId, snippet } };
```

To apply it, call `yt.data.videos.update({ part: "snippet" }, { id: videoId, snippet })`. A change to `privacyStatus: "public"` is gated, so pass `{ confirm: true }` after the user approves.

## Upload

`yt.upload(absPath, metadata, { confirm: true })` streams a local file with a resumable upload. `metadata` holds the parts to set, usually `snippet` and `status`. The path must be absolute. When `YOUTUBE_MCP_UPLOAD_DIR` is set, the file must be inside it.

```js
const video = await yt.upload("/Users/me/Movies/clip.mp4", {
  snippet: { title: "My video", description: "...", tags: ["a", "b"], categoryId: "22" },
  status: { privacyStatus: "private", selfDeclaredMadeForKids: false },
}, { confirm: true });
return { id: video.id, status: video.status };
```

- Uploads use the `upload` bucket, 100 per day.
- Videos uploaded by an unverified Google Cloud project are locked to private until the project passes a YouTube API audit.
- Set `selfDeclaredMadeForKids` at upload. YouTube asks for it before a video can go public.
- Category ids per region come from `yt.data.videoCategories.list({ part: "snippet", regionCode: "US" })`. `22` is People & Blogs.

## Schedule a publish

Set `status.publishAt` to an ISO 8601 time in the future. It only works with `privacyStatus: "private"`. YouTube flips the video to public at that time.

```js
status: { privacyStatus: "private", publishAt: "2026-12-01T17:00:00Z", selfDeclaredMadeForKids: false }
```

## Thumbnail

`yt.setThumbnail(videoId, absPath, { confirm: true })` takes a JPEG or PNG up to 2 MB. Custom thumbnails need a verified channel.

## Delete

`yt.data.videos.delete({ id }, undefined, { confirm: true })` is permanent.
