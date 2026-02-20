// main.js - Electron main process
const { app, BrowserWindow, Tray, Menu, screen, dialog, ipcMain } = require("electron");
const path = require("path");
const fs = require("fs");
const os = require("os");

// ── Hook Runner Mode ─────────────────────────────────────────────────────────
// When launched with --run-hook, act as the hook script and exit immediately.
// This uses Electron's bundled Node.js so users don't need Node.js installed.
const IS_HOOK_MODE = process.argv.includes("--run-hook");

// ── Log file ─────────────────────────────────────────────────────────────────
const LOG_FILE = path.join(app.getPath("userData"), "debug.log");
const _origLog = console.log.bind(console);
const _origErr = console.error.bind(console);
function writeLog(...args) {
  const line = `[${new Date().toISOString()}] ${args.join(" ")}\n`;
  try { fs.appendFileSync(LOG_FILE, line); } catch (e) {}
}
console.log = (...a) => { _origLog(...a); writeLog(...a); };
console.error = (...a) => { _origErr(...a); writeLog("ERROR", ...a); };
// Keep log under 200KB by trimming on startup
try {
  if (fs.existsSync(LOG_FILE) && fs.statSync(LOG_FILE).size > 200000) {
    const lines = fs.readFileSync(LOG_FILE, "utf8").split("\n");
    fs.writeFileSync(LOG_FILE, lines.slice(-500).join("\n"));
  }
} catch (e) {}

// Status file that controls the pet's state
const STATUS_FILE = path.join(
  app.getPath("userData"),
  "claude-pet-status.txt"
);
const PROGRESSION_FILE = path.join(
  app.getPath("userData"),
  "progression.json"
);
const CHARACTER_FILE = path.join(
  app.getPath("userData"),
  "selected-character.json"
);
const SETTINGS_FILE = path.join(
  app.getPath("userData"),
  "settings.json"
);

const WINDOW_SIZES = {
  small:  { w: 160, h: 176 },
  normal: { w: 200, h: 220 },
  large:  { w: 400, h: 440 },
  xlarge: { w: 600, h: 660 },
};
let windowSize = "normal";
let speechBubblesEnabled = true;

// Ensure status file exists
if (!fs.existsSync(STATUS_FILE)) fs.writeFileSync(STATUS_FILE, "idle");

if (IS_HOOK_MODE) {
  // Reuse classifyTool from hook.js
  // In packaged app, hook.js lives in resources/ (extraResources), not inside the asar
  const hookModulePath = app.isPackaged
    ? path.join(process.resourcesPath, "hook.js")
    : path.join(__dirname, "hook.js");
  const { classifyTool, extractContext } = require(hookModulePath);
  const hookEvent = process.argv[process.argv.indexOf("--run-hook") + 1];

  // Read stdin synchronously — Electron's async stdin doesn't work with pipes
  let input = "";
  try { input = fs.readFileSync(0, "utf-8"); } catch (e) {}

  let data = {};
  try { data = JSON.parse(input); } catch (e) {}

  let status = null;
  switch (hookEvent) {
    case "UserPromptSubmit": status = "thinking"; break;
    case "PreToolUse": status = classifyTool(data); break;
    case "PostToolUseFailure": status = "error"; break;
    case "Stop": status = "success"; break;
    case "Notification": status = "thinking"; break;
  }

  if (status) {
    try {
      const context = extractContext(hookEvent, data);
      fs.writeFileSync(STATUS_FILE, JSON.stringify({ status, context }));
    } catch (e) {}
  }
  app.exit(0);
}

let win, tray;
let dragInterval = null, dragInitCursor = null, dragInitWin = null;
let currentStatus = "idle";
let lastChangeTime = Date.now();
let currentIdleVariant = "idle";
let currentActivityVariant = null;
let currentContext = {};

// ── Progression System ──────────────────────────────────────────────────────

const XP_RATES = {
  coding: 5, debugging: 5,
  thinking: 3, testing: 3, deploying: 3,
  reading: 2, searching: 2,
  installing: 1, downloading: 1, cooking: 1,
  "idle-stretching": 1, "idle-dancing": 1, "idle-butterfly": 1,
  "idle-juggling": 1, "idle-rainbow": 1, "idle-meditation": 1,
  "coding-flow": 5, "coding-hacking": 5,
  "thinking-eureka": 3, "thinking-galaxy": 3,
  "debugging-detective": 5, "debugging-rage": 5,
  "searching-treasure": 2, "searching-deep": 2,
  "reading-scholar": 2, "reading-ancient": 2,
  "testing-scientist": 3, "testing-perfectionist": 3,
  "deploying-warp": 3, "deploying-satellite": 3,
  idle: 0, success: 0, error: 0, hatching: 0, deleting: 0,
};

const SKILL_ACTIVITIES = {
  coding: "coding", debugging: "debugging", thinking: "thinking",
  testing: "testing", deploying: "deploying", reading: "reading",
  searching: "searching", installing: "installing",
  "idle-stretching": "stretching", "idle-dancing": "dancing",
  "idle-butterfly": "wondering", "idle-juggling": "juggling",
  "idle-rainbow": "rainbow", "idle-meditation": "meditating",
  "coding-flow": "flow", "coding-hacking": "hacking",
  "thinking-eureka": "eureka", "thinking-galaxy": "galaxy brain",
  "debugging-detective": "detective", "debugging-rage": "rage",
  "searching-treasure": "treasure hunting", "searching-deep": "deep diving",
  "reading-scholar": "scholarship", "reading-ancient": "arcana",
  "testing-scientist": "science", "testing-perfectionist": "perfectionism",
  "deploying-warp": "warp", "deploying-satellite": "astronaut",
};

