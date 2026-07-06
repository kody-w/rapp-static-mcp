#!/usr/bin/env node
/**
 * rapp-static-mcp shim — the one small moving part.
 *
 * A generic MCP server (JSON-RPC 2.0 over stdio) that turns a STATIC catalog into a live MCP
 * endpoint. It carries ZERO per-tool logic: it reads tools.json, and on every tools/call it
 *   1. looks up the tool's bound /api compute-cell frame,
 *   2. fetches the frame bytes and VERIFIES their SHA-256 against the pinned sha8 (verify-before-exec),
 *   3. imports the exact verified bytes (as a data: module — no disk, no re-fetch),
 *   4. calls the bound export with the tool arguments, and returns the result as MCP content.
 *
 * The catalog and the logic are 100% static and content-addressed; only this transport runs.
 * Point Claude Desktop / the Copilot CLI / Cursor at it as a stdio MCP server:
 *   { "command": "node", "args": ["shim.mjs", "--catalog", "<tools.json url or path>"] }
 *
 * Usage:
 *   node shim.mjs [--catalog <tools.json url|path>] [--api <cell base url|dir>]
 *   --catalog  default: https://raw.githubusercontent.com/kody-w/rapp-static-apis/main/mcp/tools.json
 *   --api      where cell frames live; default: the catalog's api_base
 */
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";

const PROTOCOL_VERSION = "2025-06-18";
const DEFAULT_CATALOG =
  "https://raw.githubusercontent.com/kody-w/rapp-static-apis/main/mcp/tools.json";

function arg(flag, fallback) {
  const i = process.argv.indexOf(flag);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}
const CATALOG = arg("--catalog", DEFAULT_CATALOG);
const isUrl = (s) => /^https?:\/\//i.test(s);

async function readBytes(loc) {
  if (isUrl(loc)) {
    const r = await fetch(loc);
    if (!r.ok) throw new Error(`fetch ${loc} -> ${r.status}`);
    return new Uint8Array(await r.arrayBuffer());
  }
  return new Uint8Array(readFileSync(loc));
}
async function readJson(loc) {
  return JSON.parse(Buffer.from(await readBytes(loc)).toString("utf8"));
}

let catalog, API_BASE;
const cellCache = new Map(); // sha8 -> module

async function loadCatalog() {
  catalog = await readJson(CATALOG);
  API_BASE = (arg("--api", catalog.api_base) || "").replace(/\/+$/, "");
}

async function runTool(name, args) {
  const b = catalog.bindings?.[name];
  if (!b) throw new Error(`unknown tool: ${name}`);
  if (!cellCache.has(b.sha8)) {
    const loc = isUrl(API_BASE) ? `${API_BASE}/${b.pin_path}` : join(API_BASE, b.pin_path);
    const bytes = await readBytes(loc);
    const got = createHash("sha256").update(bytes).digest("hex").slice(0, 12);
    if (got !== b.sha8)
      throw new Error(`verify-before-exec FAILED for ${name}: ${got} != pinned ${b.sha8}`);
    const mod = await import(
      "data:text/javascript;base64," + Buffer.from(bytes).toString("base64")
    );
    cellCache.set(b.sha8, mod);
  }
  const mod = cellCache.get(b.sha8);
  if (typeof mod[b.export] !== "function") throw new Error(`cell missing export ${b.export}`);
  return { result: await mod[b.export](args || {}), sha8: b.sha8, cell: b.cell };
}

// ── JSON-RPC 2.0 over line-delimited stdio ──────────────────────────────────────────────────
function send(msg) {
  process.stdout.write(JSON.stringify(msg) + "\n");
}
function reply(id, result) {
  send({ jsonrpc: "2.0", id, result });
}
function fail(id, code, message) {
  send({ jsonrpc: "2.0", id, error: { code, message } });
}

async function handle(msg) {
  const { id, method, params } = msg;
  if (id === undefined) return; // a notification (e.g. notifications/initialized) — no response
  try {
    if (method === "initialize") {
      reply(id, {
        protocolVersion: params?.protocolVersion || PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: { name: catalog.name || "rapp-static-mcp", version: "1.0" },
      });
    } else if (method === "ping") {
      reply(id, {});
    } else if (method === "tools/list") {
      reply(id, { tools: catalog.tools || [] });
    } else if (method === "tools/call") {
      try {
        const { result, sha8, cell } = await runTool(params?.name, params?.arguments);
        reply(id, {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          _meta: { verified_sha8: sha8, cell },
        });
      } catch (e) {
        // tool-level failure is a result with isError, not a protocol error
        reply(id, { content: [{ type: "text", text: String(e?.message || e) }], isError: true });
      }
    } else {
      fail(id, -32601, `method not found: ${method}`);
    }
  } catch (e) {
    fail(id, -32603, String(e?.message || e));
  }
}

async function main() {
  await loadCatalog();
  let buf = "";
  let ended = false;
  const inflight = new Set();
  const track = (p) => {
    inflight.add(p);
    p.finally(() => {
      inflight.delete(p);
      if (ended && inflight.size === 0) process.exit(0); // drain before exit — don't cut off a call
    });
  };
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk) => {
    buf += chunk;
    let nl;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (line) track(Promise.resolve().then(() => handle(JSON.parse(line))));
    }
  });
  process.stdin.on("end", () => {
    ended = true;
    if (inflight.size === 0) process.exit(0);
  });
}
main().catch((e) => {
  process.stderr.write(`shim fatal: ${e?.message || e}\n`);
  process.exit(1);
});
