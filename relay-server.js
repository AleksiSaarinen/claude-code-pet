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
const TEMP_PREFIX = "claude-pet-attach-";
let taskTempFiles = []; // temp files for current task, cleaned up on task_done

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

// ── MIME types ──────────────────────────────────────────────────────────────

const MIME = {
  ".html": "text/html",
  ".css": "text/css",
  ".js": "application/javascript",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webm": "video/webm",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
};

// ── HTTP Server (static files + health check) ──────────────────────────────

const CHARACTERS_DIR = path.join(__dirname, "characters");
const MOBILE_DIR = path.join(__dirname, "mobile");

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = decodeURIComponent(url.pathname);

  if (pathname === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok", project: PROJECT_DIR }));
    return;
  }

  // GET /mobile → serve mobile/index.html
  if (pathname === "/mobile") {
    const filePath = path.join(MOBILE_DIR, "index.html");
    fs.readFile(filePath, (err, data) => {
      if (err) { res.writeHead(404); res.end("Not found"); return; }
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(data);
    });
    return;
  }

  // GET /characters → JSON array of available character IDs
  if (pathname === "/characters") {
    try {
      const entries = fs.readdirSync(CHARACTERS_DIR, { withFileTypes: true });
      const chars = [];
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const configPath = path.join(CHARACTERS_DIR, entry.name, "character.json");
        if (fs.existsSync(configPath)) {
          try {
            const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
            chars.push({ id: config.id || entry.name, name: config.name || entry.name });
          } catch { /* skip invalid */ }
        }
      }
      res.writeHead(200, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
      res.end(JSON.stringify(chars));
    } catch (e) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  // GET /characters/<name>/<file> → serve character assets
  if (pathname.startsWith("/characters/")) {
    const relative = pathname.slice("/characters/".length);
    // Path traversal protection
    if (relative.includes("..") || relative.includes("~")) {
      res.writeHead(403); res.end("Forbidden"); return;
    }
    const filePath = path.join(CHARACTERS_DIR, relative);
    // Ensure resolved path is still inside CHARACTERS_DIR
    if (!path.resolve(filePath).startsWith(path.resolve(CHARACTERS_DIR))) {
      res.writeHead(403); res.end("Forbidden"); return;
    }
    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME[ext] || "application/octet-stream";
    fs.readFile(filePath, (err, data) => {
      if (err) { res.writeHead(404); res.end("Not found"); return; }
      res.writeHead(200, { "Content-Type": contentType, "Access-Control-Allow-Origin": "*" });
      res.end(data);
    });
    return;
  }

  // Default response
  res.writeHead(200, { "Content-Type": "text/plain" });
  res.end("Claude Code Pet Relay Server\nConnect via WebSocket on this port.");
});

// ── WebSocket Server ───────────────────────────────────────────────────────

const wss = new WebSocketServer({ server, maxPayload: 16 * 1024 * 1024 });
const clients = new Set();
let activeTask = null; // only one Claude task at a time
let taskQueue = [];
let lastSessionId = null; // track conversation session for --resume
let planSessionId = null; // session ID saved after a plan phase completes
let taskOutputBuffer = []; // buffered output for reconnecting clients
let lastTaskResult = null; // last task_done msg (for clients that reconnect just after)

