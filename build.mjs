#!/usr/bin/env node
/**
 * rapp-static-mcp — build step.
 * Reads a manifest.json + its cells/, content-addresses each cell (sha8), writes an immutable
 * pinned copy, and emits the static catalog the shim serves: tools.json + registry.json + llms.txt.
 *
 *   node build.mjs [dir]     # dir contains manifest.json and cells/  (default: cwd)
 *
 * A "cell" is a plain ES module (cells/<name>.mjs) exporting async functions (args) => result.
 * A "tool" (in manifest.json) binds an MCP tool name to a cell + one of its exports.
 * The catalog is 100% static + content-addressed; only shim.mjs (the transport) ever runs.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

const dir = process.argv[2] || '.';
const M = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'));
if (!Array.isArray(M.tools) || !M.tools.length) { console.error('manifest.json has no tools'); process.exit(1); }
const rawBase = (M.raw_base || '').replace(/\/+$/, '');
const now = new Date().toISOString();

mkdirSync(join(dir, 'cells', 'versions'), { recursive: true });
const cells = {};                                  // cell -> { sha8, pin_path }
for (const t of M.tools) {
  if (cells[t.cell]) continue;
  const bytes = readFileSync(join(dir, 'cells', t.cell + '.mjs'));
  const sha8 = createHash('sha256').update(bytes).digest('hex').slice(0, 12);
  const pin_path = `cells/versions/${t.cell}.${sha8}.mjs`;
  writeFileSync(join(dir, pin_path), bytes);        // immutable pinned artifact
  cells[t.cell] = { sha8, pin_path };
}

const tools = M.tools.map(t => ({ name: t.name, description: t.description,
  inputSchema: t.inputSchema || { type: 'object', properties: {} } }));
const bindings = {};
for (const t of M.tools) { const c = cells[t.cell];
  bindings[t.name] = { cell: t.cell, export: t.export, sha8: c.sha8, pin_path: c.pin_path,
    pin_url: rawBase ? rawBase + '/' + c.pin_path : c.pin_path }; }

const catalog = { schema: 'rapp-static-mcp/1.0', name: M.name, description: M.description || '',
  generated: now, protocolVersion: '2025-06-18', api_base: M.api_base || rawBase || '.',
  raw_base: rawBase, pages_base: M.pages_base || '', summary: { tools: tools.length, cells: Object.keys(cells).length },
  tools, bindings };
writeFileSync(join(dir, 'tools.json'), JSON.stringify(catalog, null, 2));

writeFileSync(join(dir, 'registry.json'), JSON.stringify({ schema: 'rapp-static-api/1.0', name: M.name,
  kind: 'mcp-catalog', generated: now, raw_base: rawBase, pages_base: M.pages_base || '', protocolVersion: '2025-06-18',
  summary: catalog.summary,
  entries: M.tools.map(t => ({ name: t.name, description: t.description, cell: t.cell, export: t.export,
    sha8: cells[t.cell].sha8, pin_path: cells[t.cell].pin_path })) }, null, 2));

writeFileSync(join(dir, 'llms.txt'),
`# ${M.name}\n> ${M.description || 'A rapp-static-mcp: a static, content-addressed MCP server.'}\n\n` +
`A **rapp-static-mcp/1.0** catalog — the repo IS the MCP. Each tool binds to a content-addressed compute\n` +
`cell; a host verifies the cell's sha8 before executing it (verify-before-exec). Only the transport shim runs.\n\n` +
`## Run it\n\`\`\`json\n{ "command": "node", "args": ["shim.mjs", "--catalog", "${M.pages_base || 'tools.json'}"] }\n\`\`\`\n\n` +
`## Tools\n${M.tools.map(t => `- \`${t.name}\` — ${t.description}`).join('\n')}\n`);

console.log(`built ${M.name}: ${tools.length} tools, ${Object.keys(cells).length} cell(s) -> tools.json, registry.json, llms.txt`);
