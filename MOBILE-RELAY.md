# Claude Code Pet — Mobile Relay

Control Claude Code from your phone through your pet. Send prompts, watch her react in real-time, get results back.

## How It Works

```
┌────────────────────────────┐
│  Your Phone                │
│  (floating pet + chat)     │
│        │    ▲               │
│   prompt│    │status/output  │
│        ▼    │               │
│     WebSocket               │
└────────┼────┼───────────────┘
         │    │
   Cloudflare Tunnel (encrypted, free)
         │    │
┌────────┼────┼───────────────┐
│  Your PC                    │
│        ▼    │               │
│  ┌─────────────────────┐   │
│  │  relay-server.js     │   │
│  │  - receives prompts  │   │
│  │  - spawns claude -p  │   │
│  │  - streams output    │   │
│  │  - watches pet status│   │
│  └──────────┬──────────┘   │
│             │               │
│     ┌───────┴────────┐     │
│     │   Claude Code   │     │
│     │   (CLI, -p)     │     │
│     │   + GDAI MCP    │     │
│     └───────┬────────┘     │
│             │               │
│     Your Godot project      │
└─────────────────────────────┘
```

## Setup

### 1. Install dependencies

The relay server uses only Node built-ins plus `ws` (WebSocket library):

```bash
cd claude-code-pet
npm install ws
```

### 2. Run the relay server

```bash
# Basic — runs in the current directory
node relay-server.js

# Point it at your Godot project
RELAY_PROJECT_DIR="C:\Users\you\Projects\my-godot-game" node relay-server.js

# With a fixed auth token (recommended)
RELAY_TOKEN="my-secret-token-here" RELAY_PROJECT_DIR="C:\path\to\project" node relay-server.js
```

On startup it prints:

```
🐾 Claude Code Pet Relay Server
   Port:    3777
   Project: C:\Users\you\Projects\my-godot-game
   Token:   a1b2c3d4...

   Connect from phone with:
   ws://<your-ip>:3777
   First message: { "type": "auth", "token": "..." }
```

### 3. Expose to the internet (for "from anywhere" access)

Install Cloudflare Tunnel (free, encrypted, no open ports):

```bash
# Install cloudflared
# Windows: winget install cloudflare.cloudflared
# Mac: brew install cloudflared
# Linux: see https://developers.cloudflare.com/cloudflare-one/connections/connect-apps/install-and-setup/

# Run the tunnel
cloudflared tunnel --url http://localhost:3777
```

It gives you a URL like `https://random-words.trycloudflare.com` — this is your phone's connection point. Encrypted, temporary (regenerates each run), and only people with your auth token can use it.

For same-WiFi use, just use your PC's local IP directly: `ws://192.168.1.xxx:3777`

### 4. Connect from phone

The phone app connects via WebSocket and authenticates:

```js
// Phone-side connection
const ws = new WebSocket("wss://random-words.trycloudflare.com");

ws.onopen = () => {
  ws.send(JSON.stringify({ type: "auth", token: "your-token-here" }));
};

ws.onmessage = (event) => {
  const msg = JSON.parse(event.data);
  switch (msg.type) {
    case "auth_ok":       // Connected! msg.project = project dir
    case "pet_status":    // msg.status, msg.context → update pet animation + speech bubble
    case "task_start":    // Claude started working → msg.prompt
    case "stream":        // Live text output → msg.text
    case "tool_event":    // Tool used → msg.tool, msg.status
    case "output":        // Chunk of text output → msg.text
    case "task_done":     // Done! → msg.code, msg.duration, msg.summary
    case "task_cancelled":// User cancelled
    case "queued":        // Task queued → msg.position
    case "error":         // Something went wrong → msg.message
  }
};

// Send a prompt
ws.send(JSON.stringify({ type: "prompt", prompt: "Add a health bar to the player HUD" }));

// Cancel current task
ws.send(JSON.stringify({ type: "cancel" }));
```

