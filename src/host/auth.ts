import http from "node:http";
import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { OpError } from "./bridge.js";

export const SCOPES = [
  "https://www.googleapis.com/auth/youtube.readonly",
  "https://www.googleapis.com/auth/youtube",
  "https://www.googleapis.com/auth/youtube.upload",
  "https://www.googleapis.com/auth/youtube.force-ssl",
  "https://www.googleapis.com/auth/yt-analytics.readonly",
  "https://www.googleapis.com/auth/yt-analytics-monetary.readonly",
];

const CONSENT_TIMEOUT_MS = 5 * 60_000;
const EXPIRY_MARGIN_MS = 60_000;

export type AuthConfig = {
  configDir: string;
  clientSecretPath: string;
  tokenPath: string;
  apiKey?: string;
  openUrl: (url: string) => void;
};

// Same file layout as google-auth's Credentials.to_json() so tokens saved by
// the Python server keep working.
export type StoredToken = {
  token?: string;
  refresh_token?: string;
  token_uri: string;
  client_id: string;
  client_secret: string;
  scopes: string[];
  expiry?: string;
};

type ClientSecret = { client_id: string; client_secret: string; auth_uri: string; token_uri: string };

export function configFromEnv(env = process.env): AuthConfig {
  const configDir = env.YOUTUBE_MCP_CONFIG_DIR ?? join(homedir(), ".youtube-mcp");
  return {
    configDir,
    clientSecretPath: env.YOUTUBE_MCP_CLIENT_SECRET ?? join(configDir, "client_secret.json"),
    tokenPath: join(configDir, "token.json"),
    apiKey: env.YOUTUBE_API_KEY || undefined,
    openUrl: openInBrowser,
  };
}

function openInBrowser(url: string) {
  const [cmd, args] =
    process.platform === "darwin" ? ["open", [url]] : process.platform === "win32" ? ["cmd", ["/c", "start", "", url]] : ["xdg-open", [url]];
  spawn(cmd, args, { stdio: "ignore", detached: true }).on("error", () => {}).unref();
}

export function missingScopes(token: Pick<StoredToken, "scopes">): string[] {
  const granted = new Set(token.scopes ?? []);
  return SCOPES.filter((s) => !granted.has(s));
}

export function expiryMs(token: StoredToken): number {
  if (!token.expiry) return 0;
  const iso = /Z|[+-]\d\d:\d\d$/.test(token.expiry) ? token.expiry : `${token.expiry}Z`;
  return Date.parse(iso) || 0;
}

function readJson<T>(path: string): T | undefined {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch {
    return undefined;
  }
}

function writePrivate(path: string, data: unknown) {
  writeFileSync(path, JSON.stringify(data, null, 2), { mode: 0o600 });
}

type TokenResponse = { access_token: string; expires_in: number; refresh_token?: string; scope?: string; error?: string; error_description?: string };

async function postForm(url: string, form: Record<string, string>): Promise<TokenResponse> {
  const res = await fetch(url, { method: "POST", body: new URLSearchParams(form) });
  const json = (await res.json()) as TokenResponse;
  if (!res.ok || json.error) throw new Error(`${json.error ?? res.status}: ${json.error_description ?? ""}`.trim());
  return json;
}

type Consent = { url: string; done: Promise<void> };

export type Auth = ReturnType<typeof createAuth>;

