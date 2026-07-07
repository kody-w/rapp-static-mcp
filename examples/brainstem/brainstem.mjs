// brainstem.mjs — the reusable browser-tab MCP runtime for rapp-static-mcp brainstems.
//
// Weld this into any host or demo page. It:
//   • loads a static brainstem (RAR registry + memory + twin) from a base URL,
//   • runs the Python agents in-tab with VERIFY-BEFORE-EXEC (SHA-256 the pinned agent
//     before it runs; refuse if it drifts),
//   • speaks MCP JSON-RPC 2.0, and
//   • lets you LEND the tab as a serverless P2P MCP over WebRTC (Trystero/Nostr) — a
//     stranger BORROWS the answer through a secure channel handed to them by a QR code.
//
// No server. No cloud. The brainstem is available exactly as long as the tab stays open.

export const DEFAULT_RELAYS = ['wss://relay.damus.io','wss://nos.lol','wss://relay.primal.net','wss://relay.nostr.net','wss://nostr.wine'];
export const APP_ID = 'rapp-brainstem-mcp';
const TRYSTERO = 'https://esm.sh/trystero@0.21.5/nostr';

// SHA-256 → first 12 hex (the content address used to pin every agent).
export async function sha8(buf){
  const h = await crypto.subtle.digest('SHA-256', buf);
  return [...new Uint8Array(h)].map(b=>b.toString(16).padStart(2,'0')).join('').slice(0,12);
}

// Build a brainstem bound to a base URL (where brain/ lives) and a Pyodide instance.
// Returns { registry, memory, twin, runAgent, route, callTool, TOOLS, mcp }.
export async function createBrainstem({ base, pyodide }){
  const REG  = await (await fetch(base+'brain/registry.json')).json();
  const MEM  = await (await fetch(base+'brain/memory.json')).json();
  const TWIN = await (await fetch(base+'brain/twin.json')).json();

  // verify-before-exec: fetch the pinned agent, hash it, refuse if it drifts, then run in Pyodide.
  async function runAgent(id, input){
    const a = REG.agents.find(x=>x.id===id); if(!a) throw new Error('unknown agent: '+id);
    const buf = new Uint8Array(await (await fetch(base+a.module_path)).arrayBuffer());
    const got = await sha8(buf);
    if(got !== a.sha8) throw new Error(`verify-before-exec FAILED for ${id}: ${got} != pinned ${a.sha8}`);
    const code = new TextDecoder().decode(buf);
    pyodide.globals.set('_in_json', JSON.stringify(input||{}));
    pyodide.runPython(`
import json as _json
_ns = {}
exec(${JSON.stringify(code)}, _ns)
_res = _json.dumps(_ns[${JSON.stringify(a.entry)}](_json.loads(_in_json)))
`);
    return { via:id, verified_sha8:a.sha8, result: JSON.parse(pyodide.globals.get('_res')) };
  }

  function route(message){
    const m=(message||'').toLowerCase(); let best=null, score=0;
    for(const a of REG.agents){ const kws=a.when_to_use.split(/\s+/);
      const s=kws.filter(k=>k.length>3&&m.includes(k)).length; if(s>score){score=s;best=a;} }
    return score>0?best:null;
  }

  async function callTool(name, args){
    if(name==='list_agents') return { agents: REG.agents.map(a=>({id:a.id,name:a.name,when_to_use:a.when_to_use,sha8:a.sha8})) };
    if(name==='run_agent')  return await runAgent(args.agent, args.input||{});
    if(name==='recall'){ const q=String(args.query||'').toLowerCase();
      return { query:q, hits:(MEM.memories||[]).filter(x=>JSON.stringify(x).toLowerCase().includes(q)) }; }
    if(name==='ask_twin'){ const mem=(MEM.memories||[])[Math.floor(Math.random()*(MEM.memories||[]).length)]||{};
      return { persona:TWIN.name, reply:`(${TWIN.voice}) ${args.question} — ${TWIN.principles.join(', ')}. I recall: ${mem.text||''}` }; }
    if(name==='chat'){ const a=route(args.message);
      if(a){ const r=await runAgent(a.id, {message:args.message, memory:MEM.memories}); return { route:a.id, ...r }; }
      return { route:'twin', ...(await callTool('ask_twin',{question:args.message})) }; }
    throw new Error('unknown tool: '+name);
  }

  const TOOLS=[
   {name:'list_agents',description:'List the brainstem agents (from the static RAR).',inputSchema:{type:'object',properties:{}}},
   {name:'run_agent',description:'Run one agent by id (verify-before-exec). args: {agent, input}.',inputSchema:{type:'object',properties:{agent:{type:'string'},input:{type:'object'}},required:['agent']}},
   {name:'chat',description:'Single entrypoint: routes your message to the best agent (or the twin).',inputSchema:{type:'object',properties:{message:{type:'string'}},required:['message']}},
   {name:'recall',description:'Search brainstem memory.',inputSchema:{type:'object',properties:{query:{type:'string'}},required:['query']}},
   {name:'ask_twin',description:'Ask the twin persona.',inputSchema:{type:'object',properties:{question:{type:'string'}},required:['question']}},
  ];

  async function mcp(req){
    const {id,method,params}=req;
    try{
      if(method==='initialize') return {jsonrpc:'2.0',id,result:{protocolVersion:'2025-06-18',capabilities:{tools:{}},serverInfo:{name:REG.name||'static-brainstem',version:'1.0'}}};
      if(method==='ping') return {jsonrpc:'2.0',id,result:{}};
      if(method==='tools/list') return {jsonrpc:'2.0',id,result:{tools:TOOLS}};
      if(method==='tools/call'){ const out=await callTool(params.name, params.arguments||{});
        return {jsonrpc:'2.0',id,result:{content:[{type:'text',text:JSON.stringify(out,null,2)}], _meta:{verified_sha8:out.verified_sha8}}}; }
      return {jsonrpc:'2.0',id,error:{code:-32601,message:'method not found'}};
    }catch(e){ return {jsonrpc:'2.0',id,result:{content:[{type:'text',text:String(e.message||e)}],isError:true}}; }
  }

  return { registry:REG, memory:MEM, twin:TWIN, runAgent, route, callTool, TOOLS, mcp };
}