const TIER_NAMES = ["Hatchling", "Apprentice", "Adept", "Expert", "Master", "Legendary"];

// ── Achievement Definitions ──────────────────────────────────────────────────

const BASE_STATES = [
  "idle", "coding", "thinking", "success", "error", "searching", "reading",
  "debugging", "installing", "testing", "deploying", "cooking", "hatching",
  "deleting", "downloading",
];

const ACHIEVEMENT_DEFS = [
  // Coding Activity
  { id: "first_session", name: "First Steps", icon: "\u{1F476}", description: "Complete your first session", category: "activity",
    check: (d) => d.sessions >= 1 },
  { id: "sessions_10", name: "Regular", icon: "\u{1F4C5}", description: "Complete 10 sessions", category: "activity",
    check: (d) => d.sessions >= 10 },
  { id: "sessions_50", name: "Dedicated", icon: "\u{1F3C6}", description: "Complete 50 sessions", category: "activity",
    check: (d) => d.sessions >= 50 },
  { id: "time_1h", name: "Hour of Power", icon: "\u{23F1}\uFE0F", description: "1 hour active", category: "activity",
    check: (d) => d.totalTimeMs >= 3600000 },
  { id: "time_10h", name: "Tenacious", icon: "\u{1F4AA}", description: "10 hours active", category: "activity",
    check: (d) => d.totalTimeMs >= 36000000 },
  { id: "time_100h", name: "Centurion", icon: "\u{1F451}", description: "100 hours active", category: "activity",
    check: (d) => d.totalTimeMs >= 360000000 },
  { id: "all_states", name: "Jack of All Trades", icon: "\u{1F0CF}", description: "Trigger all 15 base states", category: "activity",
    check: (d) => {
      const triggered = d.achievements?.tracking?.statesTriggered || [];
      return BASE_STATES.every(s => triggered.includes(s));
    }},

  // Skill Milestones
  { id: "first_skill_5", name: "Apprentice", icon: "\u{1F393}", description: "Any skill reaches level 5", category: "skills",
    check: (d) => Object.values(d.skills).some(s => s.level >= 5) },
  { id: "first_skill_10", name: "Specialist", icon: "\u{1F3AF}", description: "Any skill reaches level 10", category: "skills",
    check: (d) => Object.values(d.skills).some(s => s.level >= 10) },
  { id: "skill_trio", name: "Triple Threat", icon: "\u{1F945}", description: "3 skills at level 5+", category: "skills",
    check: (d) => Object.values(d.skills).filter(s => s.level >= 5).length >= 3 },
  { id: "coding_master", name: "Code Machine", icon: "\u{1F916}", description: "Coding skill level 15", category: "skills",
    check: (d) => (d.skills.coding?.level || 0) >= 15 },
  { id: "polyglot", name: "Polyglot", icon: "\u{1F30D}", description: "8 skills at level 3+", category: "skills",
    check: (d) => Object.values(d.skills).filter(s => s.level >= 3).length >= 8 },
  { id: "legendary_pet", name: "Legendary", icon: "\u{2B50}", description: "Reach pet level 25", category: "skills",
    check: (d) => d.level >= 25 },

  // Git Milestones
  { id: "first_commit", name: "First Commit", icon: "\u{1F4DD}", description: "Make your first commit", category: "git",
    check: (d) => (d.achievements?.gitStats?.totalCommits || 0) >= 1 },
  { id: "commits_50", name: "Prolific", icon: "\u{1F4DA}", description: "50 commits", category: "git",
    check: (d) => (d.achievements?.gitStats?.totalCommits || 0) >= 50 },
  { id: "commits_200", name: "Commit Machine", icon: "\u{1F3ED}", description: "200 commits", category: "git",
    check: (d) => (d.achievements?.gitStats?.totalCommits || 0) >= 200 },
  { id: "first_merge", name: "Merger", icon: "\u{1F91D}", description: "Make a merge commit", category: "git",
    check: (d) => (d.achievements?.gitStats?.merges || 0) >= 1 },
  { id: "branches_3", name: "Branch Manager", icon: "\u{1F333}", description: "Work on 3+ branches", category: "git",
    check: (d) => (d.achievements?.gitStats?.branchesSeen?.length || 0) >= 3 },

  // Fun/Rare
  { id: "midnight_coder", name: "Night Owl", icon: "\u{1F989}", description: "Code between 12am-4am", category: "fun",
    check: () => { const h = new Date().getHours(); return h >= 0 && h < 4; }},
  { id: "early_bird", name: "Early Bird", icon: "\u{1F426}", description: "Code between 5am-7am", category: "fun",
    check: () => { const h = new Date().getHours(); return h >= 5 && h < 7; }},
  { id: "marathon", name: "Marathon", icon: "\u{1F3C3}", description: "2+ hour continuous session", category: "fun",
    check: (d) => (d.achievements?.tracking?.sessionActiveStreak || 0) >= 7200 },
  { id: "error_streak", name: "Resilient", icon: "\u{1F4A5}", description: "5 errors in one session, keep going", category: "fun",
    check: (d) => (d.achievements?.tracking?.sessionErrorCount || 0) >= 5 },
];

