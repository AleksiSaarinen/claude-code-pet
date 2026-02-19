# Claude Code Pet - Dev Notes

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
- `setMinimumSize/setMaximumSize(200,220)` treats args as physical pixels → makes window tiny; don't use
- `screen.getCursorScreenPoint()` returns physical pixels; divide delta by `display.scaleFactor` before passing to `win.setPosition/setBounds`
- `webContents.setZoomFactor()` persists across restarts in `Preferences` file → always call `setZoomFactor(1.0)` in `did-finish-load` to override
- `maximizable: false` breaks client area on frameless transparent windows on Windows — avoid

### Window sizing (settings menu):
- Sizes: small 160×176, normal 200×220, large 400×440, xlarge 600×660 (logical px)
- Scaling uses CSS `transform: scale()` + updated html/body inline dimensions via `set-scale` IPC
- `win.setSize()` uses logical pixels (same as BrowserWindow constructor) ✓

## All App States
idle, coding, thinking, success, error, searching, reading, debugging, installing, testing, deploying, cooking, hatching, deleting, downloading
