const MAX_LOG_LINES = 200;
const MAX_LOG_LINE = 2000;

function callOp(YT, op, args) {
  return YT.call(op, args).then((res) => {
    if (res.ok) return res.value;
    const err = new Error(res.error.message);
    Object.assign(err, res.error);
    throw err;
  });
}

// Every property access extends the dotted op name, every call sends it,
// so yt.data.videos.list(p) becomes op "youtube.videos.list".
function opPath(YT, segments, overrides = {}) {
  return new Proxy(function () {}, {
    get(_, key) {
      if (typeof key !== "string" || key === "then") return undefined;
      if (Object.hasOwn(overrides, key)) return overrides[key];
      return opPath(YT, [...segments, key]);
    },
    apply(_, __, [params = {}, body, options]) {
      return callOp(YT, segments.join("."), { params, body, options });
    },
  });
}

export function makeYt(YT) {
  const call = (op, params = {}, options) => callOp(YT, op, { params, options });
  const yt = {
    data: opPath(YT, ["youtube"]),
    reporting: opPath(YT, ["reporting"], {
      download: (downloadUrl, opts = {}) => call("reporting.download", { downloadUrl, ...opts }),
    }),
    analytics: opPath(YT, ["analytics"]),
    transcript: (videoId, opts = {}) => call("transcript", { videoId, ...opts }),
    suggest: (query, opts = {}) => call("suggest", { query, ...opts }),
    upload: (filePath, metadata, options) => call("upload", { filePath, metadata }, options),
    setThumbnail: (videoId, filePath, options) => call("setThumbnail", { videoId, filePath }, options),
    quota: () => call("quota"),
    auth: { status: () => call("auth.status") },
    // playlistItems.list keeps returning the same nextPageToken with zero
    // items after the last page, so an empty page or a repeated token ends it.
    async paginate(fn, params = {}, { max = 500 } = {}) {
      const items = [];
      const seen = new Set();
      let pageToken;
      while (items.length < max) {
        const page = await fn({ ...params, ...(pageToken ? { pageToken } : {}) });
        const got = page.items ?? [];
        items.push(...got);
        pageToken = page.nextPageToken;
        if (!pageToken || !got.length || seen.has(pageToken)) break;
        seen.add(pageToken);
      }
      return items.slice(0, max);
    },
  };
  return yt;
}

const DURATION = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/;

export function durationSeconds(iso) {
  const m = DURATION.exec(iso ?? "");
  if (!m) return undefined;
  const [d, h, min, s] = m.slice(1).map((x) => Number(x ?? 0));
  return d * 86400 + h * 3600 + min * 60 + s;
}

export function formatDuration(iso) {
  const total = durationSeconds(iso);
  if (total === undefined) return "unknown";
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const parts = [];
  if (h) parts.push(`${h}h`);
  if (m) parts.push(`${m}m`);
  if (s || !parts.length) parts.push(`${s}s`);
  return parts.join(" ");
}

// Shorts can run up to 3 minutes since October 2024. Duration alone cannot
// separate a 2-minute Short from a 2-minute video; Analytics
// creatorContentType is the authoritative split.
export function isLikelyShort(iso, maxSeconds = 180) {
  const total = durationSeconds(iso);
  return total !== undefined && total <= maxSeconds;
}

export function toRows(response) {
  const columns = (response.columnHeaders ?? []).map((h) => h.name);
  return (response.rows ?? []).map((row) => Object.fromEntries(columns.map((c, i) => [c, row[i]])));
}

function captureConsole(logs) {
  const push = (level) => (...args) => {
    if (logs.length >= MAX_LOG_LINES) return;
    const line = args.map((a) => (typeof a === "string" ? a : safeJson(a))).join(" ");
    logs.push((level === "log" ? "" : `[${level}] `) + line.slice(0, MAX_LOG_LINE));
  };
  for (const level of ["log", "info", "warn", "error", "debug"]) console[level] = push(level);
}

function safeJson(v) {
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

export async function run(YT, fn) {
  const logs = [];
  captureConsole(logs);
  try {
    const value = await fn(YT ? makeYt(YT) : undefined);
    return { ok: true, json: JSON.stringify(value), logs };
  } catch (e) {
    const error = { name: e?.name ?? "Error", message: String(e?.message ?? e) };
    for (const k of ["status", "reason", "details"]) if (e?.[k] !== undefined) error[k] = e[k];
    return { ok: false, error, logs };
  }
}
