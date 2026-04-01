// main.js - Electron main process
const { app, BrowserWindow, Tray, Menu, screen, dialog, ipcMain, nativeImage, shell } = require("electron");
const { exec } = require("child_process");
const path = require("path");
const fs = require("fs");
const os = require("os");

// ── Hook Runner Mode ─────────────────────────────────────────────────────────
// When launched with --run-hook, act as the hook script and exit immediately.
// This uses Electron's bundled Node.js so users don't need Node.js installed.
const IS_HOOK_MODE = process.argv.includes("--run-hook");

// Hide dock icon immediately in hook mode so it doesn't flash in the dock
if (IS_HOOK_MODE && process.platform === "darwin" && app.dock) {
  app.dock.hide();
}

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
let floatingPetVisible = true;
let githubRepo = "Frogmind/altegro";
let hooksActiveGlobal = false; // module-level mirror for use in async callbacks

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

// ── Demo Mode ───────────────────────────────────────────────────────────────

let demoActive = false;
let demoInterval = null;
let demoIndex = 0;

const DEMO_SEQUENCE = [
  // Idle variants
  { variant: "idle",            base: "idle" },
  { variant: "idle-vibing",     base: "idle" },
  { variant: "idle-sleepy",     base: "idle" },
  { variant: "idle-coffee",     base: "idle" },
  { variant: "idle-stargazing", base: "idle" },
  // Coding
  { variant: "coding",         base: "coding" },
  { variant: "coding-flow",    base: "coding" },
  { variant: "coding-hacking", base: "coding" },
  // Thinking
  { variant: "thinking",          base: "thinking" },
  { variant: "thinking-eureka",   base: "thinking" },
  { variant: "thinking-galaxy",   base: "thinking" },
  { variant: "thinking-exploring", base: "thinking" },
  // Searching
  { variant: "searching",          base: "searching" },
  { variant: "searching-treasure", base: "searching" },
  { variant: "searching-deep",     base: "searching" },
  // Reading
  { variant: "reading",         base: "reading" },
  { variant: "reading-scholar",  base: "reading" },
  { variant: "reading-ancient",  base: "reading" },
  // Debugging
  { variant: "debugging",           base: "debugging" },
  { variant: "debugging-detective",  base: "debugging" },
  { variant: "debugging-rage",      base: "debugging" },
  // Testing
  { variant: "testing",              base: "testing" },
  { variant: "testing-scientist",    base: "testing" },
  { variant: "testing-perfectionist", base: "testing" },
  // Deploying
  { variant: "deploying",           base: "deploying" },
  { variant: "deploying-satellite",  base: "deploying" },
  { variant: "deploying-warp",      base: "deploying" },
  // Single states
  { variant: "installing",  base: "installing" },
  { variant: "cooking",     base: "cooking" },
  { variant: "hatching",    base: "hatching" },
  { variant: "deleting",    base: "deleting" },
  { variant: "downloading", base: "downloading" },
  // Transient
  { variant: "success", base: "success" },
  { variant: "error",   base: "error" },
  // Rare idle variants
  { variant: "idle-stretching",  base: "idle" },
  { variant: "idle-dancing",     base: "idle" },
  { variant: "idle-butterfly",   base: "idle" },
  { variant: "idle-juggling",    base: "idle" },
  { variant: "idle-rainbow",     base: "idle" },
  { variant: "idle-meditation",  base: "idle" },
];

function startDemoMode() {
  demoActive = true;
  demoIndex = 0;
  console.log("Demo mode started — cycling through", DEMO_SEQUENCE.length, "states");
  // Show first state immediately
  advanceDemo();
  demoInterval = setInterval(advanceDemo, 6000);
}

function advanceDemo() {
  if (!win || win.isDestroyed()) return;
  const entry = DEMO_SEQUENCE[demoIndex];
  demoIndex = (demoIndex + 1) % DEMO_SEQUENCE.length;
  console.log("Demo:", entry.variant);
  win.webContents.send("force-variant", { variant: entry.variant, baseState: entry.base });
}

function stopDemoMode() {
  demoActive = false;
  if (demoInterval) { clearInterval(demoInterval); demoInterval = null; }
  demoIndex = 0;
  console.log("Demo mode stopped");
  writeStatus("idle");
}

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
      if (data.floatingPetVisible !== undefined) floatingPetVisible = data.floatingPetVisible;
      if (data.githubRepo) githubRepo = data.githubRepo;
    }
  } catch (e) { /* use defaults */ }
}