// Persist session ID to survive relay restarts
const SESSION_FILE = path.join(path.dirname(STATUS_FILE), "relay-session-id.txt");
function loadSessionId() {
  try { return fs.readFileSync(SESSION_FILE, "utf8").trim() || null; } catch { return null; }
}
function saveSessionId(id) {
  try { fs.writeFileSync(SESSION_FILE, id, "utf8"); } catch {}
}
lastSessionId = loadSessionId();

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
        // Catch up reconnecting clients on active/recent task
        if (activeTask) {
          ws.send(JSON.stringify({
            type: "task_start",
            prompt: shorten(activeTask.prompt, 80),
            phase: activeTask.isPlan ? "plan" : activeTask.isExecute ? "execute" : "normal",
          }));
          for (const data of taskOutputBuffer) {
            ws.send(data);
          }
        } else if (lastTaskResult && (Date.now() - lastTaskResult._ts < 30000)) {
          ws.send(JSON.stringify(lastTaskResult));
        }
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

      case "execute_plan":
        handleExecutePlan(ws);
        break;

      case "new_conversation":
        lastSessionId = null;
        planSessionId = null;
        try { fs.unlinkSync(SESSION_FILE); } catch {}
        console.log("[relay] Starting fresh conversation");
        broadcast({ type: "info", message: "New conversation started" });
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
  let prompt = msg.prompt;
  if ((!prompt || typeof prompt !== "string") && !Array.isArray(msg.attachments)) {
    ws.send(JSON.stringify({ type: "error", message: "Missing prompt" }));
    return;
  }
  if (!prompt || typeof prompt !== "string") prompt = "(see attached image)";

  // Process attachments — save to temp files in project dir
  if (Array.isArray(msg.attachments)) {
    const attachmentPaths = [];
    for (const att of msg.attachments) {
      if (!att.data || !att.mimeType) continue;
      const buf = Buffer.from(att.data, "base64");
      if (buf.length > 10 * 1024 * 1024) {
        ws.send(JSON.stringify({ type: "error", message: `Attachment too large: ${att.name} (${Math.round(buf.length / 1024 / 1024)}MB)` }));
        continue;
      }
      const extMap = { "image/png": ".png", "image/jpeg": ".jpg", "image/gif": ".gif", "image/webp": ".webp" };
      const ext = extMap[att.mimeType] || ".png";
      const tempName = `${TEMP_PREFIX}${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`;
      const tempPath = path.join(PROJECT_DIR, tempName);
      try {
        fs.writeFileSync(tempPath, buf);
        attachmentPaths.push({ path: tempPath, name: att.name || tempName });
        taskTempFiles.push(tempPath);
        console.log(`[relay] Saved attachment: ${tempName} (${Math.round(buf.length / 1024)}KB)`);
      } catch (e) {
        console.error(`[relay] Failed to save attachment: ${e.message}`);
        ws.send(JSON.stringify({ type: "error", message: `Failed to save attachment: ${e.message}` }));
      }
    }
    if (attachmentPaths.length > 0) {
      const refs = attachmentPaths.map(a =>
        `The user attached an image file "${a.name}". Read it with your Read tool at this absolute path: ${a.path}`
      ).join("\n");
      prompt = `${refs}\n\n${prompt}`;
    }
  }

  // Keep the original user prompt for display (before image/plan prefixes)
  const userPrompt = msg.prompt || prompt;

  if (activeTask) {
    // Queue it
    taskQueue.push({ prompt, ws, planMode: msg.planMode, displayPrompt: userPrompt });
    broadcast({ type: "queued", position: taskQueue.length, prompt: userPrompt });
    return;
  }

  // Clear pending plan if user sends a non-plan prompt
  if (!msg.planMode) planSessionId = null;

  if (msg.planMode) {
    let wrapped;
    if (planSessionId) {
      // Revising an existing plan — user is giving feedback
      wrapped = "Revise the plan based on this feedback. Still do NOT make any changes "
        + "-- only update the plan.\n\nFeedback: " + prompt;
    } else {
      // Fresh plan request
      wrapped = "Create a detailed implementation plan for the following task. "
        + "Analyze the codebase, identify all files that need to change, and describe "
        + "your approach step by step. Do NOT make any changes yet -- only plan.\n\nTask: " + prompt;
    }
    runClaudeTask(wrapped, { isPlan: true, displayPrompt: userPrompt });
  } else {
    runClaudeTask(prompt, { displayPrompt: userPrompt });
  }
}

function handleExecutePlan(ws) {
  if (!planSessionId) {
    ws.send(JSON.stringify({ type: "error", message: "No plan to execute" }));
    return;
  }
  if (activeTask) {
    ws.send(JSON.stringify({ type: "error", message: "A task is already running" }));
    return;
  }
  lastSessionId = planSessionId;
  saveSessionId(lastSessionId);
  planSessionId = null;
  runClaudeTask("Now implement the plan you created above. Execute all the changes.", { isExecute: true });
}

