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
        let agentLogs = `[FixtureAgent] turn ${turn}`;
        const envelope = {
          response: `reply-${turn}:${parsed.user_input}`,
          session_id: parsed.session_id || `session-${turn}`,
          agent_logs: agentLogs,
          model: 'fixture'
        };
        if(parsed.user_input === 'structured callback') {
          envelope.mcp_callbacks = [{
            schema:'rapp-mcp-callback/1.0',
            target:'scout',
            mode:'sampling',
            message:'Structured Brainstem callback.',
            max_tokens:256
          }];
        }
        if(parsed.user_input === 'multiple callbacks') {
          envelope.mcp_callbacks = [
            {
              target:'scout',
              mode:'sampling',
              message:'First callback.',
              max_tokens:256
            },
            {
              target:'scout',
              mode:'sampling',
              message:'Second callback.',
              max_tokens:256
            }
          ];
        }
        if(parsed.user_input === 'legacy callback') {
          const marker = Buffer.from(JSON.stringify({
            schema:'rapp-mcp-callback/1.0',
            target:'mcp-client',
            mode:'sampling',
            message:'Legacy Brainstem callback.',
            max_tokens:256
          })).toString('base64url');
          envelope.agent_logs += `\n[McpCallback] RAPP_MCP_CALLBACK_V1:${marker}`;
        }
        response.setHeader('Content-Type', 'application/json');
        response.end(JSON.stringify(envelope));
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

