#!/usr/bin/env node
// Expose a running RAPP Brainstem as a standard stdio MCP server.
// This adapter never modifies the Brainstem. It calls only /health and /chat.

import { createInterface } from 'node:readline';
import { createLiveBrainstem } from './brainstem.mjs';

const PROTOCOL_VERSION = '2025-06-18';
const SERVER_VERSION = '1.0.0';
const base = normalizeBase(process.env.RAPP_BRAINSTEM_URL || 'http://localhost:7071');
const secret = process.env.RAPP_BRAINSTEM_SECRET || '';
const brainstem = createLiveBrainstem({ base, secret });

let sessionId = null;
let conversationHistory = [];

const tools = [
  {
    name: 'brainstem_status',
    title: 'RAPP Brainstem Status',
    description: 'Read the Brainstem health, version, model, authentication state, and loaded agents.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  },
  {
    name: 'brainstem_chat',
    title: 'Chat with RAPP Brainstem',
    description: 'Send plain-English user_input through the Brainstem /chat tool-calling loop. The Brainstem may invoke any loaded agent, including agents with side effects. Session and conversation history continue automatically inside this MCP process unless new_session is true.',
    inputSchema: {
      type: 'object',
      properties: {
        user_input: { type: 'string', description: 'The user request to send to the Brainstem.' },
        session_id: { type: 'string', description: 'Optional explicit Brainstem session ID.' },
        conversation_history: {
          type: 'array',
          description: 'Optional explicit history. Omit to use this MCP process history.',
          items: {
            type: 'object',
            properties: {
              role: { type: 'string', enum: ['user', 'assistant', 'tool'] },
              content: { type: 'string' }
            },
            required: ['role', 'content'],
            additionalProperties: false
          }
        },
        idempotency_key: { type: 'string', description: 'Optional rapp/1 retry de-duplication key.' },
        new_session: { type: 'boolean', description: 'Reset MCP-held session and history before this turn.' }
      },
      required: ['user_input'],
      additionalProperties: false
    },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true }
  },
  {
    name: 'brainstem_new_session',
    title: 'Start New Brainstem Session',
    description: 'Forget the MCP-held Brainstem session ID and conversation history.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  }
];

function normalizeBase(value) {
  const parsed = new URL(value.includes('://') ? value : `http://${value}`);
  if(!['http:','https:'].includes(parsed.protocol)) throw new Error('RAPP_BRAINSTEM_URL must use http or https');
  if(parsed.username || parsed.password || parsed.search || parsed.hash) throw new Error('RAPP_BRAINSTEM_URL must be a bare base URL');
  return parsed.href.replace(/\/+$/,'');
}

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function reply(id, result) {
  send({ jsonrpc: '2.0', id, result });
}

function fail(id, code, message, data) {
  send({ jsonrpc: '2.0', id, error: { code, message, ...(data === undefined ? {} : { data }) } });
}

function toolResult(payload, isError = false) {
  const structuredContent = typeof payload === 'object' && payload !== null
    ? payload
    : { value: payload };
  return {
    content: [{ type: 'text', text: JSON.stringify(structuredContent, null, 2) }],
    structuredContent,
    isError
  };
}

function validateObject(value, label) {
  if(value === undefined) return {};
  if(!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object`);
  return value;
}

function validateHistory(value) {
  if(value === undefined) return undefined;
  if(!Array.isArray(value)) throw new Error('conversation_history must be an array');
  for(const [index, message] of value.entries()) {
    if(!message || typeof message !== 'object' || Array.isArray(message)) {
      throw new Error(`conversation_history[${index}] must be an object`);
    }
    if(!['user','assistant','tool'].includes(message.role) || typeof message.content !== 'string') {
      throw new Error(`conversation_history[${index}] must contain a valid role and string content`);
    }
  }
  return value;
}

async function callTool(name, rawArguments) {
  const args = validateObject(rawArguments, 'arguments');

  if(name === 'brainstem_status') {
    return toolResult(await brainstem.health());
  }

  if(name === 'brainstem_new_session') {
    sessionId = null;
    conversationHistory = [];
    return toolResult({ status: 'ok', session_id: null, history_messages: 0 });
  }

  if(name !== 'brainstem_chat') {
    return null;
  }

  const userInput = typeof args.user_input === 'string' ? args.user_input.trim() : '';
  if(!userInput) throw new Error('user_input is required');
  if(args.new_session === true) {
    sessionId = null;
    conversationHistory = [];
  }

  const explicitHistory = validateHistory(args.conversation_history);
  const explicitSession = typeof args.session_id === 'string' && args.session_id.trim()
    ? args.session_id.trim()
    : null;
  if(explicitSession && explicitSession !== sessionId && explicitHistory === undefined) {
    conversationHistory = [];
  }

  const historyForTurn = explicitHistory === undefined
    ? conversationHistory
    : explicitHistory;
  const response = await brainstem.chat(
    userInput,
    historyForTurn,
    explicitSession || sessionId,
    typeof args.idempotency_key === 'string' ? args.idempotency_key : undefined
  );
  if(typeof response.response !== 'string' || typeof response.session_id !== 'string') {
    throw new Error(response.error || 'Brainstem returned an invalid /chat envelope');
  }

  sessionId = response.session_id;
  conversationHistory = [
    ...historyForTurn,
    { role: 'user', content: userInput },
    { role: 'assistant', content: response.response }
  ];

  return toolResult({
    response: response.response,
    session_id: response.session_id,
    agent_logs: response.agent_logs,
    model: response.model,
    requested_model: response.requested_model,
    voice_mode: response.voice_mode,
    history_messages: conversationHistory.length
  });
}

async function handle(message) {
  if(!message || message.jsonrpc !== '2.0' || typeof message.method !== 'string') {
    if(message?.id !== undefined) fail(message.id, -32600, 'invalid JSON-RPC request');
    return;
  }
  if(message.id === undefined) return;

  const { id, method, params } = message;
  try {
    if(method === 'initialize') {
      reply(id, {
        protocolVersion: params?.protocolVersion || PROTOCOL_VERSION,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'rapp-brainstem', version: SERVER_VERSION }
      });
      return;
    }
    if(method === 'ping') {
      reply(id, {});
      return;
    }
    if(method === 'tools/list') {
      reply(id, { tools });
      return;
    }
    if(method === 'tools/call') {
      const name = params?.name;
      if(typeof name !== 'string') {
        fail(id, -32602, 'tools/call requires params.name');
        return;
      }
      const result = await callTool(name, params?.arguments);
      if(result === null) {
        fail(id, -32602, `unknown tool: ${name}`);
        return;
      }
      reply(id, result);
      return;
    }
    if(method === 'resources/list') {
      reply(id, { resources: [] });
      return;
    }
    if(method === 'prompts/list') {
      reply(id, { prompts: [] });
      return;
    }
    if(method === 'logging/setLevel') {
      reply(id, {});
      return;
    }
    fail(id, -32601, `method not found: ${method}`);
  } catch(error) {
    reply(id, toolResult({
      error: String(error?.message || error),
      brainstem_url: base
    }, true));
  }
}

const input = createInterface({ input: process.stdin, crlfDelay: Infinity });
for await (const line of input) {
  if(!line.trim()) continue;
  let message;
  try {
    message = JSON.parse(line);
  } catch(error) {
    fail(null, -32700, `parse error: ${error.message}`);
    continue;
  }
  await handle(message);
}
