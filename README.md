# Claude Code Pet

A desktop pet that comes alive based on your Claude Code activity. It hooks into Claude Code's event system to detect what you're doing — coding, thinking, debugging, searching — and responds with contextual animations, accessories, and particle effects.

Built with Electron. Runs on Windows.

![Electron](https://img.shields.io/badge/Electron-28-47848F?logo=electron&logoColor=white)
![Platform](https://img.shields.io/badge/Platform-Windows-0078D6?logo=windows&logoColor=white)

## Features

**Real-time activity detection** — Hooks into Claude Code events (`PreToolUse`, `UserPromptSubmit`, `Stop`, etc.) and classifies tools into activity states like coding, debugging, testing, deploying, and more.

**Rich animations** — Each activity state has unique body language, accessories (laptop, coffee mug, magnifying glass), and particle effects (code snippets, stars, music notes). Idle states cycle through moods: vibing, sleepy, coffee, stargazing.

**Progression system** — Earn XP while working. Level up your pet (1–25+) and 28 individual skills. Unlock visual tiers that change your pet's color scheme:

| Tier | Level | Name |
|------|-------|------|
| 0 | 1–4 | Hatchling (Brown) |
| 1 | 5–9 | Apprentice (Copper) |
| 2 | 10–14 | Adept (Silver-Blue) |
| 3 | 15–19 | Expert (Gold) |
| 4 | 20–24 | Master (Rose) |
| 5 | 25+ | Legendary (Prismatic) |

**Rare variants** — Higher tiers unlock rare activity animations like `coding-flow`, `thinking-eureka`, `debugging-detective`, `idle-dancing`, and more.

**Achievements** — 22 unlockable badges across four categories: coding activity milestones (sessions, time), skill levels, git stats (commits, merges, branches), and fun/rare events (night owl, marathon sessions). Achievements pop up as gold-bordered toasts and are browsable in the tray menu.

**Custom characters** — Swap the default CSS creature for custom sprite sheet or video-based characters. Built-in characters live in `characters/`, user-installed ones go in `%APPDATA%/claude-code-pet/characters/`. Switch via the tray menu.

## Install

```bash
npm install
```

## Usage

### Run in development

```bash
npm start
```

### Build Windows installer

```bash
npm run build
```

The installer is output to `dist/`.

### Hook setup

On first launch, the app offers to install hooks into `~/.claude/settings.json`. This lets it automatically detect Claude Code activity. You can also manage hooks from the system tray menu (right-click the tray icon).

### Manual status control

Set the pet's state manually via the tray menu or CLI:

```bash
npm run set-coding
npm run set-thinking
npm run set-debugging
npm run set-idle
npm run set-success
npm run set-error
```

## Mobile Relay

Control Claude Code from your phone. The relay server (`relay-server.js`) is a WebSocket bridge that accepts prompts from a mobile client, runs them through `claude -p`, and streams results back — while keeping the pet's status in sync so a mobile pet reacts in real-time.

```bash
npm run relay          # start the relay server (port 3777)
```

Set `RELAY_TOKEN` for a fixed auth token, and `RELAY_PROJECT_DIR` to point at your project. For remote access, use a Cloudflare Tunnel. See [MOBILE-RELAY.md](MOBILE-RELAY.md) for full setup and protocol docs.

## How it works

1. Claude Code fires hook events as you work (tool use, prompts, errors, completions)
2. `hook.js` classifies each event into an activity state (e.g., `Bash` with `npm test` → `testing`)
3. The status is written to a file in app data
4. The Electron app polls the file and updates the pet's animation state
5. XP accrues per second based on activity type, driving the progression system

## Project structure

```
├── main.js          Electron main process, hooks, progression, achievements
├── pet.html         UI, animations, particle systems, toasts
├── hook.js          Claude Code hook handler, tool classification
├── set-status.js    CLI helper to set pet status manually
├── watcher.js       Alternative watcher for Claude Code output
├── icon.png         App and tray icon
├── characters/      Custom sprite/video characters
└── package.json     Config, scripts, build settings
```

## License

MIT
