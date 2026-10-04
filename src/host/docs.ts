import { readdirSync, readFileSync } from "node:fs";

const GUIDES_DIR = new URL("../../guides/", import.meta.url);

export type Guide = { topic: string; summary: string; body: string };

export function loadGuides(): Map<string, Guide> {
  const guides = new Map<string, Guide>();
  for (const file of readdirSync(GUIDES_DIR).filter((f) => f.endsWith(".md")).sort()) {
    const body = readFileSync(new URL(file, GUIDES_DIR), "utf8");
    const heading = /^# ([\w-]+): (.+)$/m.exec(body);
    if (!heading) throw new Error(`guides/${file} must start with "# <topic>: <summary>"`);
    guides.set(heading[1]!, { topic: heading[1]!, summary: heading[2]!, body });
  }
  return guides;
}

export function docs(guides: Map<string, Guide>, topic?: string): { ok: boolean; text: string } {
  const index = [...guides.values()].map((g) => `- ${g.topic}: ${g.summary}`).join("\n");
  if (!topic) return { ok: true, text: `Call docs("<topic>") for a guide. Start with overview.\n\n${index}` };
  const guide = guides.get(topic.trim().toLowerCase());
  return guide ? { ok: true, text: guide.body } : { ok: false, text: `No topic "${topic}". Topics:\n\n${index}` };
}