function skillXpNeeded(level) {
  return Math.floor(100 * level * 1.2);
}

function petXpNeeded(level) {
  return Math.floor(500 * level * 1.5);
}

function getTierIndex(level) {
  if (level >= 25) return 5;
  if (level >= 20) return 4;
  if (level >= 15) return 3;
  if (level >= 10) return 2;
  if (level >= 5) return 1;
  return 0;
}

const progression = {
  data: null,
  dirty: false,
  saveTimer: null,

  load() {
    try {
      if (fs.existsSync(PROGRESSION_FILE)) {
        this.data = JSON.parse(fs.readFileSync(PROGRESSION_FILE, "utf-8"));
      }
    } catch (e) { /* corrupt — recreate */ }
    if (!this.data || this.data.version !== 1) {
      this.data = {
        version: 1,
        totalXP: 0,
        level: 1,
        skills: {
          coding:     { xp: 0, level: 1 },
          thinking:   { xp: 0, level: 1 },
          debugging:  { xp: 0, level: 1 },
          searching:  { xp: 0, level: 1 },
          reading:    { xp: 0, level: 1 },
          testing:    { xp: 0, level: 1 },
          deploying:  { xp: 0, level: 1 },
          installing: { xp: 0, level: 1 },
          stretching: { xp: 0, level: 1 },
          dancing:    { xp: 0, level: 1 },
          wondering:  { xp: 0, level: 1 },
          juggling:   { xp: 0, level: 1 },
          rainbow:    { xp: 0, level: 1 },
          meditating: { xp: 0, level: 1 },
          flow:              { xp: 0, level: 1 },
          hacking:           { xp: 0, level: 1 },
          eureka:            { xp: 0, level: 1 },
          "galaxy brain":    { xp: 0, level: 1 },
          detective:         { xp: 0, level: 1 },
          rage:              { xp: 0, level: 1 },
          "treasure hunting": { xp: 0, level: 1 },
          "deep diving":     { xp: 0, level: 1 },
          scholarship:       { xp: 0, level: 1 },
          arcana:            { xp: 0, level: 1 },
          science:           { xp: 0, level: 1 },
          perfectionism:     { xp: 0, level: 1 },
          warp:              { xp: 0, level: 1 },
          astronaut:         { xp: 0, level: 1 },
        },
        totalTimeMs: 0,
        sessions: 0,
      };
    }
    // Migrate: ensure all skill keys exist for existing saves
    const requiredSkills = [
      "coding", "thinking", "debugging", "searching", "reading",
      "testing", "deploying", "installing",
      "stretching", "dancing", "wondering", "juggling", "rainbow", "meditating",
      "flow", "hacking", "eureka", "galaxy brain", "detective", "rage",
      "treasure hunting", "deep diving", "scholarship", "arcana",
      "science", "perfectionism", "warp", "astronaut",
    ];
    for (const sk of requiredSkills) {
      if (!this.data.skills[sk]) {
        this.data.skills[sk] = { xp: 0, level: 1 };
      }
    }

    // Migrate: ensure achievements structure exists
    if (!this.data.achievements) {
      this.data.achievements = {
        earned: {},
        gitStats: { totalCommits: 0, merges: 0, branchesSeen: [], lastPolledAt: null },
        tracking: { statesTriggered: [], sessionErrorCount: 0, sessionActiveStreak: 0, lastActiveTime: 0 },
      };
    }
    // Reset per-session trackers
    this.data.achievements.tracking.sessionErrorCount = 0;
    this.data.achievements.tracking.sessionActiveStreak = 0;
    this.data.achievements.tracking.lastActiveTime = 0;

    this.data.sessions++;
    this.dirty = true;
    // Debounced auto-save every 10s
    this.saveTimer = setInterval(() => {
      if (this.dirty) this.save();
    }, 10000);
  },

  save() {
    try {
      fs.writeFileSync(PROGRESSION_FILE, JSON.stringify(this.data, null, 2));
      this.dirty = false;
    } catch (e) { /* ignore */ }
  },

  tick(activity) {
    const rate = XP_RATES[activity] || 0;
    if (rate === 0) return;

    const xp = rate; // per-second tick
    this.data.totalXP += xp;
    this.data.totalTimeMs += 1000;
    this.dirty = true;

    const levelUps = [];

    // Skill XP
    const skillKey = SKILL_ACTIVITIES[activity];
    if (skillKey && this.data.skills[skillKey]) {
      const skill = this.data.skills[skillKey];
      skill.xp += xp;
      const needed = skillXpNeeded(skill.level);
      if (skill.xp >= needed) {
        skill.xp -= needed;
        skill.level++;
        levelUps.push({ type: "skill", skill: skillKey, level: skill.level });
      }
    }

    // Pet level XP — check cumulative threshold
    let cumNeeded = 0;
    for (let i = 1; i <= this.data.level; i++) cumNeeded += petXpNeeded(i);
    if (this.data.totalXP >= cumNeeded) {
      this.data.level++;
      levelUps.push({ type: "pet", level: this.data.level });
    }

    // Send level-up events
    if (levelUps.length > 0 && win) {
      for (const lu of levelUps) {
        win.webContents.send("level-up", lu);
      }
    }
  },

  getState() {
    const d = this.data;
    // Calculate XP progress toward next pet level (cumulative thresholds)
    let prevCum = 0;
    for (let i = 1; i < d.level; i++) prevCum += petXpNeeded(i);
    const currentLevelXP = d.totalXP - prevCum;
    const nextLevelXP = petXpNeeded(d.level);
    // Build achievements summary for renderer
    const earned = d.achievements ? d.achievements.earned : {};
    const earnedIds = Object.keys(earned);
    const recentAchievements = ACHIEVEMENT_DEFS
      .filter(def => earned[def.id])
      .sort((a, b) => (earned[b.id].unlockedAt || "").localeCompare(earned[a.id].unlockedAt || ""))
      .slice(0, 3)
      .map(def => ({ id: def.id, name: def.name, icon: def.icon }));
    const nextAchievements = ACHIEVEMENT_DEFS
      .filter(def => !earned[def.id])
      .slice(0, 3)
      .map(def => ({ id: def.id, name: def.name, icon: def.icon, description: def.description }));

    return {
      totalXP: d.totalXP,
      level: d.level,
      tierIndex: getTierIndex(d.level),
      tierName: TIER_NAMES[getTierIndex(d.level)],
      currentLevelXP: Math.max(0, currentLevelXP),
      nextLevelXP: nextLevelXP,
      skills: d.skills,
      totalTimeMs: d.totalTimeMs,
      sessions: d.sessions,
      achievementsEarned: earnedIds.length,
      achievementsTotal: ACHIEVEMENT_DEFS.length,
      recentAchievements,
      nextAchievements,
    };
  },

  checkAchievements() {
    const newlyUnlocked = [];
    for (const def of ACHIEVEMENT_DEFS) {
      if (this.data.achievements.earned[def.id]) continue;
      try {
        if (def.check(this.data)) {
          this.data.achievements.earned[def.id] = { unlockedAt: new Date().toISOString() };
          this.dirty = true;
          newlyUnlocked.push(def);
        }
      } catch (e) { /* skip broken check */ }
    }
    return newlyUnlocked;
  },

  trackStateChange(status) {
    const tracking = this.data.achievements.tracking;
    // Track unique base states triggered
    if (BASE_STATES.includes(status) && !tracking.statesTriggered.includes(status)) {
      tracking.statesTriggered.push(status);
      this.dirty = true;
    }
    // Count errors this session
    if (status === "error") {
      tracking.sessionErrorCount++;
      this.dirty = true;
    }
  },

  shutdown() {
    if (this.saveTimer) clearInterval(this.saveTimer);
    this.save();
  },
};