## Message Protocol

### Phone → Server

| Message | Description |
|---------|-------------|
| `{ type: "auth", token: "..." }` | First message, must authenticate |
| `{ type: "prompt", prompt: "..." }` | Send a task to Claude Code |
| `{ type: "cancel" }` | Cancel the currently running task |
| `{ type: "status" }` | Request current pet status |
| `{ type: "ping" }` | Keep-alive ping |

### Server → Phone

| Message | Description |
|---------|-------------|
| `{ type: "auth_ok", project }` | Authenticated successfully |
| `{ type: "auth_fail" }` | Bad token, connection closed |
| `{ type: "pet_status", status, context }` | Pet status update (same as desktop pet gets) |
| `{ type: "task_start", prompt }` | Claude started working on your prompt |
| `{ type: "stream", text }` | Live text token from Claude |
| `{ type: "tool_event", tool, status }` | Claude used a tool (Edit, Bash, Read, etc.) |
| `{ type: "output", text }` | Chunk of Claude's output |
| `{ type: "task_done", code, duration, summary }` | Task finished |
| `{ type: "task_cancelled" }` | Task was cancelled |
| `{ type: "queued", position, prompt }` | Task added to queue |
| `{ type: "error", message }` | Something went wrong |
| `{ type: "pong" }` | Response to ping |

## Security

The relay server is **much simpler and safer** than something like OpenClaw:

- **Token auth** — first message must contain the correct token or connection is closed
- **No skills/plugins** — no third-party code execution, no marketplace
- **No persistent memory manipulation** — just forwards prompts to Claude Code
- **Single project** — locked to one project directory, can't navigate elsewhere
- **No messaging integrations** — no WhatsApp/Telegram/Slack surface area
- **Claude Code's own safety** — all normal permission rules still apply
- **Cloudflare Tunnel** — encrypted transport, no open ports on your router

The relay server is essentially just a fancy WebSocket-to-CLI bridge. Claude Code itself handles all the actual security (file permissions, tool allowlists, etc.).

### Recommended: set an allowlist for headless mode

Create `.claude/settings.local.json` in your project:

```json
{
  "permissions": {
    "allow": [
      "Read",
      "Write",
      "Edit",
      "Bash(npm:*)",
      "Bash(git:*)",
      "Bash(godot:*)",
      "Grep",
      "Glob",
      "mcp__gdai__*"
    ]
  }
}
```

This lets Claude use GDAI MCP tools and standard file operations but won't let it run arbitrary commands.

## Running as a Background Service

### Windows (Task Scheduler or pm2)

```bash
# Install pm2 globally
npm install -g pm2

# Start the relay
pm2 start relay-server.js --name pet-relay -- --env RELAY_PROJECT_DIR="C:\path\to\project"

# Auto-start on boot
pm2 save
pm2 startup
```

### Or just a simple batch file

Create `start-relay.bat`:

```batch
@echo off
set RELAY_TOKEN=your-secret-token
set RELAY_PROJECT_DIR=C:\Users\you\Projects\my-godot-game
node "%~dp0relay-server.js"
```

## What's Next

The relay server is the backend. The frontend is the **Android floating pet app** that connects to it. That's a separate project that includes:

1. Android overlay service (floating window)
2. WebView rendering a mobile version of pet.html
3. Chat input for sending prompts
4. Live status display from the relay
5. Task output / summary viewer

The relay server works right now — you can test it with any WebSocket client (browser console, wscat, Postman) before building the Android app.

### Quick test from browser console:

```js
const ws = new WebSocket("ws://localhost:3777");
ws.onopen = () => ws.send(JSON.stringify({ type: "auth", token: "your-token" }));
ws.onmessage = (e) => console.log(JSON.parse(e.data));
// After auth_ok:
ws.send(JSON.stringify({ type: "prompt", prompt: "What files are in this project?" }));
```
