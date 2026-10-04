import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { vi } from "vitest";
import { createAuth, SCOPES } from "../src/host/auth.js";
import { startBridge } from "../src/host/bridge.js";
import { createDispatch, type DispatchOptions } from "../src/host/dispatch.js";
import { createLedger } from "../src/host/quota.js";

export type FakeRequest = { method: string; url: string; auth: string | null; body: unknown; bodyBytes?: number };

// Starts a real bridge and dispatcher with a signed-in token, and routes every
// googleapis.com request to `google` instead of the network.
export async function startTestHost(google: (req: FakeRequest) => Response | Promise<Response>, options: DispatchOptions = {}) {
  const dir = mkdtempSync(join(tmpdir(), "host-"));
  writeFileSync(
    join(dir, "token.json"),
    JSON.stringify({ token: "tok", refresh_token: "r", token_uri: "x", client_id: "proj", client_secret: "s", scopes: SCOPES, expiry: "2099-01-01T00:00:00Z" }),
  );
  const auth = createAuth({ configDir: dir, clientSecretPath: join(dir, "none.json"), tokenPath: join(dir, "token.json"), openUrl: () => {} });
  const requests: FakeRequest[] = [];
  const realFetch = globalThis.fetch;
  vi.stubGlobal("fetch", async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (!url.includes("googleapis.com")) return realFetch(input, init);
    const raw = init?.body;
    const req: FakeRequest = {
      method: init?.method ?? "GET",
      url,
      auth: new Headers(init?.headers).get("authorization"),
      body: typeof raw === "string" ? JSON.parse(raw) : undefined,
      bodyBytes: raw instanceof Blob ? raw.size : undefined,
    };
    requests.push(req);
    return google(req);
  });
  const bridge = await startBridge(createDispatch(auth, createLedger(join(dir, "quota.json")), options));
  return {
    bridge,
    requests,
    async close() {
      vi.unstubAllGlobals();
      await bridge.close();
    },
  };
}