// ── Git Stats Polling ────────────────────────────────────────────────────────

function pollGitStats() {
  if (!progression.data) return;
  const { execSync } = require("child_process");
  const gs = progression.data.achievements.gitStats;
  try {
    const commits = parseInt(execSync("git rev-list --count --all", { timeout: 5000, encoding: "utf-8" }).trim(), 10);
    if (!isNaN(commits)) gs.totalCommits = commits;
  } catch (e) { /* not a git repo or git not available */ }
  try {
    const merges = parseInt(execSync("git rev-list --count --all --merges", { timeout: 5000, encoding: "utf-8" }).trim(), 10);
    if (!isNaN(merges)) gs.merges = merges;
  } catch (e) { /* ignore */ }
  try {
    const branch = execSync("git branch --show-current", { timeout: 5000, encoding: "utf-8" }).trim();
    if (branch && !gs.branchesSeen.includes(branch)) {
      gs.branchesSeen.push(branch);
    }
  } catch (e) { /* ignore */ }
  gs.lastPolledAt = new Date().toISOString();
  progression.dirty = true;
}

// ── Character System ─────────────────────────────────────────────────────────

let selectedCharacterId = "default";

function getCharacterDirs() {
  const dirs = [];
  // Built-in characters (in app directory or resources)
  const builtIn = app.isPackaged
    ? path.join(process.resourcesPath, "characters")
    : path.join(__dirname, "characters");
  if (fs.existsSync(builtIn)) dirs.push(builtIn);

  // User-installed characters
  const userDir = path.join(app.getPath("userData"), "characters");
  if (fs.existsSync(userDir)) dirs.push(userDir);

  return dirs;
}

function discoverCharacters() {
  const characters = [];
  for (const baseDir of getCharacterDirs()) {
    let entries;
    try { entries = fs.readdirSync(baseDir, { withFileTypes: true }); }
    catch (e) { continue; }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const configPath = path.join(baseDir, entry.name, "character.json");
      if (!fs.existsSync(configPath)) continue;
      try {
        const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
        characters.push({
          id: config.id || entry.name,
          name: config.name || entry.name,
          path: path.join(baseDir, entry.name),
        });
      } catch (e) { /* skip invalid */ }
    }
  }
  return characters;
}

function loadSelectedCharacter() {
  try {
    if (fs.existsSync(CHARACTER_FILE)) {
      const data = JSON.parse(fs.readFileSync(CHARACTER_FILE, "utf-8"));
      selectedCharacterId = data.id || "default";
    }
  } catch (e) { /* use default */ }
}

