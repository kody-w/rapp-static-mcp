#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const templatePath = path.join(here, 'mcp_callback_agent.py.template');
const outputPath = path.join(here, 'mcp_callback_agent.py');
const adapterCommit = '3473eba07450ea6f1c86cf20a08f0c1d9ae63b88';

function sha256(data) {
  return createHash('sha256').update(data).digest('hex');
}

const [template, liveStdio, brainstem] = await Promise.all([
  readFile(templatePath, 'utf8'),
  readFile(path.join(here, 'live-stdio.mjs')),
  readFile(path.join(here, 'brainstem.mjs'))
]);

const generated = template
  .replaceAll('@@ADAPTER_COMMIT@@', adapterCommit)
  .replaceAll('@@LIVE_STDIO_SHA256@@', sha256(liveStdio))
  .replaceAll('@@BRAINSTEM_SHA256@@', sha256(brainstem))
  .replaceAll('@@LIVE_STDIO_B64@@', JSON.stringify(liveStdio.toString('base64')))
  .replaceAll('@@BRAINSTEM_B64@@', JSON.stringify(brainstem.toString('base64')));

if(process.argv.includes('--check')) {
  const current = await readFile(outputPath, 'utf8').catch(() => '');
  if(current !== generated) {
    console.error('mcp_callback_agent.py is stale; run build-callback-agent.mjs');
    process.exit(1);
  }
  console.log('mcp_callback_agent.py matches embedded adapter sources');
} else {
  await writeFile(outputPath, generated);
  console.log(
    `wrote ${path.relative(process.cwd(), outputPath)} `
    + `(live=${sha256(liveStdio).slice(0, 12)}, `
    + `brainstem=${sha256(brainstem).slice(0, 12)})`
  );
}