export function createAuth(config: AuthConfig) {
  let consent: Promise<Consent> | undefined;

  const loadToken = () => readJson<StoredToken>(config.tokenPath);

  function loadClientSecret(): ClientSecret {
    const raw = readJson<{ installed?: ClientSecret; web?: ClientSecret }>(config.clientSecretPath);
    const secret = raw?.installed ?? raw?.web;
    if (!secret) {
      throw new OpError({
        status: 401,
        reason: "authNotConfigured",
        message:
          `No OAuth client at ${config.clientSecretPath}. In Google Cloud Console, create an OAuth client ID of type Desktop app ` +
          `(APIs & Services > Credentials), download the JSON to that path or set YOUTUBE_MCP_CLIENT_SECRET, then retry.`,
      });
    }
    return secret;
  }

  function saveToken(prev: Pick<StoredToken, "token_uri" | "client_id" | "client_secret"> & { refresh_token?: string }, res: TokenResponse) {
    const token: StoredToken = {
      token: res.access_token,
      refresh_token: res.refresh_token ?? prev.refresh_token,
      token_uri: prev.token_uri,
      client_id: prev.client_id,
      client_secret: prev.client_secret,
      scopes: res.scope ? res.scope.split(" ") : SCOPES,
      expiry: new Date(Date.now() + res.expires_in * 1000).toISOString(),
    };
    mkdirSync(config.configDir, { recursive: true });
    writePrivate(config.tokenPath, token);
    return token;
  }

  function startConsent(): Promise<Consent> {
    if (consent) return consent;
    const secret = loadClientSecret();
    const verifier = randomBytes(32).toString("base64url");
    const state = randomBytes(16).toString("hex");
    let redirectUri = "";
    let finish!: () => void;
    const done = new Promise<void>((resolve) => (finish = resolve));

    const server = http.createServer(async (req, res) => {
      const params = new URL(req.url ?? "/", "http://127.0.0.1").searchParams;
      const code = params.get("code");
      if (params.get("state") !== state || !code) {
        res.writeHead(400).end(params.get("error") ?? "Missing code or state.");
        return;
      }
      try {
        const tokenRes = await postForm(secret.token_uri, {
          code,
          client_id: secret.client_id,
          client_secret: secret.client_secret,
          redirect_uri: redirectUri,
          grant_type: "authorization_code",
          code_verifier: verifier,
        });
        saveToken(secret, tokenRes);
        res.writeHead(200, { "content-type": "text/html" }).end("<h2>YouTube MCP is connected. You can close this tab.</h2>");
      } catch (e) {
        res.writeHead(500).end(`Token exchange failed: ${(e as Error).message}`);
      }
      finish();
    });
    const timer = setTimeout(finish, CONSENT_TIMEOUT_MS);
    void done.then(() => {
      clearTimeout(timer);
      server.close();
      consent = undefined;
    });

    consent = new Promise<Consent>((resolve) => {
      server.listen(0, "127.0.0.1", () => {
        redirectUri = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
        const url = new URL(secret.auth_uri);
        url.search = new URLSearchParams({
          client_id: secret.client_id,
          redirect_uri: redirectUri,
          response_type: "code",
          scope: SCOPES.join(" "),
          access_type: "offline",
          prompt: "consent",
          code_challenge: createHash("sha256").update(verifier).digest("base64url"),
          code_challenge_method: "S256",
          state,
        }).toString();
        config.openUrl(url.toString());
        resolve({ url: url.toString(), done });
      });
    });
    return consent;
  }

  async function authRequired(why: string): Promise<never> {
    const { url } = await startConsent();
    throw new OpError({
      status: 401,
      reason: "authRequired",
      message: `${why} A Google consent page opened in the browser on this machine. Sign in with the channel owner account, approve, then rerun. If no browser opened, visit: ${url}`,
    });
  }

  async function accessToken(): Promise<string> {
    const token = loadToken();
    if (!token) return authRequired("Not signed in to YouTube.");
    const missing = missingScopes(token);
    if (missing.length) {
      rmSync(config.tokenPath, { force: true });
      return authRequired(`Saved token lacks scopes ${missing.join(", ")}.`);
    }
    if (token.token && expiryMs(token) - EXPIRY_MARGIN_MS > Date.now()) return token.token;
    if (!token.refresh_token) return authRequired("Saved token expired and has no refresh token.");
    try {
      const res = await postForm(token.token_uri, {
        client_id: token.client_id,
        client_secret: token.client_secret,
        refresh_token: token.refresh_token,
        grant_type: "refresh_token",
      });
      return saveToken(token, res).token!;
    } catch (e) {
      rmSync(config.tokenPath, { force: true });
      return authRequired(`Token refresh failed (${(e as Error).message}).`);
    }
  }

  return {
    // Data API reads fall back to the API key only when no token was ever saved,
    // so a configured OAuth user never silently loses access to private data.
    async headers(useApiKey: boolean): Promise<Record<string, string>> {
      if (useApiKey && config.apiKey && !existsSync(config.tokenPath)) return { "x-goog-api-key": config.apiKey };
      return { authorization: `Bearer ${await accessToken()}` };
    },

    projectId(): string {
      return loadToken()?.client_id ?? readJson<{ installed?: ClientSecret; web?: ClientSecret }>(config.clientSecretPath)?.installed?.client_id ?? "default";
    },

    async status() {
      const token = loadToken();
      return {
        signedIn: Boolean(token?.refresh_token) && !missingScopes(token!).length,
        scopes: token?.scopes ?? [],
        missingScopes: token ? missingScopes(token) : SCOPES,
        accessTokenExpiry: token?.expiry ?? null,
        tokenPath: config.tokenPath,
        clientSecretPath: config.clientSecretPath,
        clientSecretFound: existsSync(config.clientSecretPath),
        apiKeyConfigured: Boolean(config.apiKey),
        consentUrl: consent ? (await consent).url : null,
      };
    },

    waitForConsent: async () => (consent ? (await consent).done : undefined),
  };
}
