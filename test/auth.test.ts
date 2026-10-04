import http from "node:http";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createAuth, SCOPES, type AuthConfig } from "../src/host/auth.js";

let tokenServer: http.Server;
let tokenUri: string;
const refreshes: URLSearchParams[] = [];

beforeAll(async () => {
  tokenServer = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const form = new URLSearchParams(body);
      refreshes.push(form);
      if (form.get("refresh_token") === "revoked") {
        res.writeHead(400, { "content-type": "application/json" }).end(JSON.stringify({ error: "invalid_grant", error_description: "Token has been revoked." }));
        return;
      }
      res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ access_token: "fresh", expires_in: 3600, scope: SCOPES.join(" ") }));
    });
  });
  await new Promise<void>((r) => tokenServer.listen(0, "127.0.0.1", r));
  tokenUri = `http://127.0.0.1:${(tokenServer.address() as AddressInfo).port}/token`;
});
afterAll(() => tokenServer.close());

function setup(token?: object, opts: { apiKey?: string; clientSecret?: boolean } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "auth-"));
  const opened: string[] = [];
  const config: AuthConfig = {
    configDir: dir,
    clientSecretPath: join(dir, "client_secret.json"),
    tokenPath: join(dir, "token.json"),
    apiKey: opts.apiKey,
    openUrl: (u) => opened.push(u),
  };
  if (opts.clientSecret !== false) {
    writeFileSync(
      config.clientSecretPath,
      JSON.stringify({ installed: { client_id: "cid", client_secret: "cs", auth_uri: "https://accounts.google.com/o/oauth2/auth", token_uri: tokenUri } }),
    );
  }
  if (token) writeFileSync(config.tokenPath, JSON.stringify(token));
  return { auth: createAuth(config), config, opened };
}

const pythonToken = (over: object = {}) => ({
  token: "ya29.saved",
  refresh_token: "1//refresh",
  token_uri: tokenUri,
  client_id: "cid",
  client_secret: "cs",
  scopes: SCOPES,
  universe_domain: "googleapis.com",
  account: "",
  expiry: "2099-01-01T00:00:00.123456Z",
  ...over,
});

describe("auth", () => {
  it("uses a token saved by the Python server as-is", async () => {
    const { auth } = setup(pythonToken());
    expect(await auth.headers(false)).toEqual({ authorization: "Bearer ya29.saved" });
  });

  it("reads Python's naive-UTC expiry format", async () => {
    const { auth } = setup(pythonToken({ expiry: "2099-01-01T00:00:00" }));
    expect(await auth.headers(false)).toEqual({ authorization: "Bearer ya29.saved" });
  });

  it("refreshes an expired token and saves it in the same format", async () => {
    const { auth, config } = setup(pythonToken({ expiry: "2020-01-01T00:00:00Z" }));
    expect(await auth.headers(false)).toEqual({ authorization: "Bearer fresh" });
    expect(refreshes.at(-1)?.get("grant_type")).toBe("refresh_token");
    const saved = JSON.parse(readFileSync(config.tokenPath, "utf8"));
    expect(saved).toMatchObject({ token: "fresh", refresh_token: "1//refresh", client_id: "cid", scopes: SCOPES });
    expect(Date.parse(saved.expiry)).toBeGreaterThan(Date.now());
  });

  it("drops a token missing scopes and starts consent instead of using it", async () => {
    const { auth, config, opened } = setup(pythonToken({ scopes: SCOPES.slice(0, 3) }));
    await expect(auth.headers(false)).rejects.toMatchObject({ info: { reason: "authRequired", message: expect.stringContaining("yt-analytics.readonly") } });
    expect(existsSync(config.tokenPath)).toBe(false);
    expect(opened).toHaveLength(1);
    const url = new URL(opened[0]!);
    expect(url.searchParams.get("scope")).toBe(SCOPES.join(" "));
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("redirect_uri")).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    expect((await auth.status()).consentUrl).toBe(opened[0]);
  });

  it("opens the browser once while consent is pending", async () => {
    const { auth, opened } = setup();
    await expect(auth.headers(false)).rejects.toMatchObject({ info: { reason: "authRequired" } });
    await expect(auth.headers(false)).rejects.toMatchObject({ info: { reason: "authRequired" } });
    expect(opened).toHaveLength(1);
  });

  it("starts consent when the refresh token was revoked", async () => {
    const { auth, config } = setup(pythonToken({ refresh_token: "revoked", expiry: "2020-01-01T00:00:00Z" }));
    await expect(auth.headers(false)).rejects.toMatchObject({ info: { reason: "authRequired", message: expect.stringContaining("invalid_grant") } });
    expect(existsSync(config.tokenPath)).toBe(false);
  });

  it("explains how to set up the OAuth client when none exists", async () => {
    const { auth } = setup(undefined, { clientSecret: false });
    await expect(auth.headers(false)).rejects.toMatchObject({ info: { reason: "authNotConfigured" } });
  });

  it("uses the API key for public reads only when no token was saved", async () => {
    expect(await setup(undefined, { apiKey: "k" }).auth.headers(true)).toEqual({ "x-goog-api-key": "k" });
    expect(await setup(pythonToken(), { apiKey: "k" }).auth.headers(true)).toEqual({ authorization: "Bearer ya29.saved" });
  });
});
