// text-tools cell — pure functions over strings.
import { createHash } from "node:crypto";
export async function slugify({ text = "" } = {}) {
  return { slug: String(text).toLowerCase().normalize("NFKD").replace(/[^\w\s-]/g,"").trim().replace(/[\s_]+/g,"-").replace(/-+/g,"-") };
}
export async function wordcount({ text = "" } = {}) {
  const s = String(text);
  return { chars: s.length, words: (s.trim().match(/\S+/g)||[]).length, lines: s.split(/\r?\n/).length };
}
export async function sha256({ text = "" } = {}) {
  return { algo: "sha256", hex: createHash("sha256").update(String(text)).digest("hex") };
}