let savedWindowPos = null; // { x, y } restored from settings

function loadSettings() {
  try {
    if (fs.existsSync(SETTINGS_FILE)) {
      const data = JSON.parse(fs.readFileSync(SETTINGS_FILE, "utf-8"));
      if (data.windowSize && WINDOW_SIZES[data.windowSize]) windowSize = data.windowSize;
      if (data.windowPos && typeof data.windowPos.x === "number" && typeof data.windowPos.y === "number") {
        savedWindowPos = data.windowPos;
      }
      if (data.speechBubblesEnabled !== undefined) speechBubblesEnabled = data.speechBubblesEnabled;
    }
  } catch (e) { /* use defaults */ }
}

function saveSettings() {
  try {
    const obj = { windowSize, speechBubblesEnabled };
    if (win && !win.isDestroyed()) {
      const b = win.getBounds();
      obj.windowPos = { x: b.x, y: b.y };
    }
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(obj, null, 2));
  } catch (e) { /* ignore */ }
}

function saveSelectedCharacter(id) {
  selectedCharacterId = id;
  try {
    fs.writeFileSync(CHARACTER_FILE, JSON.stringify({ id }, null, 2));
  } catch (e) { /* ignore */ }
}

function applyCharacter(charInfo) {
  if (!win) return;
  if (!charInfo || charInfo.id === "default") {
    win.webContents.send("set-character", { id: "default" });
  } else {
    // Convert path to file:// URL for fetch() in renderer
    const charPath = charInfo.path.replace(/\\/g, "/");
    win.webContents.send("set-character", {
      id: charInfo.id,
      name: charInfo.name,
      path: charPath,
    });
  }
}

// ── Hook Setup ──────────────────────────────────────────────────────────────

function getHookPath() {
  const dest = path.join(app.getPath("userData"), "hook.js");
  // Copy the latest hook.js to userData so the path is stable after install
  try {
    fs.copyFileSync(path.join(__dirname, "hook.js"), dest);
  } catch (e) {
    // In packaged app __dirname is inside asar; file should already exist
  }
  return dest.replace(/\\/g, "/"); // forward slashes for shell commands
}

function getNodePath() {
  // Use absolute path to node so hooks work in VS Code and other environments
  // where PATH may not include Node.js
  const nodePath = process.execPath;
  // If running in Electron, process.execPath is the Electron binary, not node.
  // Fall back to finding node on PATH via 'where' (Windows) or 'which' (Unix).
  if (nodePath.toLowerCase().includes("electron") || nodePath.toLowerCase().includes("claude-code-pet")) {
    try {
      const cmd = process.platform === "win32" ? "where node" : "which node";
      const result = require("child_process").execSync(cmd, { encoding: "utf-8" }).trim();
      // 'where' on Windows can return multiple lines; take the first
      const firstLine = result.split(/\r?\n/)[0];
      return firstLine.replace(/\\/g, "/");
    } catch (e) {
      return "node"; // fallback to bare node if we can't find it
    }
  }
  return nodePath.replace(/\\/g, "/");
}

function getHookCommand() {
  if (app.isPackaged) {
    // In packaged app, use our own exe as the hook runner (no Node.js needed)
    const exePath = app.getPath("exe").replace(/\\/g, "/");
    return `"${exePath}" --run-hook`;
  }
  // In dev mode, fall back to system Node.js + hook.js (devs have Node.js)
  const hookPath = getHookPath();
  const nodePath = getNodePath();
  return `"${nodePath}" "${hookPath}"`;
}

function setupHooks() {
  const claudeDir = path.join(os.homedir(), ".claude");
  const settingsPath = path.join(claudeDir, "settings.json");

  // Read existing settings (preserve everything the user already has)
  let settings = {};
  try {
    if (fs.existsSync(settingsPath)) {
      settings = JSON.parse(fs.readFileSync(settingsPath, "utf-8"));
    }
  } catch (e) {
    // corrupt file – start fresh but we'll merge back
  }

  if (!settings.hooks) settings.hooks = {};

  const MARKER = "claude-code-pet"; // our hooks contain this in the path

  // Events we hook into and whether they support a matcher
  const events = [
    { name: "UserPromptSubmit", hasMatcher: false },
    { name: "PreToolUse", hasMatcher: true },
    { name: "PostToolUseFailure", hasMatcher: true },
    { name: "Stop", hasMatcher: false },
    { name: "Notification", hasMatcher: true },
  ];

  for (const { name, hasMatcher } of events) {
    if (!Array.isArray(settings.hooks[name])) settings.hooks[name] = [];

    // Remove any previously-installed pet hooks (idempotent re-setup)
    settings.hooks[name] = settings.hooks[name].filter(
      (rule) => !JSON.stringify(rule).includes(MARKER)
    );

    // Build our hook entry
    const hookCmd = getHookCommand();
    const entry = {
      hooks: [
        {
          type: "command",
          command: `${hookCmd} ${name}`,
          timeout: 10,
          async: true, // don't block Claude – we just write a file
        },
      ],
    };
    if (hasMatcher) entry.matcher = "";

    settings.hooks[name].push(entry);
  }

  // Write back
  fs.mkdirSync(claudeDir, { recursive: true });
  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
}

