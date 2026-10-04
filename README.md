# youtube-codemode-mcp

An MCP server that lets Claude work with your YouTube channel by writing code. It exposes three tools:

| Tool | What it does |
|---|---|
| `docs(topic?)` | Guides for the `yt` client: recipes, quota rules, gotchas. |
| `search(code)` | Runs JavaScript against the bundled YouTube API specs to find methods and parameters. No network. |
| `execute(code)` | Runs JavaScript against your channel through a `yt` client, in a sandbox with no network, files, or credentials. |

Instead of calling 40 narrow tools one at a time, Claude writes one short program: list your uploads, pull their stats, join Analytics, and return a summary. That takes one round trip.

```js
const { rows } = await yt.analytics.query({
  metrics: "views,averageViewDuration",
  dimensions: "video",
  filters: "creatorContentType==shorts",
  sort: "-views",
  maxResults: 10,
});
const { items } = await yt.data.videos.list({ part: "snippet", id: rows.map((r) => r.video) });
return rows.map((r, i) => ({ title: items.find((v) => v.id === r.video)?.snippet.title, ...r }));
```

It covers the YouTube Data API v3, Analytics v2, and Reporting v1, plus transcripts of public videos and search autocomplete.

## Requirements

- Node.js 20 or newer
- macOS or Linux. `workerd` also ships for Windows x64, but this server has not been tested there.
- A Google Cloud project with an OAuth client

## Install

