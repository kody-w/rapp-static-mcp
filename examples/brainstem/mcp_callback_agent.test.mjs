import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  mkdtemp,
  mkdir,
  readFile,
  realpath,
  symlink,
  writeFile
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const agentPath = path.join(here, 'mcp_callback_agent.py');
const livePath = path.join(here, 'live-stdio.mjs');
const brainstemPath = path.join(here, 'brainstem.mjs');

function sha256(data) {
  return createHash('sha256').update(data).digest('hex');
}

async function runAgent(home, nodePath = process.execPath) {
  const script = `
import importlib.util, json
spec = importlib.util.spec_from_file_location("callback_agent_test", ${JSON.stringify(agentPath)})
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
agent = module.McpCallbackAgent()
print(json.dumps({
    "status": json.loads(agent.perform(operation="status")),
    "callback": agent.perform(
        operation="callback",
        message="Continue this in Scout.",
        target="scout",
        max_tokens=256,
    ),
}))
`;
  const child = spawn('python3', ['-c', script], {
    env: {
      ...process.env,
      HOME: home,
      RAPP_MCP_NODE: nodePath,
      PYTHONDONTWRITEBYTECODE: '1'
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', chunk => { stdout += chunk; });
  child.stderr.on('data', chunk => { stderr += chunk; });
  const code = await new Promise(resolve => child.once('exit', resolve));
  assert.equal(code, 0, stderr);
  return JSON.parse(stdout);
}

test('drop-in agent bootstraps the adapter and Scout config on first import', async () => {
  const home = await mkdtemp(path.join(tmpdir(), 'rapp-callback-agent-'));
  const scoutDir = path.join(home, '.scout');
  await mkdir(scoutDir, { recursive:true });
  await writeFile(
    path.join(scoutDir, 'm-mcp-servers.json'),
    JSON.stringify({
      servers:{
        filesystem:{builtin:true, tools:['read_file']}
      }
    }, null, 2)
  );

  const result = await runAgent(home);
  assert.equal(result.status.status, 'ok');
  assert.equal(result.status.scout_configured, true);

  const installedRoot = path.join(
    home,
    '.copilot',
    'mcp-servers',
    'rapp-brainstem'
  );
  assert.equal(
    sha256(await readFile(path.join(installedRoot, 'live-stdio.mjs'))),
    sha256(await readFile(livePath))
  );
  assert.equal(
    sha256(await readFile(path.join(installedRoot, 'brainstem.mjs'))),
    sha256(await readFile(brainstemPath))
  );

  const launcher = await readFile(
    path.join(home, '.copilot', 'bin', 'rapp-brainstem-mcp'),
    'utf8'
  );
  assert.match(launcher, /live-stdio\.mjs/);
  assert.match(launcher, new RegExp(process.execPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));

  const scout = JSON.parse(
    await readFile(path.join(scoutDir, 'm-mcp-servers.json'), 'utf8')
  );
  assert.deepEqual(scout.servers.filesystem, {
    builtin:true,
    tools:['read_file']
  });
  assert.equal(scout.servers.rapp_brainstem.builtin, false);
  assert.equal(
    scout.servers.rapp_brainstem.config.command,
    path.join(
      await realpath(home),
      '.copilot',
      'bin',
      'rapp-brainstem-mcp'
    )
  );

  const marker = result.callback.match(
    /RAPP_MCP_CALLBACK_V1:([A-Za-z0-9_-]+={0,2})/
  );
  assert.ok(marker);
  const callback = JSON.parse(
    Buffer.from(marker[1], 'base64url').toString('utf8')
  );
  assert.equal(callback.message, 'Continue this in Scout.');
  assert.equal(callback.target, 'scout');
  assert.equal(callback.max_tokens, 256);
});

test('first-load bootstrap preserves a backup before replacing drifted adapter bytes', async () => {
  const home = await mkdtemp(path.join(tmpdir(), 'rapp-callback-agent-'));
  await runAgent(home);
  const installed = path.join(
    home,
    '.copilot',
    'mcp-servers',
    'rapp-brainstem',
    'live-stdio.mjs'
  );
  await writeFile(installed, 'local drift');

  const result = await runAgent(home);
  const liveRecord = result.status.files.find(
    item => item.path.endsWith('live-stdio.mjs')
  );
  assert.equal(liveRecord.status, 'replaced');
  assert.equal(await readFile(liveRecord.backup, 'utf8'), 'local drift');
  assert.equal(
    sha256(await readFile(installed)),
    sha256(await readFile(livePath))
  );
});

test('launcher preserves a stable Node symlink instead of its versioned target', async () => {
  const home = await mkdtemp(path.join(tmpdir(), 'rapp-callback-agent-'));
  const stableNode = path.join(home, 'stable-node');
  await symlink(process.execPath, stableNode);

  const result = await runAgent(home, stableNode);
  assert.equal(result.status.node, stableNode);
  const launcher = await readFile(
    path.join(home, '.copilot', 'bin', 'rapp-brainstem-mcp'),
    'utf8'
  );
  assert.match(
    launcher,
    new RegExp(stableNode.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  );
});
