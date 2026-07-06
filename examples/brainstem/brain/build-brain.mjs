#!/usr/bin/env node
/**
 * build-brain — the RAR (RAPP Agent Registry) build step for the static brainstem.
 * Reads brain/agents.json + content-addresses each Python agent (sha8), writes brain/registry.json.
 *   node brain/build-brain.mjs        (run from examples/brainstem/)
 * The registry is what the Pyodide host (host.html) and any MCP host dispatch to — verify-before-exec.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const RAW_BASE = 'https://raw.githubusercontent.com/kody-w/rapp-static-mcp/main/examples/brainstem';
const cfg = JSON.parse(readFileSync(join(here, 'agents.json'), 'utf8'));

const agents = cfg.agents.map(a => {
  const bytes = readFileSync(join(here, 'agents', a.file));
  const sha8 = createHash('sha256').update(bytes).digest('hex').slice(0, 12);
  return { id: a.id, name: a.name, when_to_use: a.when_to_use, entry: a.entry || 'perform',
    lang: 'python', module_path: `brain/agents/${a.file}`, sha8,
    module_url: `${RAW_BASE}/brain/agents/${a.file}` };
});
writeFileSync(join(here, 'registry.json'), JSON.stringify({
  schema: 'rar/1.0', name: 'static-brainstem', raw_base: RAW_BASE, runtime: 'pyodide',
  generated: new Date().toISOString(), count: agents.length, agents }, null, 2));
console.log(`RAR built: ${agents.length} python agents pinned -> brain/registry.json`);
