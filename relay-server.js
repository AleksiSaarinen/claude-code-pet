// ══════════════════════════════════════════════════════════════════════════════
// Claude Code Pet — Relay Server
// Bridges your phone to Claude Code running on your PC.
// Accepts prompts via WebSocket, pipes them to `claude -p`, streams output back.
// Also broadcasts pet status changes so the mobile pet stays in sync.
// ══════════════════════════════════════════════════════════════════════════════

const http = require("http");
const { WebSocketServer, WebSocket } = require("ws");
const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const os = require("os");

// ── Config ─────────────────────────────────────────────────────────────────

const PORT = process.env.RELAY_PORT || 3777;
const AUTH_TOKEN = process.env.RELAY_TOKEN || generateToken();
const PROJECT_DIR = process.env.RELAY_PROJECT_DIR || process.cwd();

// Pet status file — same one the desktop app uses
function getPetStatusFile() {
  if (process.platform === "win32")
    return path.join(process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"), "claude-code-pet", "claude-pet-status.txt");
  if (process.platform === "darwin")
    return path.join(os.homedir(), "Library", "Application Support", "claude-code-pet", "claude-pet-status.txt");
  return path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config"), "claude-code-pet", "claude-pet-status.txt");
}

const STATUS_FILE = getPetStatusFile();

function generateToken() {
  const token = crypto.randomBytes(24).toString("hex");
  console.log("\n╔══════════════════════════════════════════════════════════╗");
  console.log("║  NO RELAY_TOKEN set — generated a random one:          ║");
  console.log(`║  ${token}  ║`);
  console.log("║  Set RELAY_TOKEN env var to use a fixed token.         ║");
  console.log("╚══════════════════════════════════════════════════════════╝\n");
  return token;
}

// ── HTTP Server (health check + token display) ─────────────────────────────

const server = http.createServer((req, res) => {
  if (req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok", project: PROJECT_DIR }));
  } else {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("Claude Code Pet Relay Server\nConnect via WebSocket on this port.");
  }
});

// ── WebSocket Server ───────────────────────────────────────────────────────

const wss = new WebSocketServer({ server });
const clients = new Set();
let activeTask = null; // only one Claude task at a time
let taskQueue = [];

wss.on("connection", (ws, req) => {
  // ── Auth: first message must be { type: "auth", token: "..." } ──
  let authenticated = false;

  ws.on("message", (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      ws.send(JSON.stringify({ type: "error", message: "Invalid JSON" }));
      return;
    }

    // Auth gate
    if (!authenticated) {
      if (msg.type === "auth" && msg.token === AUTH_TOKEN) {
        authenticated = true;
        clients.add(ws);
        ws.send(JSON.stringify({ type: "auth_ok", project: PROJECT_DIR }));
        // Send current status
        sendCurrentStatus(ws);
        console.log(`[relay] Client authenticated (${clients.size} connected)`);
      } else {
        ws.send(JSON.stringify({ type: "auth_fail" }));
        ws.close();
      }
      return;
    }

    // ── Handle messages from authenticated clients ──
    switch (msg.type) {
      case "prompt":
        handlePrompt(msg, ws);
        break;

      case "cancel":
        cancelTask();
        break;

      case "status":
        sendCurrentStatus(ws);
        break;

      case "ping":
        ws.send(JSON.stringify({ type: "pong" }));
        break;

      default:
        ws.send(JSON.stringify({ type: "error", message: `Unknown type: ${msg.type}` }));
    }
  });

  ws.on("close", () => {
    clients.delete(ws);
    console.log(`[relay] Client disconnected (${clients.size} connected)`);
  });
});

// ── Prompt Handler — spawns Claude Code CLI ────────────────────────────────

function handlePrompt(msg, ws) {
  const prompt = msg.prompt;
  if (!prompt || typeof prompt !== "string") {
    ws.send(JSON.stringify({ type: "error", message: "Missing prompt" }));
    return;
  }

  if (activeTask) {
    // Queue it
    taskQueue.push({ prompt, ws });
    broadcast({ type: "queued", position: taskQueue.length, prompt: shorten(prompt, 60) });
    return;
  }

  runClaudeTask(prompt);
}

