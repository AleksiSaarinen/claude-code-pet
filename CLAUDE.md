# Claude Code Pet - Dev Notes

> **Keep this file current.** Update CLAUDE.md (and `~/.claude/projects/.../memory/MEMORY.md`) whenever making non-trivial changes — new patterns, platform gotchas, architectural decisions — before committing.

## Sprite Sheet Character System
- **pet.html**: `SpriteRenderer` class (canvas-based), `set-character` IPC handler, sprite-mode CSS
- **main.js**: `discoverCharacters()`, `buildCharacterSubmenu()`, character persistence in `selected-character.json`
- **package.json**: `characters/` in `extraResources` for packaged builds
- Characters live in `characters/<name>/` with `character.json` + PNG sprite sheets
- User-installed characters: `%APPDATA%/claude-code-pet/characters/`

## Sprite Processing Tool
`tools/process-sprites.js` — requires `sharp` (already in devDependencies)

### Adding a new sprite state from an AI-generated image:
```bash
# 1. Save raw image to raw/ folder (or from clipboard):
powershell -Command "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.Clipboard]::GetImage().Save('characters\grok-test1\raw\STATE.png')"

# 2. Process into sprite sheet (adjust --frames, add --rows 2 for grids):
node tools/process-sprites.js characters/grok-test1/raw/STATE.png --frames 4 --remove-bg --out characters/grok-test1/STATE.png

# 3. Add to characters/grok-test1/character.json states:
#    "STATE": { "file": "STATE.png", "frameCount": 4, "frameDuration": 180, "loop": true }
```

### grok-test1 character — remaining states needed:
- **debugging** — detective-style, examining code
- **hatching** — emerging from egg
- **deleting** — sweeping/cleaning up
- **downloading** — catching items / download arrow

### Completed states (12/16):
idle, coding, thinking, success, error, searching, reading, installing, testing, deploying, cooking

## Running the App
Always kill existing instances before starting. Use these exact commands:

**Kill all instances:**
```bash
powershell -Command "Stop-Process -Name electron -Force -ErrorAction SilentlyContinue"
```

**Kill and restart (do these separately, not chained in background):**
```bash
# Step 1 - kill:
powershell -Command "Stop-Process -Name electron -Force -ErrorAction SilentlyContinue; Start-Sleep -Seconds 1; Start-Process 'cmd' -ArgumentList '/c cd /d C:\Users\allus\Documents\GitHub\claude-code-pet && npm start' -WindowStyle Hidden"
```

Never use `taskkill /IM electron.exe` — it doesn't work reliably. Never run `npm start &` multiple times in background tasks as each spawns a new instance.

## Display & Debugging
- **User display: 225% DPI (scaleFactor: 2.25)** — affects all coordinate/size calculations
- Debug log (readable by Claude directly): `%APPDATA%/claude-code-pet/debug.log`
- Main process logs everything via overridden `console.log` → appended to debug.log

### Known DPI pitfalls at 225%:
- **`win.setSize()` is BROKEN at 225% DPI** — always snaps window to ~600×660 regardless of input; use `win.setBounds({x,y,width,height})` instead (single atomic OS call, works correctly)
- `setMinimumSize/setMaximumSize(200,220)` treats args as physical pixels → makes window tiny; don't use
- `screen.getCursorScreenPoint()` returns physical pixels; divide delta by `display.scaleFactor` before passing to `win.setBounds`
- `webContents.setZoomFactor()` persists across restarts in `Preferences` file → always call `setZoomFactor(1.0)` in `did-finish-load` to override
- `maximizable: false` breaks client area on frameless transparent windows on Windows — avoid

### Window sizing (settings menu):
- Sizes: small 160×176, normal 200×220, large 400×440, xlarge 600×660 (logical px)
- `applyWindowSize(size)` is module-scope in main.js — calls `win.setBounds()` atomically then sends `set-scale` IPC after 80ms
- `dragInterval` must be cleared before resizing (it calls `setBounds` every 16ms and will fight the resize)
- CSS `html/body { width:100%; height:100% }` so they fill the actual window; `transform: scale()` on `.scene` for upscaling
- `set-scale` IPC sent AFTER `setBounds` settles (80ms delay) to avoid Chromium compositor race