// ── LIVE brainstem (Tier 1) ─────────────────────────────────────────────────
// Wrap a running local brainstem.py (Flask on :7071) as an MCP. This is the peer of
// createBrainstem: instead of Pyodide + a static RAR, tools proxy to the live server's
// HTTP API (real loaded agents, real GitHub-Copilot auth, real tool-calling loop).
// The kernel is never touched — we only call its documented endpoints.
export function createLiveBrainstem({ base = 'http://localhost:7071' } = {}){
  base = base.replace(/\/+$/,'');
  const jget  = (p)      => fetch(base+p).then(r=>r.json());
  const jpost = (p, body)=> fetch(base+p, { method:'POST', headers: body?{'Content-Type':'application/json'}:undefined, body: body?JSON.stringify(body):undefined }).then(r=>r.json());

  const health      = ()               => jget('/health');
  const loginStatus = ()               => jget('/login/status');
  const startLogin  = ()               => jpost('/login');
  const pollLogin   = ()               => jpost('/login/poll');
  const listAgents  = async ()         => (await jget('/agents')).files || [];
  const exportUrl   = (filename)       => base+'/agents/export/'+encodeURIComponent(filename);
  const chat        = (message, history, session_id) =>
    jpost('/chat', { user_input:message, conversation_history:history||[], session_id });
  async function importAgent(file){
    const fd = new FormData(); fd.append('file', file, file.name);
    return fetch(base+'/agents/import', { method:'POST', body:fd }).then(r=>r.json());
  }

  const TOOLS = [
    { name:'chat', description:'Chat with the lent brainstem — routes through its loaded agents + GitHub Copilot (the real /chat tool-calling loop).', inputSchema:{type:'object',properties:{message:{type:'string'},history:{type:'array'},session_id:{type:'string'}},required:['message']} },
    { name:'list_agents', description:'List the brainstem\u2019s loaded agents (file + class names).', inputSchema:{type:'object',properties:{}} },
    { name:'health', description:'Brainstem status: version, active model, loaded agents, auth state.', inputSchema:{type:'object',properties:{}} },
  ];

  async function mcp(req){
    const { id, method, params } = req;
    try{
      if(method==='initialize'){ const h=await health().catch(()=>({}));
        return { jsonrpc:'2.0', id, result:{ protocolVersion:'2025-06-18', capabilities:{tools:{}}, serverInfo:{ name:'rapp-brainstem', version:h.version||'?', model:h.model } } }; }
      if(method==='ping') return { jsonrpc:'2.0', id, result:{} };
      if(method==='tools/list') return { jsonrpc:'2.0', id, result:{ tools:TOOLS } };
      if(method==='tools/call'){
        const n = params.name, a = params.arguments||{};
        if(n==='chat'){ const r = await chat(a.message, a.history, a.session_id);
          const text = (r.response!=null ? r.response : (r.error!=null ? '⚠ '+r.error : JSON.stringify(r)));
          return { jsonrpc:'2.0', id, result:{ content:[{type:'text',text}], _meta:{ model:r.model, agent_logs:r.agent_logs, session_id:r.session_id, error:r.error } } }; }
        if(n==='list_agents'){ const files = await listAgents();
          return { jsonrpc:'2.0', id, result:{ content:[{type:'text',text:JSON.stringify(files,null,2)}], _meta:{ agents:files } } }; }
        if(n==='health'){ const h = await health();
          return { jsonrpc:'2.0', id, result:{ content:[{type:'text',text:JSON.stringify(h,null,2)}], _meta:h } }; }
        return { jsonrpc:'2.0', id, error:{ code:-32601, message:'unknown tool: '+n } };
      }
      return { jsonrpc:'2.0', id, error:{ code:-32601, message:'method not found' } };
    }catch(e){ return { jsonrpc:'2.0', id, result:{ content:[{type:'text',text:'brainstem unreachable: '+(e.message||e)}], isError:true } }; }
  }

  return { base, health, loginStatus, startLogin, pollLogin, listAgents, exportUrl, importAgent, chat, TOOLS, mcp };
}

