# brainstem — a browser-tab MCP (Pyodide + verify-before-exec + QR)

**An MCP server that runs inside a browser tab.** No backend. As long as the tab is open, the MCP is open.

- **`host.html`** boots **Pyodide** (Python in WASM), pulls a **static brainstem** from GitHub raw
  (`brain/registry.json` = the RAR, `brain/agents/*.py`, `brain/memory.json`, `brain/twin.json`),
  and speaks MCP JSON-RPC in-tab.
- Agents are **RAPP-native single-file Python** (`perform(input)`). `run_agent`/`chat` do
  **verify-before-exec**: fetch the pinned agent, SHA-256 it, refuse if it drifts from the registry's
  `sha8`, then run it in Pyodide. (Verified end-to-end headlessly.)
- **`connect.html`** is the client the **QR code** opens: a phone/other device scans it, connects to the
  host tab over **WebRTC (Trystero over public Nostr relays — serverless)** — a DTLS-encrypted P2P data channel — and calls the MCP. The QR
  carries a **one-time token**; only a scanner who has it is authorized. No server sees the traffic.

```
        GitHub raw (global user data)                 browser TAB = the MCP host
   brain/registry.json  (RAR, pinned sha8)   ┌──────────────────────────────────────┐
   brain/agents/*.py    (Python agents)  ───▶│ Pyodide  ·  verify-before-exec        │
   brain/memory.json / twin.json             │ tools: chat · run_agent · list_agents │
                                             │        recall · ask_twin              │
   phone ──scan QR──▶ connect.html ──WebRTC──▶│ (JSON-RPC bridge, one-time token)     │
                                             └──────────────────────────────────────┘
```

## Run it
1. Open the host tab: **https://kody-w.github.io/rapp-static-mcp/examples/brainstem/host.html**
   (Pyodide loads in a few seconds; you'll see `pyodide/brainstem/mcp: ready`.)
2. Use the in-tab console (chat / run_agent) — or **scan the QR** with a phone to drive it from another device.

## Demos
- **The Brainstem Borrower** — **[demos/brainstem-borrower.html](https://kody-w.github.io/rapp-static-mcp/examples/brainstem/demos/brainstem-borrower.html)**
  Your machine does the thinking; a stranger **borrows the answer** through a secure channel handed to
  them by a QR. Open it, keep the tab open, and watch the **live borrow log** + **no-server ledger** as
  someone scans and runs your `meeting_cost` agent. The borrower lands on
  [demos/borrow.html](https://kody-w.github.io/rapp-static-mcp/examples/brainstem/demos/borrow.html) —
  a big verified number computed on *your* machine, over an encrypted P2P channel, with no server.

The runtime is welded into a reusable module, **`brainstem.mjs`** (`createBrainstem` = verify-before-exec
+ MCP; `lendBrainstem` / `borrowBrainstem` = the serverless P2P host/client). `host.html`, `connect.html`,
and both demos are thin UIs over it.

## Add an agent (RAPP style)
1. Drop a single-file Python agent in `brain/agents/<id>.py` exporting `META` + `def perform(input): ...`.
2. Add it to `brain/agents.json`.
3. `node brain/build-brain.mjs` — pins it by `sha8` into `brain/registry.json`.
4. Commit. The host picks it up on reload; `run_agent`/`chat` will verify-before-exec it.

## Security model
- **Integrity:** every agent is content-addressed; the host refuses to run bytes whose SHA-256 ≠ the
  pinned `sha8` (supply-chain safety, even though the code is fetched from a public URL).
- **Access:** the QR carries a fresh per-session token; the host rejects RPCs without it.
- **Confidentiality:** the WebRTC data channel is DTLS-encrypted and peer-to-peer.
- **Signaling** uses public Nostr relays via Trystero (for peer discovery + NAT traversal only — no payload passes through them). The host self-assigns the room id, so the QR renders instantly regardless of relay status.
  Swap in your own relay list (`DEFAULT_RELAYS` in `brainstem.mjs`) for a fully self-owned path.

_A `rapp-static-mcp/1.0` MCP whose runtime is a browser tab. Welds Pyodide + Trystero + the RAR onto the
static-MCP pattern._
