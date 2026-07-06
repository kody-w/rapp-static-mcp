#!/usr/bin/env node
/**
 * rapp-static-mcp — scaffolder.
 * Spin up a new static MCP for any use case from the template.
 *   node new-mcp.mjs <slug> ["one-line description"]
 * Creates examples/<slug>/ (manifest.json + cells/hello.mjs + README), then tells you to build.
 */
import { readFileSync, writeFileSync, mkdirSync, cpSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const slug = (process.argv[2] || '').trim();
const desc = process.argv[3] || 'TODO: one line on what this MCP does and when to use it.';
if (!/^[a-z][a-z0-9-]*$/.test(slug)) {
  console.error('usage: node new-mcp.mjs <slug:lowercase-kebab> ["description"]'); process.exit(1);
}
const dest = join('examples', slug);
if (existsSync(dest)) { console.error(`examples/${slug} already exists`); process.exit(1); }

cpSync('template', dest, { recursive: true });
const mf = JSON.parse(readFileSync(join(dest, 'manifest.json'), 'utf8'));
mf.name = slug; mf.description = desc;
mf.raw_base = `https://raw.githubusercontent.com/kody-w/rapp-static-mcp/main/examples/${slug}`;
mf.pages_base = `https://kody-w.github.io/rapp-static-mcp/examples/${slug}/tools.json`;
writeFileSync(join(dest, 'manifest.json'), JSON.stringify(mf, null, 2) + '\n');

console.log(`created examples/${slug}/`);
console.log(`  1. write your logic in examples/${slug}/cells/*.mjs`);
console.log(`  2. declare tools in examples/${slug}/manifest.json`);
console.log(`  3. build:  node build.mjs examples/${slug}`);
console.log(`  4. run:    node shim.mjs --catalog ./examples/${slug}/tools.json --api ./examples/${slug}`);