// A secure channel id. We pick it ourselves, so the QR renders instantly — the relay is only
// needed once a borrower actually scans and joins.
export function newRoomId(){ return 'brn-'+Math.random().toString(36).slice(2,10); }

// ── LEND (host side) ────────────────────────────────────────────────────────
// Publish `mcp` as a P2P MCP server in a room. A borrower who has the room id + one-time
// token can call it. Nothing but signaling touches the relays; the data channel is DTLS-P2P.
// `on` callbacks let a UI show a live "borrow log": { request({peerId,rpc,response}), join, leave, reject, error }.
export async function lendBrainstem({ roomId, mcp, token, appId=APP_ID, relays=DEFAULT_RELAYS, on={} }){
  try{
    const { joinRoom } = await import(TRYSTERO);
    const room = joinRoom({ appId, relayUrls: relays, relayRedundancy: Math.min(relays.length,4) }, roomId);
    const [sendRes, getReq] = room.makeAction('mcp');
    getReq(async (msg, peerId) => {
      if(!msg || msg.token !== token){
        sendRes({ jsonrpc:'2.0', id: msg&&msg.rpc&&msg.rpc.id, error:{code:-32000,message:'bad token'} }, peerId);
        on.reject && on.reject(peerId); return;
      }
      const response = await mcp(msg.rpc);
      sendRes(response, peerId);
      on.request && on.request({ peerId, rpc: msg.rpc, response });
    });
    if(on.join)  room.onPeerJoin(on.join);
    if(on.leave) room.onPeerLeave(on.leave);
    return room;
  }catch(e){ on.error && on.error(e); throw e; }
}

// ── BORROW (client side) ────────────────────────────────────────────────────
// Join a lent room and get a `call(method, params)` that resolves with the MCP response.
export async function borrowBrainstem({ roomId, token, appId=APP_ID, relays=DEFAULT_RELAYS, on={} }){
  const { joinRoom } = await import(TRYSTERO);
  const room = joinRoom({ appId, relayUrls: relays, relayRedundancy: Math.min(relays.length,4) }, roomId);
  const [sendReq, getRes] = room.makeAction('mcp');
  let rpcId=0; const waiters={};
  getRes(m => { if(m && m.id!=null && waiters[m.id]){ waiters[m.id](m); delete waiters[m.id]; } });
  if(on.join)  room.onPeerJoin(on.join);
  if(on.leave) room.onPeerLeave(on.leave);
  function call(method, params){ return new Promise((res,rej)=>{
    const id=++rpcId; waiters[id]=res;
    sendReq({ token, rpc:{ jsonrpc:'2.0', id, method, params } });
    setTimeout(()=>{ if(waiters[id]){ delete waiters[id]; rej(new Error('timeout — is the lender tab still open?')); } }, 20000);
  }); }
  return { room, call };
}