## Cross-Platform Support
The app runs on Windows, macOS, and Linux. Key platform notes:

- **Status file paths** — `hook.js`, `set-status.js`, `watcher.js` all use `getUserDataDir()` which returns:
  - Windows: `%APPDATA%\claude-code-pet`
  - macOS: `~/Library/Application Support/claude-code-pet`
  - Linux: `~/.config/claude-code-pet` (or `$XDG_CONFIG_HOME/claude-code-pet`)
  - This matches exactly what Electron's `app.getPath("userData")` returns on each platform
- **macOS**: `app.dock.hide()` keeps the app tray-only (no Dock icon)
- **Linux**: `enable-transparent-visuals` Chromium switch required for compositor transparency
- **Build scripts**: `npm run build` (current OS), `build:win`, `build:mac`, `build:linux`

## Speech Bubble System
- **pet.html**: Full speech system (~360+ messages) inline in `<script>`, CSS for `.speech-bubble`
- **main.js**: `readStatusFile()` parses JSON status, `speechBubblesEnabled` setting, tray toggle, `speech-toggle` IPC
- **hook.js**: `extractContext()` pulls file/command/query/error from hook data into JSON status file

### Architecture:
- Status file now writes **JSON**: `{"status":"coding","context":{"tool":"Edit","file":"src/App.tsx"}}`
- `readStatusFile()` has backward compat for plain string format
- Context flows: hook.js → status file (JSON) → main.js `readStatusFile()` → `status-change` IPC (status, context) → pet.html `generateSpeechMessage()`
- `writeStatus()` in main.js also writes JSON format (for manual tray menu triggers)

### Message types:
- **Generic**: random quips per state (25 for coding, 23 for thinking, etc.)
- **Context-aware**: `withFile(f)`, `withCommand(cmd)`, `withQuery(q)`, `withError(e)` — file-type humor, package names, git commands
- **Rare/easter eggs**: 15% chance (`RARE_CHANCE`)
- **Time-of-day**: late night, early morning, evening (12% chance)
- **Streak**: same state repeated N times triggers streak messages (50% chance)
- **Idle ambient**: chatter every 25s when idle (30% chance per tick)

### Key constants:
- `SPEECH_DURATION = 3500ms`, `SPEECH_COOLDOWN = 5000ms`, `SPEECH_CHANCE = 0.70`
- `showSpeechForced()` bypasses cooldown/chance — used for level-ups and achievements

### Gotcha — speech bubble positioning:
- Body has `overflow: hidden` — bubble must stay inside the scene bounds
- Use `top: 4px; transform: translateX(-50%)` — NOT `translateY(-100%)` which pushes it above the clipped area

## Mobile Relay Server
`relay-server.js` — WebSocket server that bridges your phone to Claude Code on your PC. Accepts prompts via WebSocket with token auth, spawns `claude -p` with stream-json output, streams results back, and broadcasts pet status changes so a mobile pet stays in sync.

### Running:
```bash
npm run relay                    # auto-generates a random auth token
npm run relay:dev                # uses RELAY_TOKEN=dev-token
RELAY_TOKEN="secret" RELAY_PROJECT_DIR="/path/to/project" node relay-server.js
```

### Env vars:
- `RELAY_PORT` — WebSocket port (default: 3777)
- `RELAY_TOKEN` — auth token (auto-generated if not set)
- `RELAY_PROJECT_DIR` — working directory for `claude -p` (default: cwd)

### Architecture:
- Phone connects via WebSocket, sends `{ type: "auth", token }` first
- Prompts queued if one is already running; supports cancel
- Watches the same pet status file the desktop app uses → broadcasts `pet_status` to phone
- See `MOBILE-RELAY.md` for full protocol docs, security notes, and Cloudflare Tunnel setup

