#!/usr/bin/env node
// Quick GLB inspector - lists animations and bone names
const fs = require("fs");
const path = require("path");

const filePath = path.resolve(process.argv[2]);
if (!fs.existsSync(filePath)) { console.error("File not found:", filePath); process.exit(1); }

// Parse GLB header to find JSON chunk
const buf = fs.readFileSync(filePath);
const magic = buf.readUInt32LE(0);
if (magic !== 0x46546C67) { console.error("Not a GLB file"); process.exit(1); }

const jsonLength = buf.readUInt32LE(12);
const jsonStr = buf.slice(20, 20 + jsonLength).toString("utf8");
const json = JSON.parse(jsonStr);

console.log("=== Animations ===");
if (json.animations && json.animations.length > 0) {
  json.animations.forEach((a, i) => console.log(`  [${i}] ${a.name || "(unnamed)"}`));
} else {
  console.log("  (none)");
}

console.log("\n=== Nodes (first 30) ===");
if (json.nodes) {
  json.nodes.slice(0, 30).forEach((n, i) => console.log(`  [${i}] ${n.name || "(unnamed)"}`));
  if (json.nodes.length > 30) console.log(`  ... (${json.nodes.length} total)`);
}