function client(base, handlers = {}) {
  const child = spawn(process.execPath, [serverPath], {
    env: { ...process.env, RAPP_BRAINSTEM_URL: base },
    stdio: ['pipe', 'pipe', 'pipe']
  });
  const lines = createInterface({ input: child.stdout, crlfDelay: Infinity });
  const pending = new Map();
  const serverRequests = [];
  const messages = [];
  lines.on('line', line => {
    const message = JSON.parse(line);
    messages.push(message);
    if(message.method) {
      serverRequests.push(message);
      const handler = handlers[message.method];
      Promise.resolve()
        .then(() => {
          if(!handler) throw new Error(`unsupported server request: ${message.method}`);
          return handler(message.params);
        })
        .then(result => {
          child.stdin.write(`${JSON.stringify({
            jsonrpc:'2.0',
            id:message.id,
            result
          })}\n`);
        })
        .catch(error => {
          child.stdin.write(`${JSON.stringify({
            jsonrpc:'2.0',
            id:message.id,
            error:{code:-32000, message:String(error.message || error)}
          })}\n`);
        });
      return;
    }
    const resolve = pending.get(message.id);
    if(resolve) {
      pending.delete(message.id);
      resolve(message);
    }
  });
  let id = 0;
  return {
    child,
    messages,
    serverRequests,
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

test('Brainstem requests a Scout response through MCP sampling on the same stdio session', async () => {
  const fake = await fixture();
  const mcp = client(fake.base, {
    'sampling/createMessage': params => {
      assert.equal(params.messages[0].content.text, 'reply-1:call Scout back');
      assert.equal(params.maxTokens, 512);
      return {
        role:'assistant',
        content:{type:'text', text:'Scout received the Brainstem callback.'},
        model:'scout-fixture',
        stopReason:'endTurn'
      };
    }
  });
  try {
    await mcp.call('initialize', {
      protocolVersion:'2025-06-18',
      capabilities:{sampling:{}}
    });
    const callback = await mcp.call('tools/call', {
      name:'brainstem_chat',
      arguments:{
        user_input:'call Scout back',
        callback_to_scout:true,
        callback_max_tokens:512
      }
    });

    assert.equal(callback.result.isError, false);
    assert.equal(callback.result.structuredContent.response, 'reply-1:call Scout back');
    assert.equal(callback.result.structuredContent.scout_callback.status, 'ok');
    assert.equal(
      callback.result.structuredContent.scout_callback.response.text,
      'Scout received the Brainstem callback.'
    );
    assert.equal(mcp.serverRequests.length, 1);
    assert.equal(mcp.serverRequests[0].method, 'sampling/createMessage');
  } finally {
    await mcp.close();
    await fake.close();
  }
});

test('Brainstem accepts the Copilot runtime sampling execution wrapper', async () => {
  const fake = await fixture();
  const mcp = client(fake.base, {
    'sampling/createMessage': () => ({
      action:'success',
      result:{
        role:'assistant',
        content:{type:'text', text:'Wrapped Scout callback.'},
        model:'scout-fixture',
        stopReason:'endTurn'
      }
    })
  });
  try {
    await mcp.call('initialize', {
      protocolVersion:'2025-06-18',
      capabilities:{sampling:{}}
    });
    const callback = await mcp.call('tools/call', {
      name:'brainstem_chat',
      arguments:{user_input:'wrapped callback', callback_to_scout:true}
    });
    assert.equal(callback.result.isError, false);
    assert.equal(
      callback.result.structuredContent.scout_callback.response.text,
      'Wrapped Scout callback.'
    );
  } finally {
    await mcp.close();
    await fake.close();
  }
});

test('Brainstem can initiate a structured Scout callback without a caller flag', async () => {
  const fake = await fixture();
  const mcp = client(fake.base, {
    'sampling/createMessage': params => ({
      role:'assistant',
      content:{type:'text', text:`Scout saw: ${params.messages[0].content.text}`},
      model:'scout-fixture',
      stopReason:'endTurn'
    })
  });
  try {
    await mcp.call('initialize', {
      protocolVersion:'2025-06-18',
      capabilities:{sampling:{}}
    });
    const callback = await mcp.call('tools/call', {
      name:'brainstem_chat',
      arguments:{user_input:'structured callback'}
    });
    assert.equal(callback.result.isError, false);
    assert.equal(callback.result.structuredContent.mcp_callbacks.length, 1);
    assert.equal(
      callback.result.structuredContent.scout_callback.response.text,
      'Scout saw: Structured Brainstem callback.'
    );
  } finally {
    await mcp.close();
    await fake.close();
  }
});

test('older Brainstems can initiate callbacks through an agent-log marker', async () => {
  const fake = await fixture();
  const mcp = client(fake.base, {
    'sampling/createMessage': params => ({
      role:'assistant',
      content:{type:'text', text:`Scout saw: ${params.messages[0].content.text}`},
      model:'scout-fixture',
      stopReason:'endTurn'
    })
  });
  try {
    await mcp.call('initialize', {
      protocolVersion:'2025-06-18',
      capabilities:{sampling:{}}
    });
    const callback = await mcp.call('tools/call', {
      name:'brainstem_chat',
      arguments:{user_input:'legacy callback'}
    });
    assert.equal(callback.result.isError, false);
    assert.equal(
      callback.result.structuredContent.scout_callback.response.text,
      'Scout saw: Legacy Brainstem callback.'
    );
    assert.doesNotMatch(
      callback.result.structuredContent.agent_logs,
      /RAPP_MCP_CALLBACK_V1:/
    );
  } finally {
    await mcp.close();
    await fake.close();
  }
});

test('more than one Brainstem callback is rejected before sampling', async () => {
  const fake = await fixture();
  const mcp = client(fake.base, {
    'sampling/createMessage': () => {
      throw new Error('sampling must not run');
    }
  });
  try {
    await mcp.call('initialize', {
      protocolVersion:'2025-06-18',
      capabilities:{sampling:{}}
    });
    const callback = await mcp.call('tools/call', {
      name:'brainstem_chat',
      arguments:{user_input:'multiple callbacks'}
    });
    assert.equal(callback.result.isError, true);
    assert.match(
      callback.result.structuredContent.error,
      /more than one MCP callback/
    );
    assert.equal(mcp.serverRequests.length, 0);
  } finally {
    await mcp.close();
    await fake.close();
  }
});

test('callback fails loudly when the MCP client does not advertise sampling', async () => {
  const fake = await fixture();
  const mcp = client(fake.base);
  try {
    await mcp.call('initialize', {
      protocolVersion:'2025-06-18',
      capabilities:{}
    });
    const callback = await mcp.call('tools/call', {
      name:'brainstem_chat',
      arguments:{user_input:'callback anyway', callback_to_scout:true}
    });
    assert.equal(callback.result.isError, true);
    assert.equal(callback.result.structuredContent.response, 'reply-1:callback anyway');
    assert.equal(
      callback.result.structuredContent.scout_callback.code,
      'sampling-not-supported'
    );
    assert.equal(mcp.serverRequests.length, 0);
  } finally {
    await mcp.close();
    await fake.close();
  }
});

test('closing the MCP input cancels an outstanding Scout callback immediately', async () => {
  const fake = await fixture();
  const mcp = client(fake.base, {
    'sampling/createMessage': () => new Promise(() => {})
  });
  try {
    await mcp.call('initialize', {
      protocolVersion:'2025-06-18',
      capabilities:{sampling:{}}
    });
    const pending = mcp.call('tools/call', {
      name:'brainstem_chat',
      arguments:{user_input:'close during callback', callback_to_scout:true}
    });
    for(let attempt = 0; attempt < 100 && mcp.serverRequests.length === 0; attempt++) {
      await new Promise(resolve => setTimeout(resolve, 5));
    }
    assert.equal(mcp.serverRequests.length, 1);
    mcp.child.stdin.end();
    const callback = await pending;
    assert.equal(callback.result.isError, true);
    assert.equal(
      callback.result.structuredContent.scout_callback.code,
      'client-connection-closed'
    );
    await new Promise(resolve => mcp.child.once('exit', resolve));
  } finally {
    if(mcp.child.exitCode === null) mcp.child.stdin.end();
    await fake.close();
  }
});

test('queued callbacks do not start after the MCP input closes', async () => {
  const fake = await fixture();
  const mcp = client(fake.base, {
    'sampling/createMessage': () => new Promise(() => {})
  });
  try {
    await mcp.call('initialize', {
      protocolVersion:'2025-06-18',
      capabilities:{sampling:{}}
    });
    const first = mcp.call('tools/call', {
      name:'brainstem_chat',
      arguments:{user_input:'first queued callback', callback_to_scout:true}
    });
    const second = mcp.call('tools/call', {
      name:'brainstem_chat',
      arguments:{user_input:'second queued callback', callback_to_scout:true}
    });
    for(let attempt = 0; attempt < 100 && mcp.serverRequests.length === 0; attempt++) {
      await new Promise(resolve => setTimeout(resolve, 5));
    }
    assert.equal(mcp.serverRequests.length, 1);
    mcp.child.stdin.end();
    const [firstResult, secondResult] = await Promise.all([first, second]);
    assert.equal(firstResult.result.structuredContent.scout_callback.code, 'client-connection-closed');
    assert.equal(secondResult.result.structuredContent.scout_callback.code, 'client-connection-closed');
    assert.equal(mcp.serverRequests.length, 1);
    await new Promise(resolve => mcp.child.once('exit', resolve));
  } finally {
    if(mcp.child.exitCode === null) mcp.child.stdin.end();
    await fake.close();
  }
});

test('late or unknown JSON-RPC responses are ignored', async () => {
  const fake = await fixture();
  const mcp = client(fake.base);
  try {
    await mcp.call('initialize', {
      protocolVersion:'2025-06-18',
      capabilities:{}
    });
    mcp.child.stdin.write(`${JSON.stringify({
      jsonrpc:'2.0',
      id:'late-or-unknown',
      result:{}
    })}\n`);
    const ping = await mcp.call('ping', {});
    assert.deepEqual(ping.result, {});
    assert.equal(
      mcp.messages.some(message => message.id === 'late-or-unknown'),
      false
    );
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
