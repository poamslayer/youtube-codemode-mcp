# comments: read, reply, and moderate

Comment methods need the `youtube.force-ssl` scope, which this server requests.

## Read top-level comments on a video

```js run
const videoId = "VIDEO_ID";
const threads = await yt.paginate((p) => yt.data.commentThreads.list(p), { part: "snippet", videoId, maxResults: 100, order: "relevance", textFormat: "plainText" }, { max: 200 });
return threads.map((t) => {
  const c = t.snippet.topLevelComment.snippet;
  return { threadId: t.id, commentId: t.snippet.topLevelComment.id, author: c.authorDisplayName, text: c.textDisplay, likes: c.likeCount, replies: t.snippet.totalReplyCount, published: c.publishedAt };
});
```

- `order` is `relevance` or `time`.
- `textFormat: "plainText"` returns text without HTML.
- Use `allThreadsRelatedToChannelId: CHANNEL_ID` instead of `videoId` to read comments across the whole channel.
- Comments disabled on a video returns `403 commentsDisabled`.
- `part: "snippet,replies"` includes up to 5 replies per thread. For all replies, call `yt.data.comments.list({ part: "snippet", parentId: threadId, maxResults: 100 })`.

## Post and reply

Both are gated. Show the user the text first.

```js
await yt.data.commentThreads.insert({ part: "snippet" }, { snippet: { videoId, topLevelComment: { snippet: { textOriginal: "Thanks for watching!" } } } }, { confirm: true });
await yt.data.comments.insert({ part: "snippet" }, { snippet: { parentId: threadId, textOriginal: "Glad it helped." } }, { confirm: true });
```

## Moderate

```js
await yt.data.comments.setModerationStatus({ id: commentId, moderationStatus: "rejected" });
await yt.data.comments.delete({ id: commentId }, undefined, { confirm: true });
```

`moderationStatus` is `heldForReview`, `published`, or `rejected`. To list held comments, pass `moderationStatus: "heldForReview"` to `commentThreads.list`.
