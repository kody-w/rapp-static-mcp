# my-static-mcp (template)

Copy this folder to `examples/<your-slug>/`, then:

1. Edit `manifest.json` — set `name`, `description`, `raw_base`/`pages_base`, and declare your `tools`
   (each binds an MCP tool `name` to a `cell` + one of its `export`s).
2. Write your logic in `cells/<cell>.mjs` as pure async functions `(args) => result`.
3. Build:  `node ../../build.mjs .`  → emits `tools.json`, `registry.json`, `llms.txt`, and pinned `cells/versions/*`.
4. Run:    `node ../../shim.mjs --catalog ./tools.json --api .`  (or point a host at your Pages `tools.json`).

That's it — a zero-server, content-addressed MCP for your use case.
