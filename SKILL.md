---
name: rapp-static-mcp
description: >
  Build a working MCP server for ANY use case with NO server — a "static MCP" whose repo IS the
  catalog. USE WHEN the user wants to expose a capability/tool/dataset to AI assistants as an MCP,
  wants an MCP without hosting/running a backend, wants to turn a static JSON/JSONL dataset or a
  pure function into callable MCP tools, or asks "how do I make an MCP for X". Tools bind to
  content-addressed compute cells that are SHA-256-verified before execution (verify-before-exec).
license: MIT
metadata:
  spec: https://raw.githubusercontent.com/kody-w/rapp-static-mcp/main/SPEC.md
  profile: rapp-static-mcp/1.0
---

# Build a static MCP for any use case

A **rapp-static-mcp** is a Git repo, not a running service: `tools.json` (the catalog) + `cells/*.mjs`
(the logic, pinned by `sha8`) + one generic `shim.mjs` (the only thing that runs). A host verifies each
cell's hash before executing it. Zero server, zero secrets, can't drift from its code.

## When to use
- The user wants to give an AI assistant a new tool/capability but doesn't want to host an MCP server.
- They have a **static dataset** (JSON/JSONL, e.g. on `raw.githubusercontent`) to expose as searchable tools.
- They have a **pure transform** (convert, hash, format, compute) to expose as tools.
- They ask how to make/ship/spec an MCP cheaply and safely.

## The recipe
1. **Scaffold:** `node new-mcp.mjs <slug> "when to use it"` → creates `examples/<slug>/`.
2. **Write cells** in `examples/<slug>/cells/<cell>.mjs` — pure async ES-module exports `(args) => result`, Node stdlib only.
   - *Compute cell*: compute the answer directly (deterministic).
   - *Data-backed cell*: `fetch()` a sibling static JSON/JSONL and search/filter it.
3. **Declare tools** in `examples/<slug>/manifest.json`: each `{ name, description, cell, export, inputSchema }`.
4. **Build:** `node build.mjs examples/<slug>` → pins cells by `sha8`, emits `tools.json` / `registry.json` / `llms.txt`.
5. **Verify:** `node shim.mjs --catalog ./examples/<slug>/tools.json --api ./examples/<slug>`, then send a
   `tools/call`; confirm the reply carries `_meta.verified_sha8` (verify-before-exec passed).
6. **Ship:** commit; hosts point at the Pages `tools.json`.

## Minimal cell + manifest
```js
// cells/greet.mjs
export async function greet({ name = "world" }) { return { message: `hi, ${name}` }; }
```
```json
// manifest.json  (tools[] entry)
{ "name": "greet", "description": "Greet someone.", "cell": "greet", "export": "greet",
  "inputSchema": { "type":"object", "properties": { "name": {"type":"string"} } } }
```

## Register the result with any host
```json
{ "mcpServers": { "<slug>": { "command": "node",
  "args": ["shim.mjs", "--catalog", "https://<owner>.github.io/<repo>/examples/<slug>/tools.json"] } } }
```

## Rules
- Cells are **pure & content-addressed** — same input → same output, no hidden state, no host coupling.
- Never hand-edit generated files (`tools.json`, `registry.json`, `cells/versions/*`) — change the source and rebuild.
- **Weld, don't reinvent** — start from `examples/unit-convert` or `examples/text-tools`.
- Full details: **SPEC.md** (`rapp-static-mcp/1.0`).