### HTTP routes (for mobile client):
- `GET /mobile` → serves `mobile/index.html`
- `GET /characters` → JSON array of `{ id, name }` for all available characters
- `GET /characters/<name>/<file>` → character assets (PNGs, JSON) with MIME types
- Path traversal protection (rejects `..` and validates resolved paths)

### Gotchas — `claude -p` spawning:
- The relay spawns `claude -p` with `stdio: ["ignore", "pipe", "pipe"]` — **stdin must be closed** or the process hangs on Windows.
- The relay strips the `CLAUDECODE` env var from spawned processes to avoid the nested-session error when launched from inside a Claude Code session.
- `claude -p` can run alongside interactive Claude Code sessions — concurrency is fine.
- **Always run the relay in a separate terminal** (not spawned from within Claude Code's Bash tool, which inherits session state).

## Mobile Pet Page
`mobile/index.html` — self-contained HTML page served by the relay, renders the pet in a phone browser or Android WebView overlay.

### Features:
- **SpriteRenderer** adapted from pet.html — loads character assets over HTTP from relay server
- **Full speech system** — all 360+ messages, streaks, time-of-day, rare/easter eggs, idle chatter
- **RelayClient** — WebSocket to same origin, auto-reconnect with exponential backoff, ping/pong keepalive
- **Collapsed mode** (150×165): pet canvas, speech bubble, status dot, status label — tap to expand
- **Expanded mode** (320×500): smaller pet + scrolling output area + prompt input + send/cancel buttons
- **AndroidBridge** — calls `AndroidBridge.setExpanded(bool)` to resize native overlay window
- Token from URL param: `?token=xxx`, character: `?char=pixel-claude`
- Connection status dot: green (connected), red (disconnected), yellow (connecting)

### Testing in browser:
```
http://localhost:3777/mobile?token=dev-token
```

## Android Floating Pet App
`android/` — native Kotlin app with a floating WebView overlay that shows the mobile pet page.

### Project structure:
- `MainActivity.kt` — config screen (server URL + token inputs), overlay permission request, start/stop service
- `OverlayService.kt` — foreground service, floating WebView via WindowManager, drag handling, expand/collapse
- `PetPreferences.kt` — SharedPreferences wrapper for URL, token, character, overlay position

### Key details:
- **Overlay:** `TYPE_APPLICATION_OVERLAY`, `FLAG_NOT_FOCUSABLE` when collapsed, focusable when expanded
- **Drag:** touch listener with drag threshold, saves position to SharedPreferences
- **JS Bridge:** `AndroidBridge.setExpanded(bool)` resizes native overlay and toggles focus flags
- **Soft keyboard:** `SOFT_INPUT_ADJUST_RESIZE` in expanded mode allows text input
- **Permissions:** INTERNET, SYSTEM_ALERT_WINDOW, FOREGROUND_SERVICE, FOREGROUND_SERVICE_SPECIAL_USE
- **Build:** min SDK 26, target SDK 36, AGP 8.2.2, Kotlin 1.9.22

### Building APK:
```bash
cd android
# Windows CMD:
set JAVA_HOME=C:\Program Files\Android\Android Studio\jbr
set ANDROID_HOME=%LOCALAPPDATA%\Android\Sdk
.\gradlew.bat assembleDebug
# APK at: app/build/outputs/apk/debug/app-debug.apk

# Install via adb:
%ANDROID_HOME%\platform-tools\adb install app/build/outputs/apk/debug/app-debug.apk
```

### Usage:
1. Start relay in a **standalone terminal** (no Claude Code session running): `set RELAY_TOKEN=mytoken && node relay-server.js`
2. Open app on phone, enter `http://<pc-ip>:3777` + token
3. Grant overlay permission, tap Start Pet Overlay
4. Pet floats on screen, syncs animations live, tap to expand and send prompts

## All App States
idle, coding, thinking, success, error, searching, reading, debugging, installing, testing, deploying, cooking, hatching, deleting, downloading