function saveSettings() {
  try {
    const obj = { windowSize, speechBubblesEnabled, floatingPetVisible, githubRepo };
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
  // Also load character for dock icon animation
  loadDockCharacter(charInfo);
}

// ── Dock Icon Animation (macOS) ─────────────────────────────────────────────

let dockFrames = {};      // { stateName: [NativeImage, ...] }
let dockCharConfig = null; // character.json data
let dockCharPath = null;   // character directory path
let dockAnimTimer = null;
let dockCurrentState = "idle";
let dockCurrentFrame = 0;
const DOCK_SIZE = 128;     // dock icon size

function extractSpriteFrames(pngPath, frameWidth, frameHeight, frameCount) {
  try {
    const pngData = fs.readFileSync(pngPath);
    const fullImg = nativeImage.createFromBuffer(pngData);
    const fullSize = fullImg.getSize();
    const frames = [];

    // We need to crop each frame from the sprite sheet
    // NativeImage can crop via toBitmap + manual extraction
    const bitmap = fullImg.toBitmap();
    const bpp = 4; // bytes per pixel (RGBA)

    for (let i = 0; i < frameCount; i++) {
      const srcX = i * frameWidth;
      if (srcX + frameWidth > fullSize.width) break;

      // Extract frame pixels from bitmap row by row
      const frameBuf = Buffer.alloc(frameWidth * frameHeight * bpp);
      for (let y = 0; y < frameHeight && y < fullSize.height; y++) {
        const srcOffset = (y * fullSize.width + srcX) * bpp;
        const dstOffset = y * frameWidth * bpp;
        bitmap.copy(frameBuf, dstOffset, srcOffset, srcOffset + frameWidth * bpp);
      }

      const frameImg = nativeImage.createFromBuffer(frameBuf, {
        width: frameWidth,
        height: frameHeight,
      });
      // Resize to dock size
      const resized = frameImg.resize({ width: DOCK_SIZE, height: DOCK_SIZE, quality: 'good' });
      frames.push(resized);
    }
    return frames;
  } catch (e) {
    console.log("dock: failed to extract frames from", pngPath, e.message);
    return [];
  }
}

function loadDockCharacter(charInfo) {
  if (process.platform !== "darwin" || !app.dock) return;
  if (!charInfo || charInfo.id === "default") {
    dockFrames = {};
    dockCharConfig = null;
    dockCharPath = null;
    return;
  }

  try {
    const configPath = path.join(charInfo.path, "character.json");
    const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    dockCharConfig = config;
    dockCharPath = charInfo.path;
    dockFrames = {};

    const fw = config.frameWidth || 120;
    const fh = config.frameHeight || 120;

    for (const [stateName, stateInfo] of Object.entries(config.states || {})) {
      const spritePath = path.join(charInfo.path, stateInfo.file);
      if (fs.existsSync(spritePath)) {
        dockFrames[stateName] = extractSpriteFrames(spritePath, fw, fh, stateInfo.frameCount || 1);
      }
    }

    console.log("dock: loaded character", charInfo.id, "states:", Object.keys(dockFrames).join(", "));
    setDockState("idle");
  } catch (e) {
    console.log("dock: failed to load character", e.message);
  }
}

function resolveState(stateName) {
  if (dockFrames[stateName] && dockFrames[stateName].length > 0) return stateName;
  if (dockCharConfig && dockCharConfig.fallbackMap && dockCharConfig.fallbackMap[stateName]) {
    const fb = dockCharConfig.fallbackMap[stateName];
    if (dockFrames[fb] && dockFrames[fb].length > 0) return fb;
  }
  return "idle";
}

function setDockState(stateName) {
  if (process.platform !== "darwin" || !app.dock) return;
  const resolved = resolveState(stateName);
  if (resolved === dockCurrentState && dockAnimTimer) return;

  dockCurrentState = resolved;
  dockCurrentFrame = 0;

  if (dockAnimTimer) {
    clearInterval(dockAnimTimer);
    dockAnimTimer = null;
  }

  const frames = dockFrames[resolved];
  if (!frames || frames.length === 0) return;

  // Set first frame immediately
  try { app.dock.setIcon(frames[0]); } catch (e) {}

  if (frames.length > 1) {
    const duration = (dockCharConfig && dockCharConfig.states[resolved] && dockCharConfig.states[resolved].frameDuration) || 150;
    dockAnimTimer = setInterval(() => {
      dockCurrentFrame = (dockCurrentFrame + 1) % frames.length;
      try { app.dock.setIcon(frames[dockCurrentFrame]); } catch (e) {}
    }, duration);
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
  if (nodePath.toLowerCase().includes("electron") || nodePath.toLowerCase().includes("claude-code-pet") || nodePath.toLowerCase().includes("claude code pet")) {
    // On macOS/Linux, check common node locations first (shell PATH may not be
    // available when Electron launches at login before the user's shell profile)
    if (process.platform !== "win32") {
      const commonPaths = [
        path.join(os.homedir(), ".local/bin/node"),
        path.join(os.homedir(), ".nvm/current/bin/node"),
        "/usr/local/bin/node",
        "/opt/homebrew/bin/node",
      ];
      for (const p of commonPaths) {
        if (fs.existsSync(p)) return p.replace(/\\/g, "/");
      }
    }
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
  // Always use Node.js + hook.js to avoid Electron dock icon flash on macOS
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

  // Prevent minimize — transparent frameless pet should always be visible.
  // Clicking the taskbar icon triggers minimize; intercept and just re-show.
  win.on("minimize", () => {
    win.restore();
    if (floatingPetVisible) win.show();
  });

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
    if (!floatingPetVisible) win.hide();
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

  // Watch status file for immediate reaction (skip during demo mode)
  fs.watch(STATUS_FILE, () => {
    if (demoActive) return;
    try {
      const { status, context } = readStatusFile();
      if (status !== currentStatus) {
        currentStatus = status;
        currentContext = context;
        lastChangeTime = Date.now();
        progression.trackStateChange(status);
        setDockState(status);
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
      // Skip status file polling during demo mode (force-variant controls renderer)
      if (!demoActive) {
        const { status, context } = readStatusFile();

        if (status !== currentStatus) {
          currentStatus = status;
          currentContext = context;
          lastChangeTime = Date.now();
          progression.trackStateChange(status);
          setDockState(status);
          win.webContents.send("status-change", status, context);
        }
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

      // Auto-revert transient states → idle after timeout (skip during demo)
      if (!demoActive) {
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

// ── Deploy Status (GitHub Actions) ──────────────────────────────────────────

let cachedWorkflowRuns = [];
let deployFetchInProgress = false;

function refreshDeployStatus(callback) {
  if (deployFetchInProgress || !githubRepo) { if (callback) callback(); return; }
  deployFetchInProgress = true;
  const ghPath = process.platform === "darwin" ? "/opt/homebrew/bin/gh" : "gh";
  exec(
    `${ghPath} api 'repos/${githubRepo}/actions/runs?per_page=10' --cache 30s`,
    { encoding: "utf-8", timeout: 15000 },
    (err, stdout) => {
      deployFetchInProgress = false;
      if (err) {
        console.error("Deploy status fetch failed:", err.message);
        if (callback) callback();
        return;
      }
      try {
        const data = JSON.parse(stdout);
        cachedWorkflowRuns = (data.workflow_runs || []).map(r => ({
          id: r.id,
          name: r.name,
          status: r.status,
          conclusion: r.conclusion,
          head_branch: r.head_branch,
          display_title: r.display_title,
          run_number: r.run_number,
          created_at: r.created_at,
          actor: r.actor?.login || "unknown",
          html_url: r.html_url,
        }));
        console.log("Deploy status refreshed:", cachedWorkflowRuns.length, "runs");
      } catch (e) {
        console.error("Deploy status parse failed:", e.message);
      }
      if (callback) callback();
    }
  );
}

function formatTimeAgo(dateStr) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function deployStatusIcon(run) {
  if (run.status === "in_progress" || run.status === "queued" || run.status === "waiting") return "\u{1F7E1}";
  if (run.conclusion === "success") return "\u2705";
  if (run.conclusion === "failure") return "\u274C";
  if (run.conclusion === "cancelled") return "\u26AA";
  return "\u23F3";
}

function buildDeploySubmenu() {
  const items = [
    { label: `\u{1F4E6} ${githubRepo}`, enabled: false },
    { type: "separator" },
  ];

  if (cachedWorkflowRuns.length === 0) {
    items.push({ label: "Loading...", enabled: false });
  } else {
    for (const run of cachedWorkflowRuns) {
      const icon = deployStatusIcon(run);
      const title = run.display_title.length > 45
        ? run.display_title.substring(0, 42) + "..."
        : run.display_title;
      const time = formatTimeAgo(run.created_at);
      const statusText = run.status === "completed"
        ? run.conclusion
        : run.status.replace(/_/g, " ");

      items.push({
        label: `${icon} ${title}`,
        submenu: [
          { label: `#${run.run_number} \u2014 ${run.name}`, enabled: false },
          { label: `Branch: ${run.head_branch}`, enabled: false },
          { label: `By: ${run.actor}`, enabled: false },
          { label: `Status: ${statusText}`, enabled: false },
          { label: time, enabled: false },
          { type: "separator" },
          { label: "Open in GitHub", click: () => shell.openExternal(run.html_url) },
        ],
      });
    }
  }

  items.push({ type: "separator" });
  items.push({
    label: "Refresh",
    click: () => {
      refreshDeployStatus(() => {
        try { tray.setContextMenu(buildTrayMenu(hooksActiveGlobal)); } catch (e) {}
      });
    },
  });
  items.push({
    label: "Open Actions Page",
    click: () => shell.openExternal(`https://github.com/${githubRepo}/actions`),
  });
  items.push({
    label: "Configure Repo...",
    click: () => configureGithubRepo(),
  });

  return items;
}

function configureGithubRepo() {
  if (process.platform === "darwin") {
    exec(
      `osascript -e 'set theRepo to text returned of (display dialog "GitHub repo (owner/repo):" default answer "${githubRepo}" with title "Deploy Status")'`,
      (err, stdout) => {
        if (!err && stdout.trim()) {
          githubRepo = stdout.trim();
          cachedWorkflowRuns = [];
          saveSettings();
          refreshDeployStatus(() => {
            try { tray.setContextMenu(buildTrayMenu(hooksActiveGlobal)); } catch (e) {}
          });
        }
      }
    );
  } else {
    // Fallback: open settings file for manual editing
    shell.openPath(SETTINGS_FILE);
  }
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
          hooksActiveGlobal = true;
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
          hooksActiveGlobal = false;
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
      label: "Deploy Status",
      submenu: buildDeploySubmenu(),
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
    {
      label: "Show Floating Pet",
      type: "checkbox",
      checked: floatingPetVisible,
      click: (item) => {
        floatingPetVisible = item.checked;
        if (floatingPetVisible) {
          win.show();
        } else {
          win.hide();
        }
        saveSettings();
      },
    },
    {
      label: "Demo Mode",
      type: "checkbox",
      checked: demoActive,
      click: (item) => {
        if (item.checked) {
          // Force speech bubbles on during demo
          if (!speechBubblesEnabled) {
            speechBubblesEnabled = true;
            win.webContents.send("speech-toggle", true);
          }
          startDemoMode();
        } else {
          stopDemoMode();
        }
        tray.setContextMenu(buildTrayMenu(hooksActive));
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

// Disable GPU process to prevent duplicate dock icon on unsigned macOS apps
app.disableHardwareAcceleration();

if (process.platform === "linux") {
  app.commandLine.appendSwitch("enable-transparent-visuals");
}

// Keep dock visible for animated dock icon
// if (process.platform === "darwin" && app.dock) app.dock.hide();

// Prevent second instances from opening the default Electron window
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (win && floatingPetVisible) {
      win.show();
      win.focus();
    }
  });
}

app.on("activate", () => {
  if (win && floatingPetVisible) {
    win.show();
    win.focus();
  }
});

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
  hooksActiveGlobal = hooksActive;

  loadSettings();
  createWindow();

  // System tray
  const trayIcon = nativeImage.createFromPath(path.join(__dirname, "icon.png")).resize({ width: 22, height: 22 });
  tray = new Tray(trayIcon);
  tray.setToolTip("Claude Code Pet");
  tray.setContextMenu(buildTrayMenu(hooksActive));

  // macOS Dock right-click menu
  if (process.platform === "darwin" && app.dock) {
    function rebuildDockMenu() {
      const dockItems = [
        {
          label: "Show/Hide Floating Pet",
          click: () => {
            floatingPetVisible = !floatingPetVisible;
            if (floatingPetVisible) { win.show(); } else { win.hide(); }
            saveSettings();
          },
        },
        { type: "separator" },
        { label: `\u{1F4E6} Deploy Status`, enabled: false },
      ];

      if (cachedWorkflowRuns.length === 0) {
        dockItems.push({ label: "  Loading...", enabled: false });
      } else {
        for (const run of cachedWorkflowRuns.slice(0, 6)) {
          const icon = deployStatusIcon(run);
          const title = run.display_title.length > 40
            ? run.display_title.substring(0, 37) + "..."
            : run.display_title;
          const time = formatTimeAgo(run.created_at);
          dockItems.push({
            label: `${icon} ${title} (${time})`,
            click: () => shell.openExternal(run.html_url),
          });
        }
      }

      dockItems.push({ type: "separator" });
      dockItems.push({
        label: "Open Actions Page",
        click: () => shell.openExternal(`https://github.com/${githubRepo}/actions`),
      });

      app.dock.setMenu(Menu.buildFromTemplate(dockItems));
    }
    rebuildDockMenu();
    // Rebuild dock menu when deploy data refreshes
    global._rebuildDockMenu = rebuildDockMenu;
  }

  // Fetch deploy status on launch, then every 45 seconds
  refreshDeployStatus(() => {
    try {
      tray.setContextMenu(buildTrayMenu(hooksActive));
      if (global._rebuildDockMenu) global._rebuildDockMenu();
    } catch (e) {}
  });
  setInterval(() => {
    refreshDeployStatus(() => {
      try {
        tray.setContextMenu(buildTrayMenu(hooksActiveGlobal));
        if (global._rebuildDockMenu) global._rebuildDockMenu();
      } catch (e) {}
    });
  }, 45000);

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