function removeHooks() {
  const settingsPath = path.join(os.homedir(), ".claude", "settings.json");
  if (!fs.existsSync(settingsPath)) return;

  const MARKER = "claude-code-pet";
  let settings;
  try {
    settings = JSON.parse(fs.readFileSync(settingsPath, "utf-8"));
  } catch (e) {
    return;
  }
  if (!settings.hooks) return;

  for (const event of Object.keys(settings.hooks)) {
    if (Array.isArray(settings.hooks[event])) {
      settings.hooks[event] = settings.hooks[event].filter(
        (rule) => !JSON.stringify(rule).includes(MARKER)
      );
    }
  }

  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
}

// ── Window ──────────────────────────────────────────────────────────────────

function applyWindowSize(size) {
  const sz = WINDOW_SIZES[size];
  if (!sz || !win || win.isDestroyed()) return;
  if (dragInterval) { clearInterval(dragInterval); dragInterval = null; }
  windowSize = size;
  saveSettings();
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;
  const targetScale = sz.w / 200;
  win.setBounds({ x: width - sz.w - 20, y: height - sz.h - 20, width: sz.w, height: sz.h });
  setTimeout(() => {
    if (!win || win.isDestroyed()) return;
    win.webContents.send("set-scale", targetScale);
  }, 80);
}

function createWindow() {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;
  const sz = WINDOW_SIZES[windowSize] || WINDOW_SIZES.normal;
  const startX = savedWindowPos ? savedWindowPos.x : width - sz.w - 20;
  const startY = savedWindowPos ? savedWindowPos.y : height - sz.h - 20;

  win = new BrowserWindow({
    width: sz.w,
    height: sz.h,
    x: startX,
    y: startY,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    resizable: false,
    skipTaskbar: true,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      zoomFactor: 1.0,
    },
  });

  win.loadFile("pet.html");
  win.setAlwaysOnTop(true, "screen-saver");
  win.setIgnoreMouseEvents(false);

  // Save position whenever the window is moved (covers native -webkit-app-region drag)
  win.on("moved", () => { saveSettings(); });

  // Apply saved character once renderer is ready
  win.webContents.on("did-finish-load", () => {
    // Always reset zoom first (prevents Chromium from restoring a stale persisted zoom)
    win.webContents.setZoomFactor(1.0);
    const _sz = WINDOW_SIZES[windowSize] || WINDOW_SIZES.normal;
    const disp = screen.getPrimaryDisplay();
    console.log('startup — windowSize:', windowSize, 'bounds:', JSON.stringify(win.getBounds()), 'scaleFactor:', disp.scaleFactor, 'zoom:', win.webContents.getZoomFactor());
    win.webContents.executeJavaScript('JSON.stringify({innerW:window.innerWidth,innerH:window.innerHeight,dpr:window.devicePixelRatio})').then(r => console.log('renderer viewport:', r));
    win.webContents.send("set-scale", _sz.w / 200);
    win.webContents.send("speech-toggle", speechBubblesEnabled);
    if (selectedCharacterId !== "default") {
      const chars = discoverCharacters();
      const selected = chars.find(c => c.id === selectedCharacterId);
      if (selected) {
        applyCharacter(selected);
      } else {
        // Character folder was deleted — revert to default
        saveSelectedCharacter("default");
      }
    }
  });

  // Watch status file for immediate reaction
  fs.watch(STATUS_FILE, () => {
    try {
      const { status, context } = readStatusFile();
      if (status !== currentStatus) {
        currentStatus = status;
        currentContext = context;
        lastChangeTime = Date.now();
        progression.trackStateChange(status);
        win.webContents.send("status-change", status, context);
        win.webContents.send("status-update", {
          status: currentStatus,
          context: currentContext,
          progression: progression.getState(),
        });
      }
    } catch (e) {
      // ignore
    }
  });

  // Poll every second as backup + handle auto-idle revert + XP ticks
  setInterval(() => {
    try {
      const { status, context } = readStatusFile();

      if (status !== currentStatus) {
        currentStatus = status;
        currentContext = context;
        lastChangeTime = Date.now();
        progression.trackStateChange(status);
        win.webContents.send("status-change", status, context);
      }

      // Award XP for current activity (use variant when active)
      let tickActivity;
      if (currentActivityVariant && currentStatus !== "idle") {
        tickActivity = currentActivityVariant;
      } else if (currentStatus === "idle" && currentIdleVariant !== "idle") {
        tickActivity = currentIdleVariant;
      } else {
        tickActivity = currentStatus;
      }
      progression.tick(tickActivity);

      // Marathon tracking: increment streak when active, reset if idle 5+ min
      const tracking = progression.data.achievements.tracking;
      const isActive = currentStatus !== "idle" && currentStatus !== "success" && currentStatus !== "error";
      if (isActive) {
        tracking.sessionActiveStreak++;
        tracking.lastActiveTime = Date.now();
      } else if (tracking.lastActiveTime > 0 && Date.now() - tracking.lastActiveTime > 300000) {
        tracking.sessionActiveStreak = 0;
      }

      // Check achievements (skip toasts if bulk unlock on migration)
      const newAchievements = progression.checkAchievements();
      if (newAchievements.length <= 3) {
        for (const ach of newAchievements) {
          win.webContents.send("achievement-unlocked", {
            id: ach.id, name: ach.name, icon: ach.icon, description: ach.description,
          });
        }
      }

      // Send progression update every tick so UI stays in sync
      win.webContents.send("status-update", {
        status: currentStatus,
        progression: progression.getState(),
      });

      const elapsed = Date.now() - lastChangeTime;

      // Auto-revert transient states → idle after timeout
      const quickRevert = ["success", "error"];
      const slowRevert = [
        "thinking", "coding", "searching", "reading", "debugging",
        "installing", "testing", "deploying", "cooking", "hatching",
        "deleting", "downloading",
      ];

      if (quickRevert.includes(currentStatus) && elapsed > 5000) {
        writeStatus("idle");
      } else if (slowRevert.includes(currentStatus) && elapsed > 120_000) {
        writeStatus("idle");
      }
    } catch (e) {
      // ignore
    }
  }, 1000);
}