function runClaudeTask(prompt) {
  activeTask = { prompt, startTime: Date.now() };
  broadcast({ type: "task_start", prompt: shorten(prompt, 80) });

  console.log(`[relay] Running: "${shorten(prompt, 60)}"`);

  // Spawn claude -p with stream-json for real-time output
  const claude = spawn("claude", [
    "-p", prompt,
    "--output-format", "stream-json",
    "--verbose",
  ], {
    cwd: PROJECT_DIR,
    shell: true,
    env: { ...process.env },
  });

  activeTask.process = claude;
  let fullOutput = "";
  let resultText = "";

  claude.stdout.on("data", (chunk) => {
    const lines = chunk.toString().split("\n").filter(Boolean);
    for (const line of lines) {
      try {
        const event = JSON.parse(line);
        fullOutput += line + "\n";

        // Forward interesting events to the phone
        if (event.type === "assistant" && event.message) {
          // Extract text from content blocks
          const texts = (event.message.content || [])
            .filter(b => b.type === "text")
            .map(b => b.text);
          if (texts.length) {
            const text = texts.join("\n");
            resultText += text;
            broadcast({ type: "output", text: shorten(text, 500) });
          }
        }

        // Tool use events — these are what the pet reacts to
        if (event.type === "tool_use" || event.type === "tool_result") {
          broadcast({
            type: "tool_event",
            tool: event.name || event.tool_name || null,
            status: event.type,
          });
        }

        // Stream text deltas for live output
        if (event.type === "stream_event" && event.event?.delta?.type === "text_delta") {
          broadcast({
            type: "stream",
            text: event.event.delta.text || "",
          });
        }

      } catch {
        // Non-JSON line, might be raw text output
        if (line.trim()) {
          fullOutput += line + "\n";
          resultText += line;
        }
      }
    }
  });

  claude.stderr.on("data", (chunk) => {
    const text = chunk.toString();
    console.error(`[claude stderr] ${text}`);
    broadcast({ type: "log", text: shorten(text, 200) });
  });

  claude.on("close", (code) => {
    const duration = Date.now() - activeTask.startTime;
    console.log(`[relay] Task completed (code ${code}, ${Math.round(duration / 1000)}s)`);

    broadcast({
      type: "task_done",
      code,
      duration,
      summary: shorten(resultText, 300),
    });

    activeTask = null;

    // Process next in queue
    if (taskQueue.length > 0) {
      const next = taskQueue.shift();
      broadcast({ type: "queue_update", remaining: taskQueue.length });
      runClaudeTask(next.prompt);
    }
  });

  claude.on("error", (err) => {
    console.error(`[relay] Spawn error: ${err.message}`);
    broadcast({ type: "error", message: `Failed to start Claude: ${err.message}` });
    activeTask = null;
  });
}

function cancelTask() {
  if (activeTask && activeTask.process) {
    activeTask.process.kill("SIGTERM");
    broadcast({ type: "task_cancelled" });
    console.log("[relay] Task cancelled");
    activeTask = null;
  }
}

// ── Broadcast to all connected clients ─────────────────────────────────────

function broadcast(msg) {
  const data = JSON.stringify(msg);
  for (const ws of clients) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(data);
    }
  }
}

// ── Pet Status File Watcher ────────────────────────────────────────────────
// Watches the same status file the desktop pet uses, broadcasts to phone

function sendCurrentStatus(ws) {
  try {
    const raw = fs.readFileSync(STATUS_FILE, "utf-8").trim();
    let status, context;
    try {
      const parsed = JSON.parse(raw);
      status = parsed.status;
      context = parsed.context || {};
    } catch {
      status = raw;
      context = {};
    }
    ws.send(JSON.stringify({ type: "pet_status", status, context }));
  } catch {
    ws.send(JSON.stringify({ type: "pet_status", status: "idle", context: {} }));
  }
}

try {
  if (fs.existsSync(STATUS_FILE)) {
    fs.watch(STATUS_FILE, () => {
      try {
        const raw = fs.readFileSync(STATUS_FILE, "utf-8").trim();
        let status, context;
        try {
          const parsed = JSON.parse(raw);
          status = parsed.status;
          context = parsed.context || {};
        } catch {
          status = raw;
          context = {};
        }
        broadcast({ type: "pet_status", status, context });
      } catch { /* ignore */ }
    });
    console.log(`[relay] Watching pet status: ${STATUS_FILE}`);
  } else {
    console.log(`[relay] Pet status file not found: ${STATUS_FILE}`);
    console.log(`[relay] (Pet status sync disabled — desktop app may not be running)`);
  }
} catch (e) {
  console.log(`[relay] Could not watch pet status: ${e.message}`);
}

// ── Helpers ────────────────────────────────────────────────────────────────

function shorten(s, max) {
  if (!s) return "";
  return s.length > max ? s.substring(0, max - 1) + "…" : s;
}

// ── Start ──────────────────────────────────────────────────────────────────

server.listen(PORT, () => {
  console.log(`\n🐾 Claude Code Pet Relay Server`);
  console.log(`   Port:    ${PORT}`);
  console.log(`   Project: ${PROJECT_DIR}`);
  console.log(`   Token:   ${AUTH_TOKEN.substring(0, 8)}...`);
  console.log(`\n   Connect from phone with:`);
  console.log(`   ws://<your-ip>:${PORT}`);
  console.log(`   First message: { "type": "auth", "token": "${AUTH_TOKEN}" }`);
  console.log(`\n   To expose externally, use:`);
  console.log(`   cloudflared tunnel --url http://localhost:${PORT}\n`);
});
