import { openAsBlob, realpathSync, statSync } from "node:fs";
import { extname, isAbsolute, relative } from "node:path";
import { OpError } from "./bridge.js";
import { normalizeError } from "./google.js";

const UPLOAD_ROOT = "https://www.googleapis.com/upload/youtube/v3";

const VIDEO_TYPES: Record<string, string> = {
  ".mp4": "video/mp4",
  ".m4v": "video/mp4",
  ".mov": "video/quicktime",
  ".webm": "video/webm",
  ".mkv": "video/x-matroska",
  ".avi": "video/x-msvideo",
  ".wmv": "video/x-ms-wmv",
  ".flv": "video/x-flv",
  ".mpg": "video/mpeg",
  ".mpeg": "video/mpeg",
  ".3gp": "video/3gpp",
};

const IMAGE_TYPES: Record<string, string> = { ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png" };

const THUMBNAIL_MAX_BYTES = 2 * 1024 * 1024;

function invalid(message: string): never {
  throw new OpError({ status: 400, reason: "invalidFile", message });
}

export type LocalFile = { path: string; size: number; contentType: string };

export function resolveLocalFile(filePath: unknown, types: Record<string, string>, uploadDir?: string): LocalFile {
  if (typeof filePath !== "string" || !isAbsolute(filePath)) invalid(`filePath must be an absolute path, got ${JSON.stringify(filePath)}.`);
  let real: string;
  try {
    real = realpathSync(filePath);
  } catch {
    invalid(`${filePath} does not exist.`);
  }
  if (uploadDir) {
    const rel = relative(realpathSync(uploadDir), real);
    if (rel.startsWith("..") || isAbsolute(rel)) invalid(`${filePath} is outside YOUTUBE_MCP_UPLOAD_DIR (${uploadDir}).`);
  }
  const stat = statSync(real);
  if (!stat.isFile()) invalid(`${filePath} is not a regular file.`);
  const contentType = types[extname(real).toLowerCase()];
  if (!contentType) invalid(`${filePath} has an unsupported extension. Supported: ${Object.keys(types).join(", ")}.`);
  return { path: real, size: stat.size, contentType };
}

export const resolveVideo = (p: unknown, dir?: string) => resolveLocalFile(p, VIDEO_TYPES, dir);

export function resolveThumbnail(p: unknown, dir?: string): LocalFile {
  const file = resolveLocalFile(p, IMAGE_TYPES, dir);
  if (file.size > THUMBNAIL_MAX_BYTES) invalid(`${p} is ${file.size} bytes; YouTube thumbnails must be 2 MB or less.`);
  return file;
}

async function json(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!res.ok) throw new OpError(normalizeError(res.status, text));
  return JSON.parse(text);
}

export async function uploadVideo(file: LocalFile, metadata: Record<string, unknown>, auth: Record<string, string>) {
  const part = Object.keys(metadata).join(",");
  const start = await fetch(`${UPLOAD_ROOT}/videos?uploadType=resumable&part=${encodeURIComponent(part)}`, {
    method: "POST",
    headers: {
      ...auth,
      "content-type": "application/json; charset=UTF-8",
      "x-upload-content-length": String(file.size),
      "x-upload-content-type": file.contentType,
    },
    body: JSON.stringify(metadata),
  });
  if (!start.ok) await json(start);
  const session = start.headers.get("location");
  if (!session) throw new OpError({ status: 502, reason: "uploadFailed", message: "Google did not return a resumable upload session URL." });
  return json(
    await fetch(session, {
      method: "PUT",
      headers: { ...auth, "content-type": file.contentType, "content-length": String(file.size) },
      body: await openAsBlob(file.path),
    }),
  );
}

export async function setThumbnail(videoId: string, file: LocalFile, auth: Record<string, string>) {
  return json(
    await fetch(`${UPLOAD_ROOT}/thumbnails/set?uploadType=media&videoId=${encodeURIComponent(videoId)}`, {
      method: "POST",
      headers: { ...auth, "content-type": file.contentType, "content-length": String(file.size) },
      body: await openAsBlob(file.path),
    }),
  );
}