// ── Tray ────────────────────────────────────────────────────────────────────

function formatTime(ms) {
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function buildStatsSubmenu() {
  const s = progression.getState();
  const skillItems = Object.entries(s.skills)
    .filter(([, v]) => v.level > 1 || v.xp > 0)
    .sort((a, b) => b[1].level - a[1].level || b[1].xp - a[1].xp)
    .map(([name, v]) => ({
      label: `  ${name.charAt(0).toUpperCase() + name.slice(1)}: Lv ${v.level}`,
      enabled: false,
    }));
  if (skillItems.length === 0) {
    skillItems.push({ label: "  No skills leveled yet", enabled: false });
  }
  return [
    { label: `Level ${s.level} — ${s.tierName}`, enabled: false },
    { label: `XP: ${s.currentLevelXP.toLocaleString()} / ${s.nextLevelXP.toLocaleString()}`, enabled: false },
    { type: "separator" },
    ...skillItems,
    { type: "separator" },
    { label: `Time Active: ${formatTime(s.totalTimeMs)}`, enabled: false },
  ];
}

function buildCharacterSubmenu(hooksActive) {
  const characters = discoverCharacters();
  const items = [
    {
      label: "Default (CSS Creature)",
      type: "radio",
      checked: selectedCharacterId === "default",
      click: () => {
        saveSelectedCharacter("default");
        applyCharacter(null);
        tray.setContextMenu(buildTrayMenu(hooksActive));
      },
    },
  ];
  for (const char of characters) {
    items.push({
      label: char.name,
      type: "radio",
      checked: selectedCharacterId === char.id,
      click: () => {
        saveSelectedCharacter(char.id);
        applyCharacter(char);
        tray.setContextMenu(buildTrayMenu(hooksActive));
      },
    });
  }
  return items;
}

function buildAchievementsSubmenu() {
  const earned = progression.data.achievements.earned;
  const earnedCount = Object.keys(earned).length;
  const total = ACHIEVEMENT_DEFS.length;
  const categories = { activity: "Coding Activity", skills: "Skill Milestones", git: "Git Milestones", fun: "Fun / Rare" };
  const items = [
    { label: `${earnedCount} / ${total} Unlocked`, enabled: false },
    { type: "separator" },
  ];
  for (const [catKey, catLabel] of Object.entries(categories)) {
    items.push({ label: catLabel, enabled: false });
    const defs = ACHIEVEMENT_DEFS.filter(d => d.category === catKey);
    for (const def of defs) {
      const isEarned = !!earned[def.id];
      items.push({
        label: isEarned ? `${def.icon} ${def.name}` : `    ${def.name}`,
        type: "checkbox",
        checked: isEarned,
        enabled: false,
      });
    }
    items.push({ type: "separator" });
  }
  return items;
}

function buildTrayMenu(hooksActive) {
  return Menu.buildFromTemplate([
    {
      label: hooksActive ? "Auto-detect Active" : "Auto-detect Off",
      enabled: false,
    },
    {
      label: "Re-setup Hooks",
      click: () => {
        try {
          setupHooks();
          tray.setContextMenu(buildTrayMenu(true));
          dialog.showMessageBox({
            message:
              "Hooks installed successfully!\nRestart any running Claude Code sessions for changes to take effect.",
            type: "info",
            title: "Claude Code Pet",
          });
        } catch (e) {
          dialog.showErrorBox("Hook Setup Failed", e.message);
        }
      },
    },
    {
      label: "Remove Hooks",
      click: () => {
        try {
          removeHooks();
          tray.setContextMenu(buildTrayMenu(false));
        } catch (e) {
          // ignore
        }
      },
    },
    { type: "separator" },
    {
      label: "Stats",
      submenu: buildStatsSubmenu(),
    },
    {
      label: "Achievements",
      submenu: buildAchievementsSubmenu(),
    },
    {
      label: "Character",
      submenu: buildCharacterSubmenu(hooksActive),
    },
    {
      label: "Speech Bubbles",
      type: "checkbox",
      checked: speechBubblesEnabled,
      click: (item) => {
        speechBubblesEnabled = item.checked;
        win.webContents.send("speech-toggle", speechBubblesEnabled);
        saveSettings();
      },
    },
    { type: "separator" },
    {
      label: "Manual",
      submenu: [
        { label: "Idle", click: () => writeStatus("idle") },
        { label: "Thinking", click: () => writeStatus("thinking") },
        { label: "Coding", click: () => writeStatus("coding") },
        { label: "Success", click: () => writeStatus("success") },
        { label: "Error", click: () => writeStatus("error") },
        { type: "separator" },
        { label: "Searching", click: () => writeStatus("searching") },
        { label: "Reading", click: () => writeStatus("reading") },
        { label: "Debugging", click: () => writeStatus("debugging") },
        { label: "Installing", click: () => writeStatus("installing") },
        { label: "Testing", click: () => writeStatus("testing") },
        { label: "Deploying", click: () => writeStatus("deploying") },
        { label: "Cooking", click: () => writeStatus("cooking") },
        { label: "Hatching", click: () => writeStatus("hatching") },
        { label: "Deleting", click: () => writeStatus("deleting") },
        { label: "Downloading", click: () => writeStatus("downloading") },
      ],
    },
    { type: "separator" },
    { label: "Quit", click: () => app.quit() },
  ]);
}

// ── App lifecycle ───────────────────────────────────────────────────────────

if (process.platform === "linux") {
  app.commandLine.appendSwitch("enable-transparent-visuals");
}

if (process.platform === "darwin" && app.dock) app.dock.hide();

app.whenReady().then(() => {
  if (IS_HOOK_MODE) return; // Hook runner handles everything above

  // Load progression data
  progression.load();
  loadSelectedCharacter();

  // Character switching from renderer
  ipcMain.handle("get-characters", () => {
    const chars = discoverCharacters();
    return { characters: chars.map(c => ({ id: c.id, name: c.name })), selected: selectedCharacterId };
  });

  ipcMain.handle("get-settings", () => {
    const chars = discoverCharacters();
    return {
      characters: chars.map(c => ({ id: c.id, name: c.name })),
      selected: selectedCharacterId,
      windowSize,
    };
  });

  ipcMain.on("set-window-size", (e, size) => applyWindowSize(size));

  ipcMain.on("get-speech-enabled", (e) => {
    e.returnValue = speechBubblesEnabled;
  });

  ipcMain.on("switch-character", (e, id) => {
    saveSelectedCharacter(id);
    if (id === "default") {
      applyCharacter(null);
    } else {
      const chars = discoverCharacters();
      const found = chars.find(c => c.id === id);
      if (found) applyCharacter(found);
    }
    // Rebuild tray menu to reflect new selection
    if (tray) tray.setContextMenu(buildTrayMenu(hooksActive));
  });

  // Listen for idle variant changes from the renderer
  ipcMain.on("idle-variant-change", (e, variant) => {
    currentIdleVariant = variant;
  });

  // Listen for activity variant changes from the renderer
  ipcMain.on("activity-variant-change", (e, variant) => {
    currentActivityVariant = variant;
  });

  // Window drag for model canvas (avoids DPI coordinate issues by polling in main)
  ipcMain.on("start-window-drag", () => {
    if (dragInterval) { clearInterval(dragInterval); dragInterval = null; } // prevent stacking
    dragInitCursor = screen.getCursorScreenPoint();
    const b = win.getBounds();
    // Use the saved target size (not current bounds which may still be animating)
    const sz = WINDOW_SIZES[windowSize] || WINDOW_SIZES.normal;
    dragInitWin = { x: b.x, y: b.y, w: sz.w, h: sz.h };
    dragInterval = setInterval(() => {
      if (!win || win.isDestroyed()) { clearInterval(dragInterval); dragInterval = null; return; }
      const cur = screen.getCursorScreenPoint();
      const sf = screen.getDisplayNearestPoint(cur).scaleFactor || 1;
      win.setBounds({
        x: dragInitWin.x + Math.round((cur.x - dragInitCursor.x) / sf),
        y: dragInitWin.y + Math.round((cur.y - dragInitCursor.y) / sf),
        width: dragInitWin.w,
        height: dragInitWin.h,
      });
    }, 16);
  });
  ipcMain.on("stop-window-drag", () => {
    if (dragInterval) { clearInterval(dragInterval); dragInterval = null; }
    saveSettings();
  });

  // Auto-setup hooks on launch
  let hooksActive = false;
  try {
    setupHooks();
    hooksActive = true;
  } catch (e) {
    console.error("Could not auto-setup hooks:", e.message);
  }

  loadSettings();
  createWindow();

  // System tray
  tray = new Tray(path.join(__dirname, "icon.png"));
  tray.setToolTip("Claude Code Pet");
  tray.setContextMenu(buildTrayMenu(hooksActive));

  // Refresh tray menu periodically so stats stay current
  setInterval(() => {
    try { tray.setContextMenu(buildTrayMenu(hooksActive)); } catch (e) { /* ignore */ }
  }, 15000);

  // Git stats polling — initial poll after 5s, then every 60s
  setTimeout(pollGitStats, 5000);
  setInterval(pollGitStats, 60000);
});

function readStatusFile() {
  const raw = fs.readFileSync(STATUS_FILE, "utf-8").trim();
  try {
    const parsed = JSON.parse(raw);
    return { status: parsed.status || raw, context: parsed.context || {} };
  } catch {
    // Backward compat: plain string format
    return { status: raw, context: {} };
  }
}

function writeStatus(s) {
  fs.writeFileSync(STATUS_FILE, JSON.stringify({ status: s, context: {} }));
}

app.on("before-quit", () => {
  saveSettings();
  progression.shutdown();
});

app.on("window-all-closed", () => app.quit());
