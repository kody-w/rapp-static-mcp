# rapp-static-mcp/1.0 — the spec

**A static MCP is a Git repo, not a running service.** The repository *is* the MCP server's catalog
and logic; the only moving part is one tiny, generic transport shim. Tools are bound to
**content-addressed compute cells** that a host **verifies (SHA-256) before it executes** them.

This spec tells you how to make one for **any use case**.

---

## Why
Most MCP servers are always-on processes you must host, secure, and trust. A **rapp-static-mcp** is:
- **Static** — everything is files on `raw.githubusercontent` / GitHub Pages. No server, no deploy target, no cost.
- **Content-addressed** — every tool's code is pinned by an 8-byte SHA-256 prefix (`sha8`). The catalog can't drift from the code.
- **Verify-before-exec** — the host fetches the pinned bytes, hashes them, and refuses to run anything whose hash ≠ the pin. Supply-chain integrity by construction.
- **Portable** — one generic `shim.mjs` serves *any* catalog. Zero per-tool logic in the transport.

## Anatomy
```
my-static-mcp/
  manifest.json          # you author this: name + tools[] (each binds a tool → cell.export)
  cells/
    <cell>.mjs           # you author this: pure ES module exporting async (args)=>result
    versions/            # generated: immutable pinned copies  <cell>.<sha8>.mjs
  tools.json             # generated: the CATALOG (tools/list shape + bindings)  ← hosts read this
  registry.json          # generated: provenance (rapp-static-api/1.0, kind: mcp-catalog)
  llms.txt               # generated: agent-readable manifest
# shared, once per repo:
  build.mjs              # manifest + cells  →  tools.json / registry.json / llms.txt / pinned versions
  shim.mjs               # the generic MCP stdio transport (the only thing that runs)
```

## The cell contract
A **cell** is a plain ES module. Each capability is a named `export` — an async function `(args) => result`.
Cells should be **pure and portable** (no host imports beyond Node stdlib, no hidden state):

```js
// cells/convert.mjs
export async function convert({ value, from, to }) { /* ... */ return { result }; }
export async function units() { return { length: [...], mass: [...] }; }
```

## The manifest (you write)
```json
{
  "schema": "rapp-static-api/1.0", "kind": "mcp-catalog",
  "name": "unit-convert",
  "description": "Convert length/mass/temperature. When to use it.",
  "raw_base":   "https://raw.githubusercontent.com/OWNER/REPO/main/examples/unit-convert",
  "pages_base": "https://OWNER.github.io/REPO/examples/unit-convert/tools.json",
  "tools": [
    { "name": "convert", "description": "...", "cell": "convert", "export": "convert",
      "inputSchema": { "type":"object", "properties": { "value":{"type":"number"}, "from":{"type":"string"}, "to":{"type":"string"} }, "required":["value","from","to"] } }
  ]
}
```

## The catalog (generated) — what hosts read
`tools.json` is `tools/list`-shaped **plus a `bindings` map**:
```json
{
  "schema": "rapp-static-mcp/1.0", "name": "unit-convert", "protocolVersion": "2025-06-18",
  "api_base": "https://raw.githubusercontent.com/OWNER/REPO/main/examples/unit-convert",
  "tools":    [ { "name": "convert", "description": "...", "inputSchema": { } } ],
  "bindings": { "convert": { "cell": "convert", "export": "convert",
                             "sha8": "9d26dae84e14", "pin_path": "cells/versions/convert.9d26dae84e14.mjs",
                             "pin_url": "https://raw.githubusercontent.com/.../convert.9d26dae84e14.mjs" } }
}
```

## Verify-before-exec (the transport's whole job)
On every `tools/call`, `shim.mjs`:
1. Looks up the tool's `binding` → `{ pin_path, sha8, export }`.
2. Fetches the bytes at `api_base + '/' + pin_path`.
3. Computes `sha256(bytes).slice(0,12)` and **aborts if it ≠ `sha8`**.
4. Imports the exact verified bytes as a `data:` module (no disk write, no re-fetch) and calls `mod[export](args)`.
5. Returns the result as MCP content with `_meta.verified_sha8`.

The catalog and logic are 100% static and content-addressed; only the transport runs.

## Make one (any use case)
```bash
node new-mcp.mjs weather "current + forecast for a city (static tiles)"
# edit examples/weather/cells/*.mjs and examples/weather/manifest.json
node build.mjs examples/weather        # pins cells, emits the catalog
node shim.mjs --catalog ./examples/weather/tools.json --api ./examples/weather   # run locally
```
Then push; hosts point at your Pages `tools.json`:
```json
{ "mcpServers": { "weather": { "command": "node", "args": ["shim.mjs", "--catalog",
  "https://OWNER.github.io/REPO/examples/weather/tools.json"] } } }
```

## Data-backed vs compute-backed
- **Compute cell** — the tool computes its answer (see `unit-convert`, `text-tools`). Pure & deterministic.
- **Data-backed cell** — the cell `fetch()`es a sibling static JSON/JSONL (e.g. a catalog on `raw.githubusercontent`)
  and searches/filters it. This is exactly how the `localfirsttools` MCP works: a static `index.json` + a thin search cell.

## Discovery (so agents find it)
Ship these at the repo root: `llms.txt`, `AGENTS.md`, `.well-known/ai-plugin.json`, and a `SKILL.md`
any agent can load. See this repo's copies for the canonical shape.

## Conformance
A repo is **rapp-static-mcp/1.0-conformant** if: (a) `manifest.json` uses this schema, (b) every tool binds to a
cell export, (c) `build.mjs` produces a `tools.json` with a `bindings` map pinning each cell by `sha8`, and
(d) it is served by the unmodified generic `shim.mjs` (verify-before-exec). Cells must be pure ES modules.

_MIT · content-addressed · zero-server · welds on `kody-w/rapp-static-apis`._
