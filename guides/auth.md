# auth: sign-in, files, and troubleshooting

The server signs in to Google with OAuth on the user's machine. The sandbox never sees the token.

## Files

| Path | Purpose |
|---|---|
| `~/.youtube-mcp/client_secret.json` | OAuth client, type Desktop app, from Google Cloud Console. Override with `YOUTUBE_MCP_CLIENT_SECRET`. |
| `~/.youtube-mcp/token.json` | Saved token. Same format as the Python version of this server. |
| `~/.youtube-mcp/quota.json` | Local quota ledger. |

`YOUTUBE_MCP_CONFIG_DIR` moves the whole folder. `YOUTUBE_MCP_UPLOAD_DIR` restricts which local files uploads and thumbnails may read.

## First sign-in

The first `yt` call without a token opens Google's consent page in the user's browser and throws `authRequired`. Tell the user to sign in with the **account that owns the channel** and approve every permission, then rerun the code. Analytics fails for manager or editor accounts.

```js run
const s = await yt.auth.status();
return { signedIn: s.signedIn, missingScopes: s.missingScopes, clientSecretFound: s.clientSecretFound, consentUrl: s.consentUrl };
```

If no browser opened, `consentUrl` holds the link to give the user.

## Scopes

`youtube.readonly`, `youtube`, `youtube.upload`, `youtube.force-ssl`, `yt-analytics.readonly`, `yt-analytics-monetary.readonly`. A saved token missing any of them is discarded and consent runs again.

## Setting up the OAuth client

1. In Google Cloud Console, enable **YouTube Data API v3**, **YouTube Analytics API**, and **YouTube Reporting API**.
2. Configure the OAuth consent screen. While the app is in testing, add the channel owner as a test user.
3. Create credentials of type **OAuth client ID**, application type **Desktop app**.
4. Download the JSON to `~/.youtube-mcp/client_secret.json`.

## API key

With `YOUTUBE_API_KEY` set and no saved token, public Data API reads (for example `videos.list` by id or `search.list`) use the key and never prompt. Anything about "my" channel, and all Analytics and Reporting calls, still need OAuth.

## Troubleshooting

| Symptom | Fix |
|---|---|
| `authNotConfigured` | The client file is missing. Follow the setup steps above. |
| `authRequired` keeps coming back | Consent was not finished, or a scope was unchecked. Approve all of them. |
| `invalid_grant` in the message | The refresh token was revoked or expired. Testing-mode apps expire tokens after 7 days. Sign in again. |
| `forbidden` on Analytics | Signed in with an account that is not the channel owner. |
| `accessNotConfigured` | The API is not enabled in the Cloud project. |
