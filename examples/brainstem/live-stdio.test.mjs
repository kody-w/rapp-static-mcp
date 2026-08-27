import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { createInterface } from 'node:readline';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const serverPath = fileURLToPath(new URL('./live-stdio.mjs', import.meta.url));

async function fixture() {
  const requests = [];
  let turn = 0;
  const http = createServer((request, response) => {
    if(request.url === '/health') {
      response.setHeader('Content-Type', 'application/json');
      response.end(JSON.stringify({
        status: 'ok',
        version: 'test',
        model: 'fixture',
        agents: ['FixtureAgent']
      }));
      return;
    }
    if(request.url === '/chat' && request.method === 'POST') {
      let body = '';
      request.setEncoding('utf8');
      request.on('data', chunk => { body += chunk; });
      request.on('end', () => {
        const parsed = JSON.parse(body);
        requests.push(parsed);
        if(parsed.user_input === 'fail') {
          response.statusCode = 500;
          response.setHeader('Content-Type', 'application/json');
          response.end(JSON.stringify({ error: 'fixture failure' }));
          return;
        }
        turn++;
        response.setHeader('Content-Type', 'application/json');
        response.end(JSON.stringify({
          response: `reply-${turn}:${parsed.user_input}`,
          session_id: parsed.session_id || `session-${turn}`,
          agent_logs: `[FixtureAgent] turn ${turn}`,
          model: 'fixture'
        }));
      });
      return;
    }
    response.statusCode = 404;
    response.end();
  });

  await new Promise(resolve => http.listen(0, '127.0.0.1', resolve));
  const address = http.address();
  return {
    base: `http://127.0.0.1:${address.port}`,
    requests,
    close: () => new Promise(resolve => http.close(resolve))
  };
}

function client(base) {
  const child = spawn(process.execPath, [serverPath], {
    env: { ...process.env, RAPP_BRAINSTEM_URL: base },
    stdio: ['pipe', 'pipe', 'pipe']
  });
  const lines = createInterface({ input: child.stdout, crlfDelay: Infinity });
  const pending = new Map();
  lines.on('line', line => {
    const message = JSON.parse(line);
    const resolve = pending.get(message.id);
    if(resolve) {
      pending.delete(message.id);
      resolve(message);
    }
  });
  let id = 0;
  return {
    child,
    call(method, params) {
      const requestId = ++id;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(requestId);
          reject(new Error(`timeout waiting for ${method}`));
        }, 5000);
        pending.set(requestId, message => {
          clearTimeout(timer);
          resolve(message);
        });
        child.stdin.write(`${JSON.stringify({ jsonrpc:'2.0', id:requestId, method, params })}\n`);
      });
    },
    close() {
      child.stdin.end();
      return new Promise(resolve => child.once('exit', resolve));
    }
  };
}

test('stdio MCP exposes status and preserves Brainstem chat continuity', async () => {
  const fake = await fixture();
  const mcp = client(fake.base);
  try {
    const initialized = await mcp.call('initialize', { protocolVersion:'2025-06-18' });
    assert.equal(initialized.result.serverInfo.name, 'rapp-brainstem');

    const listed = await mcp.call('tools/list', {});
    assert.deepEqual(
      listed.result.tools.map(tool => tool.name),
      ['brainstem_status', 'brainstem_chat', 'brainstem_new_session']
    );

    const status = await mcp.call('tools/call', {
      name:'brainstem_status',
      arguments:{}
    });
    assert.equal(status.result.structuredContent.status, 'ok');

    const first = await mcp.call('tools/call', {
      name:'brainstem_chat',
      arguments:{user_input:'one'}
    });
    assert.equal(first.result.structuredContent.response, 'reply-1:one');
    assert.equal(first.result.structuredContent.history_messages, 2);

    const second = await mcp.call('tools/call', {
      name:'brainstem_chat',
      arguments:{user_input:'two'}
    });
    assert.equal(second.result.structuredContent.session_id, 'session-1');
    assert.equal(second.result.structuredContent.history_messages, 4);
    assert.equal(fake.requests[1].session_id, 'session-1');
    assert.deepEqual(fake.requests[1].conversation_history, [
      {role:'user', content:'one'},
      {role:'assistant', content:'reply-1:one'}
    ]);

    await mcp.call('tools/call', {
      name:'brainstem_new_session',
      arguments:{}
    });
    await mcp.call('tools/call', {
      name:'brainstem_chat',
      arguments:{user_input:'three'}
    });
    assert.equal('session_id' in fake.requests[2], false);
    assert.deepEqual(fake.requests[2].conversation_history, []);
  } finally {
    await mcp.close();
    await fake.close();
  }
});

test('stdio MCP rejects unknown tools and returns Brainstem failures as tool errors', async () => {
  const fake = await fixture();
  const mcp = client(fake.base);
  try {
    const unknown = await mcp.call('tools/call', {
      name:'missing',
      arguments:{}
    });
    assert.equal(unknown.error.code, -32602);

    const failed = await mcp.call('tools/call', {
      name:'brainstem_chat',
      arguments:{user_input:'fail'}
    });
    assert.equal(failed.result.isError, true);
    assert.equal(failed.result.structuredContent.error, 'fixture failure');
  } finally {
    await mcp.close();
    await fake.close();
  }
});
