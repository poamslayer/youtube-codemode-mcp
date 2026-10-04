using Workerd = import "/workerd/workerd.capnp";

# Addresses are placeholders. The host overrides both per run with
# --socket-addr=http=... and --external-addr=bridge=...
const config :Workerd.Config = (
  services = [
    (name = "supervisor", worker = .supervisor),
    (name = "bridge", external = (address = "127.0.0.1:9", http = ())),
  ],
  sockets = [(name = "http", address = "127.0.0.1:0", http = (), service = "supervisor")],
);

const supervisor :Workerd.Worker = (
  modules = [(name = "supervisor.js", esModule = embed "supervisor.js")],
  compatibilityDate = "2026-09-01",
  compatibilityFlags = ["enable_ctx_exports"],
  bindings = [
    (name = "LOADER", workerLoader = ()),
    (name = "BRIDGE", service = "bridge"),
    (name = "SECRET", fromEnvironment = "YT_SANDBOX_SECRET"),
  ],
  globalOutbound = "bridge",
);