Nothing to install up front. Claude starts the server with `npx`, as shown in [Add it to Claude](#add-it-to-claude).

To run from source instead:

```bash
git clone https://github.com/poamslayer/youtube-codemode-mcp.git
cd youtube-codemode-mcp
npm install
npm run build
```

This puts the server at `dist/index.js`.

## Set up Google OAuth

1. In [Google Cloud Console](https://console.cloud.google.com/), create or pick a project.
2. Enable **YouTube Data API v3**, **YouTube Analytics API**, and **YouTube Reporting API**.
3. Configure the OAuth consent screen. While the app is in testing, add your channel's Google account as a test user.
4. Under **Credentials**, create an **OAuth client ID** of type **Desktop app**.
5. Download the JSON and save it as `~/.youtube-mcp/client_secret.json`.

The first time Claude calls YouTube, a consent page opens in your browser. Sign in with the account that **owns** the channel. Manager accounts cannot read Analytics. Approve every permission, then ask Claude to retry.

## Add it to Claude

**Claude Code:**

```bash
claude mcp add youtube -- npx -y youtube-codemode-mcp
```

**Claude Desktop**, in `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "youtube": {
      "command": "npx",
      "args": ["-y", "youtube-codemode-mcp"]
    }
  }
}
```

From source, use `node /absolute/path/to/youtube-codemode-mcp/dist/index.js` as the command instead.

## Configuration

| Variable | Default | Purpose |
|---|---|---|
| `YOUTUBE_MCP_CONFIG_DIR` | `~/.youtube-mcp` | Where the token, client secret, and quota ledger live |
| `YOUTUBE_MCP_CLIENT_SECRET` | `<config dir>/client_secret.json` | Path to the OAuth client JSON |
| `YOUTUBE_API_KEY` | unset | Used for public Data API reads when you have not signed in |
| `YOUTUBE_MCP_UPLOAD_DIR` | unset | If set, uploads and thumbnails may only read files inside this folder |

## Safety

- **Credentials stay on the host.** Model code runs in a [workerd](https://github.com/cloudflare/workerd) isolate with `globalOutbound: null`. It cannot reach the network, read environment variables, or read your files. Its only way out is the `yt` client, which goes through the host.
- **Destructive and public actions need confirmation.** Deletes, uploads, comments, thumbnails, captions, Reporting jobs, live transitions, and anything that sets a video or playlist to public return a dry run and send nothing unless the code passes `{ confirm: true }`.
- **Quota is tracked before each call.** The ledger lives in `~/.youtube-mcp/quota.json`, keyed by Google project and Pacific-time day, with three buckets: 10,000 units, 100 searches, and 100 uploads. Pass `quotaBudget` to `execute` to cap a single run.
- **Limits per run.** 60 seconds of wall clock (upload time excluded), 500 `yt` calls, and 100 KB of returned JSON.

## Migrating from the Python version (0.x, 40 tools)

Version 1.0 is a rewrite in TypeScript, and the tool surface is different. The 40 tools are gone, and Claude now writes code against `yt`. `docs("analytics")` and the other guides hold the same recipes the old tools ran.

- **Your sign-in carries over.** The server reads the same `~/.youtube-mcp/token.json` and `client_secret.json`, in the same format.
- **Change your client config.** It used to run `youtube-studio-mcp` installed with pip or uv. The npm package is named `youtube-codemode-mcp`, and it runs with `npx` as shown above.
- **Quota now persists** across restarts. The Python version kept it in memory.
- **Search costs follow Google's 2026 model.** `search.list` uses one of 100 daily search calls instead of 100 units.
- **Transcripts** use the same unofficial method as `youtube-transcript-api`. Automatic translation is gone, because YouTube now rate-limits it. When a language is missing, the transcript comes back in another language with a note.

| Old tool | Now |
|---|---|
| `youtube_get_channel` | `yt.data.channels.list({ part, mine: true })` |
| `youtube_list_videos` | Uploads playlist recipe in `docs("overview")` |
| `youtube_get_video` | `yt.data.videos.list({ part, id })` |
| `youtube_analytics_*` (13 tools) | Recipes in `docs("analytics")` |
| `youtube_list_playlists`, `youtube_create_playlist`, `youtube_update_playlist`, `youtube_delete_playlist`, `youtube_add_to_playlist`, `youtube_remove_from_playlist` | `yt.data.playlists.*` and `yt.data.playlistItems.*`, see `docs("playlists")` |
| `youtube_upload_video`, `youtube_update_video`, `youtube_set_thumbnail`, `youtube_delete_video` | `yt.upload`, `yt.data.videos.update`, `yt.setThumbnail`, `yt.data.videos.delete`, see `docs("publishing")` |
| `youtube_list_captions`, `youtube_get_transcript` | `yt.data.captions.list`, `yt.transcript`, see `docs("transcripts")` |
| `youtube_reporting_*` (5 tools) | `yt.reporting.*` and `yt.reporting.download`, see `docs("reporting")` |
| `youtube_list_comments`, `youtube_post_comment`, `youtube_reply_to_comment`, `youtube_delete_comment` | `yt.data.commentThreads.*` and `yt.data.comments.*`, see `docs("comments")` |
| `youtube_search`, `youtube_trending`, `youtube_get_categories`, `youtube_search_suggestions` | `yt.data.search.list`, `videos.list({ chart: "mostPopular" })`, `yt.data.videoCategories.list`, `yt.suggest`, see `docs("discovery")` |
| `youtube_auth`, `youtube_auth_status` | Sign-in starts on the first call. `yt.auth.status()` |

## Development

```bash
npm test                 # unit and sandbox integration tests
npm run typecheck
npm run fetch-specs      # refresh the Discovery docs in specs/
node scripts/fetch-analytics-fields.mjs   # refresh Analytics metrics and dimensions
npm run check-guides     # run every guide recipe against your signed-in channel (uses real quota)
ACCEPT_VIDEO_ID=<your video> node scripts/acceptance.mjs   # end-to-end acceptance checks (uses real quota)
```

`src/host` holds the Node side: the MCP server, OAuth, quota, the op registry built from the Discovery docs, and the bridge the sandbox calls. `sandbox/` holds the workerd config, the supervisor that loads each run into a fresh isolate, and the `yt` client that runs inside it. Each `execute` call spawns its own workerd process, which takes about 13 ms to start, and kills it when the run ends or hits its deadline.

## License

MIT
