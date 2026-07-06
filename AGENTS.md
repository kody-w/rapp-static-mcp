# AGENTS.md — add a static MCP (write path)

You (an AI agent) can add a whole new MCP by writing one folder. Follow the pattern; no server, no deploy target.

## Read path
- `SPEC.md` — the `rapp-static-mcp/1.0` spec.
- `examples/*/manifest.json` + `cells/*.mjs` — working donors to weld from.
- Each MCP's `tools.json` is the machine catalog a host reads.

## Write path (one folder)
1. `node new-mcp.mjs <slug> "when to use it"` → creates `examples/<slug>/`.
2. Write pure async functions in `examples/<slug>/cells/<cell>.mjs` — shape `(args) => result`, Node stdlib only.
3. Declare tools in `examples/<slug>/manifest.json` (each: `name`, `description`, `cell`, `export`, `inputSchema`).
4. `node build.mjs examples/<slug>` — pins cells by sha8, emits `tools.json` / `registry.json` / `llms.txt`.
5. Verify: `node shim.mjs --catalog ./examples/<slug>/tools.json --api ./examples/<slug>` then send a
   `tools/call` and confirm `_meta.verified_sha8` is present (verify-before-exec passed).
6. Commit. Hosts point at the Pages `tools.json`.

## Rules
- **Weld, don't reinvent** — start from an example cell; combine primitives into something new.
- Cells are **pure & content-addressed** — same input → same output, no hidden state, no host coupling.
- Never hand-edit `tools.json`/`registry.json`/`cells/versions/*` — they're generated. Change the source + rebuild.
- Prefer **data-backed** cells (fetch a sibling static JSON) for catalog/search MCPs; **compute** cells for transforms.