function runClaudeTask(prompt, options = {}) {
  const { isPlan = false, isExecute = false, displayPrompt } = options;
  const shown = displayPrompt || prompt;
  activeTask = { prompt, startTime: Date.now(), isPlan, isExecute };
  broadcast({
    type: "task_start",
    prompt: shown,
    phase: isPlan ? "plan" : isExecute ? "execute" : "normal",
  });
  broadcastPetStatus("thinking");

  console.log(`[relay] Running: "${shorten(shown, 60)}"`);

  // Spawn claude -p with stream-json for real-time output
  // Use process.platform check — Windows needs shell:false to avoid cmd.exe mangling
  // multi-word prompts; Unix works either way
  const claudeCmd = process.platform === "win32" ? "claude.exe" : "claude";
  const args = [
    "-p", prompt,
    "--output-format", "stream-json",
    "--verbose",
    "--dangerously-skip-permissions",
  ];
  if (lastSessionId) {
    args.push("--resume", lastSessionId);
    console.log(`[relay] Resuming session ${lastSessionId.slice(0, 8)}...`);
  }
  const claude = spawn(claudeCmd, args, {
    cwd: PROJECT_DIR,
    stdio: ["ignore", "pipe", "pipe"],
    env: (() => { const e = { ...process.env }; delete e.CLAUDECODE; return e; })(),
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

        // Capture session ID for --resume on future prompts
        if (event.type === "system" && event.session_id) {
          lastSessionId = event.session_id;
          saveSessionId(lastSessionId);
          console.log(`[relay] Session ID: ${lastSessionId.slice(0, 8)}...`);
        }

        // Forward interesting events to the phone
        if (event.type === "assistant" && event.message) {
          // Extract text from content blocks
          const texts = (event.message.content || [])
            .filter(b => b.type === "text")
            .map(b => b.text);
          if (texts.length) {
            const text = texts.join("\n");
            resultText += text;
            broadcast({ type: "output", text });
          }
        }

        // Tool use events — forward with details (file, command, etc.)
        if (event.type === "tool_use" || event.type === "tool_result") {
          const input = event.input || {};
          const toolName = event.name || event.tool_name || null;
          const detail = input.file_path || input.path || input.command || input.pattern || input.query || input.description || null;
          broadcast({
            type: "tool_event",
            tool: toolName,
            status: event.type,
            detail: detail ? shorten(String(detail), 80) : null,
          });
          // Update pet animation based on tool
          if (event.type === "tool_use" && toolName) {
            const petStatus = inferPetStatus(toolName, input);
            const context = {};
            if (input.file_path) context.file = input.file_path;
            else if (input.path) context.file = input.path;
            if (input.command) context.command = input.command;
            if (input.pattern || input.query) context.query = input.pattern || input.query;
            broadcastPetStatus(petStatus, context);
          }
        }

        // Stream text deltas for live output
        if (event.type === "stream_event" && event.event?.delta?.type === "text_delta") {
          broadcast({
            type: "stream",
            text: event.event.delta.text || "",
          });
          // Show thinking when Claude is writing text (between tool calls)
          broadcastPetStatus("thinking");
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
    if (!activeTask) return; // already cancelled
    const duration = Date.now() - activeTask.startTime;
    const wasPlan = activeTask.isPlan;
    console.log(`[relay] Task completed (code ${code}, ${Math.round(duration / 1000)}s, phase: ${wasPlan ? "plan" : activeTask.isExecute ? "execute" : "normal"})`);

    if (wasPlan && code === 0) planSessionId = lastSessionId;

    // Animate pet: success or error, then idle
    broadcastPetStatus(code === 0 ? "success" : "error");
    setTimeout(() => broadcastPetStatus("idle"), 4000);

    broadcast({
      type: "task_done",
      code,
      duration,
      summary: resultText,
      phase: wasPlan ? "plan" : activeTask.isExecute ? "execute" : "normal",
    });

    activeTask = null;
    cleanupTempFiles();

    // Don't auto-dequeue after plan — wait for user to execute/discard
    if (!wasPlan && taskQueue.length > 0) {
      const next = taskQueue.shift();
      broadcast({ type: "queue_update", remaining: taskQueue.length });
      runClaudeTask(next.prompt, { isPlan: !!next.planMode, displayPrompt: next.displayPrompt });
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
    cleanupTempFiles();
  }
}

function cleanupTempFiles() {
  for (const tempPath of taskTempFiles) {
    try {
      if (fs.existsSync(tempPath)) {
        fs.unlinkSync(tempPath);
        console.log(`[relay] Cleaned up: ${path.basename(tempPath)}`);
      }
    } catch (e) {
      console.error(`[relay] Failed to cleanup ${tempPath}: ${e.message}`);
    }
  }
  taskTempFiles = [];
}

// Clean orphaned temp files from previous sessions on startup
try {
  for (const f of fs.readdirSync(PROJECT_DIR)) {
    if (f.startsWith(TEMP_PREFIX)) {
      try { fs.unlinkSync(path.join(PROJECT_DIR, f)); console.log(`[relay] Cleaned orphaned: ${f}`); } catch {}
    }
  }
} catch {}

// ── Pet status inference from tool events ────────────────────────────────────
// Mirrors the mapping in hook.js so the pet animates during relay tasks

function inferPetStatus(toolName, input) {
  if (!toolName) return "thinking";
  const tool = toolName;

  if (tool === "Bash") {
    const cmd = (input.command || "").toLowerCase();
    const desc = (input.description || "").toLowerCase();
    const text = cmd + " " + desc;
    if (/npm install|yarn add|pip install|apt install|brew install|cargo add|pnpm add|bun add/.test(text)) return "installing";
    if (/npm test|pytest|jest|vitest|mocha|cargo test|go test|unittest|run test/.test(text)) return "testing";
    if (/deploy|publish|push|release|ship/.test(text)) return "deploying";
    if (/download|curl|wget|fetch|clone/.test(text)) return "downloading";
    if (/\brm |del |remove|clean|uninstall|prune/.test(text)) return "deleting";
    if (/debug|inspect/.test(text)) return "debugging";
    if (/build|compile|make|bundle|cook/.test(text)) return "cooking";
    return "coding";
  }
  if (tool === "Grep" || tool === "WebSearch" || tool === "Glob") return "searching";
  if (tool === "Read" || tool === "WebFetch") return "reading";
  if (tool === "Write" || tool === "Edit" || tool === "NotebookEdit") return "coding";
  if (tool === "Task") return "thinking";
  return "thinking";
}

let lastBroadcastStatus = "idle";
function broadcastPetStatus(status, context) {
  if (status === lastBroadcastStatus) return; // avoid spamming duplicates
  lastBroadcastStatus = status;
  broadcast({ type: "pet_status", status, context: context || {} });
}

// ── Broadcast to all connected clients ─────────────────────────────────────

function broadcast(msg) {
  const data = JSON.stringify(msg);

  // Buffer output during active task for reconnecting clients
  if (msg.type === "task_start") {
    taskOutputBuffer = [];
  } else if (activeTask && ["stream", "output", "tool_event"].includes(msg.type)) {
    taskOutputBuffer.push(data);
    if (taskOutputBuffer.length > 150) taskOutputBuffer.shift();
  } else if (msg.type === "task_done") {
    lastTaskResult = { ...msg, _ts: Date.now() };
    taskOutputBuffer = [];
  }

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
  console.log(`\n   Mobile pet page:`);
  console.log(`   http://localhost:${PORT}/mobile?token=${AUTH_TOKEN}`);
  console.log(`\n   Connect from phone with:`);
  console.log(`   ws://<your-ip>:${PORT}`);
  console.log(`   First message: { "type": "auth", "token": "${AUTH_TOKEN}" }`);
  console.log(`\n   To expose externally, use:`);
  console.log(`   cloudflared tunnel --url http://localhost:${PORT}\n`);
});
