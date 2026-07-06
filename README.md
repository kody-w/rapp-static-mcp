# rapp-static-mcp

**Make an MCP server for any use case — with no server.**

A `rapp-static-mcp` is a Git repo whose files *are* the MCP: tools bind to **content-addressed
compute cells**, and a host **verifies each cell's SHA-256 before it executes it** (verify-before-exec).
Everything is static (`raw.githubusercontent` / GitHub Pages). The only moving part is one tiny, generic
transport shim that carries **zero per-tool logic**.

> Read the [**SPEC**](SPEC.md). Welds on [`kody-w/rapp-static-apis`](https://github.com/kody-w/rapp-static-apis)'s `rapp-static-mcp/1.0` profile.

## 60-second quickstart
```bash
# 1. scaffold a new MCP for your use case
node new-mcp.mjs my-thing "what it does / when to use it"

# 2. write pure async functions in examples/my-thing/cells/*.mjs
#    declare tools (name → cell.export) in examples/my-thing/manifest.json

# 3. build: pins each cell by sha8, emits the static catalog
node build.mjs examples/my-thing

# 4. run it as a stdio MCP server (locally or from Pages)
node shim.mjs --catalog ./examples/my-thing/tools.json --api ./examples/my-thing
```

Point any MCP host (Claude Desktop, Copilot CLI, Cursor…) at it:
```json
{ "mcpServers": { "my-thing": { "command": "node",
  "args": ["shim.mjs", "--catalog", "https://kody-w.github.io/rapp-static-mcp/examples/my-thing/tools.json"] } } }
```

## What's here
| file | role |
|---|---|
| [`SPEC.md`](SPEC.md) | the `rapp-static-mcp/1.0` spec — how to make one for any use case |
| [`shim.mjs`](shim.mjs) | the generic MCP transport (verify-before-exec). Serves *any* catalog. |
| [`build.mjs`](build.mjs) | manifest + cells → `tools.json` / `registry.json` / `llms.txt` + pinned versions |
| [`new-mcp.mjs`](new-mcp.mjs) | scaffolder: spin up a new MCP from the template |
| [`template/`](template/) | the starter you copy for a new use case |
| [`examples/unit-convert/`](examples/unit-convert/) | worked example — pure compute (length/mass/temp) |
| [`examples/text-tools/`](examples/text-tools/) | worked example — slugify / wordcount / sha256 |
| [`examples/brainstem/`](examples/brainstem/) | **a browser-tab MCP** — Pyodide runs raw-hosted **Python** agents with verify-before-exec; clients connect over WebRTC via a **QR code** |
| [`SKILL.md`](SKILL.md) · [`AGENTS.md`](AGENTS.md) | drop-in skill + agent write-path |

## Runtimes
A `rapp-static-mcp` catalog can be served by:
- **stdio shim** (`shim.mjs`) — for Claude Desktop / Copilot CLI / Cursor (the `unit-convert` & `text-tools` examples).
- **a browser tab** ([`examples/brainstem/host.html`](examples/brainstem/host.html)) — boots Pyodide, pulls the
  brainstem (agents/memory/twin) from GitHub raw, runs the **Python** agents in-tab with verify-before-exec, and
  bridges MCP over **WebRTC**; a phone connects by **scanning a QR**. *While the tab is open, the MCP is open — no server.*

## Two kinds of cell
- **Compute** — the tool computes its answer (deterministic, pure). See the examples.
- **Data-backed** — the cell `fetch()`es a sibling static JSON/JSONL and searches it (e.g. a catalog on
  `raw.githubusercontent`). This is how the [`localfirsttools`](https://kody-w.github.io/localFirstTools/landgrab/hq.html)
  MCP exposes 2885 tools from one static `index.json`.

## Why it's different
No process to host. No secrets. The catalog can't drift from the code (content-addressed). Any host that
trusts the hash can run it safely. Fork it, add a folder, and you have a new MCP.

_MIT · zero-server · owned by [@kody-w](https://github.com/kody-w)._
