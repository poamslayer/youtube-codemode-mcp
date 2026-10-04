import { WorkerEntrypoint } from "cloudflare:workers";

export class YtBridge extends WorkerEntrypoint {
  async call(op, args) {
    const res = await this.env.BRIDGE.fetch("http://bridge/call", {
      method: "POST",
      headers: { authorization: `Bearer ${this.env.SECRET}`, "content-type": "application/json" },
      body: JSON.stringify({ runId: this.ctx.props.runId, op, args }),
    });
    return res.json();
  }
}

export default {
  async fetch(request, env, ctx) {
    if (request.headers.get("authorization") !== `Bearer ${env.SECRET}`) {
      return new Response("forbidden", { status: 403 });
    }
    const { runId, modules, bindYt } = await request.json();
    const worker = env.LOADER.get(runId, () => ({
      compatibilityDate: "2026-09-01",
      mainModule: "main.js",
      modules,
      env: bindYt ? { YT: ctx.exports.YtBridge({ props: { runId } }) } : {},
      globalOutbound: null,
    }));
    try {
      return Response.json(await worker.getEntrypoint().run());
    } catch (e) {
      return Response.json({ ok: false, error: { name: e?.name ?? "Error", message: String(e?.message ?? e) }, logs: [] });
    }
  },
};
