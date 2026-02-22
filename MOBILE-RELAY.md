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

## Quick Start (new machine)

```bash
# 1. Clone and install
git clone https://github.com/AleksiSaarinen/claude-code-pet.git
cd claude-code-pet
npm install

# 2. Start the relay (in its own terminal — NOT inside Claude Code)
#    Windows CMD — IMPORTANT: quotes prevent trailing space in token
set "RELAY_TOKEN=dev-token" && node --watch relay-server.js

#    PowerShell:
$env:RELAY_TOKEN="dev-token"; node --watch relay-server.js

#    Linux/Mac:
RELAY_TOKEN=dev-token node --watch relay-server.js

# 3. Point it at a different project (optional):
set "RELAY_TOKEN=dev-token" && set "RELAY_PROJECT_DIR=C:\path\to\project" && node --watch relay-server.js

# 4. Open on phone browser (same WiFi):
#    http://<your-pc-ip>:3777/mobile?token=dev-token

# 5. Or install the Android floating overlay app:
#    See "Android App" section below
```

> **`--watch`** auto-restarts the relay when relay-server.js changes (built into Node 18+).

> **Windows CMD gotcha**: `set RELAY_TOKEN=dev-token && node ...` includes the trailing space in the token! Always use `set "RELAY_TOKEN=dev-token"` with quotes.

> **Never start the relay from inside Claude Code's Bash tool** — it inherits session state and causes the nested-session error.

## Setup (detailed)

### 1. Install dependencies

```bash
cd claude-code-pet
npm install    # installs ws (WebSocket library) + everything else
```

### 2. Run the relay server

The relay must run in a **separate terminal** (not spawned from Claude Code):

```bash
# Windows CMD (recommended for dev):
set "RELAY_TOKEN=dev-token" && node --watch relay-server.js

# With a custom project directory:
set "RELAY_TOKEN=mytoken" && set "RELAY_PROJECT_DIR=C:\Users\you\Projects\my-project" && node --watch relay-server.js

# Without --watch (no auto-restart):
set "RELAY_TOKEN=dev-token" && node relay-server.js
```

On startup it prints:

```
🐾 Claude Code Pet Relay Server
   Port:    3777
   Project: C:\Users\you\Projects\my-project
   Token:   dev-toke...

   Mobile pet page:
   http://localhost:3777/mobile?token=dev-token
```

### 3. Connect from phone

**Same WiFi (easiest):** Open `http://<your-pc-ip>:3777/mobile?token=dev-token` in your phone browser.

**From anywhere (Cloudflare Tunnel):**

```bash
# Install: winget install cloudflare.cloudflared  (or brew install cloudflared)
cloudflared tunnel --url http://localhost:3777
```

This gives you a URL like `https://random-words.trycloudflare.com` — open `https://random-words.trycloudflare.com/mobile?token=dev-token` on your phone. Encrypted, temporary (regenerates each run), and only people with your auth token can use it.

### 4. Android floating overlay app (optional)

The Android app shows the pet as a floating overlay on your phone screen.

```bash
cd android

# Windows CMD:
set "JAVA_HOME=C:\Program Files\Android\Android Studio\jbr"
set "ANDROID_HOME=%LOCALAPPDATA%\Android\Sdk"
.\gradlew.bat assembleDebug

# Install via adb (phone connected via USB with USB debugging on):
%ANDROID_HOME%\platform-tools\adb install -r app\build\outputs\apk\debug\app-debug.apk
```

On the phone app:
1. Enter `http://<your-pc-ip>:3777` as server URL + your token
2. Grant overlay permission when prompted
3. Tap **Start Pet Overlay**
4. Pet floats on screen — tap to expand, send prompts, see output

## Features

### Plan Mode
Tap the **Plan** toggle before sending a prompt. Claude will analyze and plan without making changes. After the plan streams in, you get:
- **Approve** — execute the plan
- **Edit** — type feedback to revise the plan
- **Cancel** — discard and return to normal

### New Chat
Tap the **+** button in the top bar to clear the conversation session. Use this when:
- Switching to a different task
- Claude seems confused or slow (context bloat from long sessions)
- Starting fresh the next day

### Variant Animations
The mobile pet rolls variant animations just like the desktop app — `coding-flow`, `thinking-eureka`, `idle-dancing`, `searching-treasure`, etc. Idle variants cycle every 12 seconds.

### Reconnect Resilience
If the WebSocket drops and reconnects (common on mobile), the relay sends buffered output so you don't miss what happened during the disconnect.

## Message Protocol

### Phone → Server

| Message | Description |
|---------|-------------|
| `{ type: "auth", token: "..." }` | First message, must authenticate |
| `{ type: "prompt", prompt: "...", planMode: bool }` | Send a task (planMode: true = plan only, don't execute) |
| `{ type: "execute_plan" }` | Execute the last plan Claude created |
| `{ type: "cancel" }` | Cancel the currently running task |
| `{ type: "new_conversation" }` | Clear session — next prompt starts fresh |
| `{ type: "status" }` | Request current pet status |
| `{ type: "ping" }` | Keep-alive ping |

### Server → Phone

| Message | Description |
|---------|-------------|
| `{ type: "auth_ok", project }` | Authenticated successfully |
| `{ type: "auth_fail" }` | Bad token, connection closed |
| `{ type: "pet_status", status, context }` | Pet status update (from hook or inferred from tools) |
| `{ type: "task_start", prompt, phase }` | Claude started working (phase: "plan", "execute", or "normal") |
| `{ type: "stream", text }` | Live text token from Claude |
| `{ type: "tool_event", tool, status, detail }` | Claude used a tool (Edit, Bash, Read, etc.) |
| `{ type: "output", text }` | Chunk of Claude's output |
| `{ type: "task_done", code, duration, summary, phase }` | Task finished (phase: "plan" shows approve/edit/cancel UI) |
| `{ type: "task_cancelled" }` | Task was cancelled |
| `{ type: "queued", position, prompt }` | Task added to queue |
| `{ type: "info", message }` | Informational message (e.g. "New conversation started") |
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
set "RELAY_TOKEN=your-secret-token"
set "RELAY_PROJECT_DIR=C:\Users\you\Projects\my-project"
node --watch "%~dp0relay-server.js"
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
