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

## All App States
idle, coding, thinking, success, error, searching, reading, debugging, installing, testing, deploying, cooking, hatching, deleting, downloading
