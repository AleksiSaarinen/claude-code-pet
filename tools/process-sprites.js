#!/usr/bin/env node
/**
 * Sprite Sheet Processor for Claude Code Pet
 *
 * Takes raw AI-generated sprite images and processes them into
 * properly-sized 120x120 sprite sheets with transparent backgrounds.
 *
 * Usage:
 *   node tools/process-sprites.js <input> [options]
 *
 * Examples:
 *   # Auto-detect frames in a horizontal strip, output as idle.png
 *   node tools/process-sprites.js grok-idle.png --out characters/pixel-claude/idle.png
 *
 *   # Specify frame count manually
 *   node tools/process-sprites.js grok-idle.png --frames 6 --out idle.png
 *
 *   # Process multiple separate images into one strip
 *   node tools/process-sprites.js frame1.png frame2.png frame3.png --out idle.png
 *
 *   # Remove background by sampling corner color
 *   node tools/process-sprites.js grok-idle.png --remove-bg --out idle.png
 *
 *   # Remove a specific background color
 *   node tools/process-sprites.js grok-idle.png --remove-bg "#e8d4b8" --out idle.png
 *
 *   # Adjust tolerance for background removal (0-255, default 40)
 *   node tools/process-sprites.js grok-idle.png --remove-bg --tolerance 60 --out idle.png
 *
 *   # Preview: split into individual frame files for inspection
 *   node tools/process-sprites.js grok-idle.png --split --out-dir ./frames/
 *
 * Options:
 *   --out <path>        Output sprite sheet path (default: output.png)
 *   --frames <n>        Number of frames (auto-detected if omitted)
 *   --frame-size <WxH>  Target frame size (default: 120x120)
 *   --remove-bg [color] Remove background (auto-detect or specify hex color)
 *   --tolerance <n>     Color distance threshold for bg removal (default: 40)
 *   --split             Output individual frames instead of a strip
 *   --out-dir <path>    Directory for split frames (default: ./frames/)
 *   --padding <n>       Trim padding pixels from each detected frame (default: 0)
 *   --no-resize         Don't resize frames, keep original size
 *
 * Requires: npm install sharp
 */

const sharp = require("sharp");
const path = require("path");
const fs = require("fs");

// ── Argument Parsing ─────────────────────────────────────────────────────────

function parseArgs(argv) {
  const args = {
    inputs: [],
    out: "output.png",
    frames: null,
    frameWidth: 120,
    frameHeight: 120,
    removeBg: false,
    bgColor: null,
    tolerance: 40,
    split: false,
    outDir: "./frames/",
    padding: 0,
    noResize: false,
    rows: 1,
    saturate: 1.15,
  };

  let i = 2; // skip node and script path
  while (i < argv.length) {
    const arg = argv[i];
    switch (arg) {
      case "--out":
        args.out = argv[++i];
        break;
      case "--frames":
        args.frames = parseInt(argv[++i], 10);
        break;
      case "--frame-size": {
        const parts = argv[++i].split("x");
        args.frameWidth = parseInt(parts[0], 10);
        args.frameHeight = parseInt(parts[1] || parts[0], 10);
        break;
      }
      case "--remove-bg":
        args.removeBg = true;
        // Check if next arg is a color (starts with #)
        if (argv[i + 1] && argv[i + 1].startsWith("#")) {
          args.bgColor = argv[++i];
        }
        break;
      case "--tolerance":
        args.tolerance = parseInt(argv[++i], 10);
        break;
      case "--split":
        args.split = true;
        break;
      case "--out-dir":
        args.outDir = argv[++i];
        break;
      case "--padding":
        args.padding = parseInt(argv[++i], 10);
        break;
      case "--no-resize":
        args.noResize = true;
        break;
      case "--rows":
        args.rows = parseInt(argv[++i], 10);
        break;
      case "--saturate":
        args.saturate = parseFloat(argv[++i]);
        break;
      case "--no-saturate":
        args.saturate = 1.0;
        break;
      default:
        if (!arg.startsWith("--")) {
          args.inputs.push(arg);
        }
        break;
    }
    i++;
  }

  if (args.inputs.length === 0) {
    console.log(`
Sprite Sheet Processor for Claude Code Pet

Usage:
  node tools/process-sprites.js <input-images...> [options]

Examples:
  # Process a Grok-generated strip into a proper sprite sheet
  node tools/process-sprites.js grok-idle.png --remove-bg --frames 6 --out characters/pixel-claude/idle.png

  # Combine separate frame images into a strip
  node tools/process-sprites.js pose1.png pose2.png pose3.png pose4.png --remove-bg --out idle.png

  # Split an existing strip into individual frames for inspection
  node tools/process-sprites.js strip.png --frames 6 --split --out-dir ./frames/

Options:
  --out <path>          Output file (default: output.png)
  --frames <n>          Frame count (auto-detected from aspect ratio if omitted)
  --frame-size <WxH>    Target frame size (default: 120x120)
  --remove-bg [#color]  Remove background (samples corners, or specify hex color)
  --tolerance <n>       Background removal sensitivity, 0-255 (default: 40)
  --split               Save individual frames instead of a strip
  --out-dir <path>      Folder for --split output (default: ./frames/)
  --padding <n>         Pixels to trim from each frame edge (default: 0)
  --no-resize           Keep original frame dimensions

Required states for a character:
  idle (6 frames), coding (8), thinking (6), success (4),
  error (4), searching (6), reading (4)
`);
    process.exit(0);
  }

  return args;
}

// ── Background Removal ───────────────────────────────────────────────────────

function parseHexColor(hex) {
  hex = hex.replace("#", "");
  if (hex.length === 3) hex = hex[0]+hex[0]+hex[1]+hex[1]+hex[2]+hex[2];
  return {
    r: parseInt(hex.slice(0, 2), 16),
    g: parseInt(hex.slice(2, 4), 16),
    b: parseInt(hex.slice(4, 6), 16),
  };
}

function colorDistance(r1, g1, b1, r2, g2, b2) {
  return Math.sqrt((r1-r2)**2 + (g1-g2)**2 + (b1-b2)**2);
}

async function sampleCornerColor(sharpImg) {
  const { data, info } = await sharpImg
    .clone()
    .raw()
    .ensureAlpha()
    .toBuffer({ resolveWithObject: true });

  const w = info.width;
  const channels = info.channels;

  // Sample 4 corners (5x5 pixel area each)
  const corners = [
    { x: 2, y: 2 },                    // top-left
    { x: w - 3, y: 2 },                // top-right
    { x: 2, y: info.height - 3 },      // bottom-left
    { x: w - 3, y: info.height - 3 },  // bottom-right
  ];

  let rSum = 0, gSum = 0, bSum = 0, count = 0;
  for (const corner of corners) {
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        const px = corner.x + dx;
        const py = corner.y + dy;
        if (px < 0 || py < 0 || px >= w || py >= info.height) continue;
        const idx = (py * w + px) * channels;
        rSum += data[idx];
        gSum += data[idx + 1];
        bSum += data[idx + 2];
        count++;
      }
    }
  }

  return {
    r: Math.round(rSum / count),
    g: Math.round(gSum / count),
    b: Math.round(bSum / count),
  };
}

async function removeBackground(sharpImg, bgColor, tolerance) {
  const { data, info } = await sharpImg
    .raw()
    .ensureAlpha()
    .toBuffer({ resolveWithObject: true });

  const pixels = Buffer.from(data);
  const channels = info.channels;
  const w = info.width;
  const h = info.height;

  // Gradient-aware flood fill from edges.
  // Each pixel is compared to its parent (neighbor that queued it)
  // with a per-step tolerance, so the fill follows smooth gradients
  // but stops at hard edges (character outlines).
  const stepTol = Math.min(tolerance, 30); // per-neighbor step limit
  const removed = new Uint8Array(w * h);
  const visited = new Uint8Array(w * h);
  // Queue stores [idx, parentIdx]
  const queue = [];

  // Seed from all border pixels — mark as bg unconditionally
  for (let x = 0; x < w; x++) {
    const top = x;
    const bot = x + (h - 1) * w;
    if (!visited[top]) { visited[top] = 1; removed[top] = 1; queue.push(top, top); }
    if (!visited[bot]) { visited[bot] = 1; removed[bot] = 1; queue.push(bot, bot); }
  }
  for (let y = 0; y < h; y++) {
    const left = y * w;
    const right = (w - 1) + y * w;
    if (!visited[left]) { visited[left] = 1; removed[left] = 1; queue.push(left, left); }
    if (!visited[right]) { visited[right] = 1; removed[right] = 1; queue.push(right, right); }
  }

  let qi = 0;
  while (qi < queue.length) {
    const idx = queue[qi++];
    const parentIdx = queue[qi++];

    const px = idx * channels;
    const ppx = parentIdx * channels;

    // Compare to parent (neighbor similarity — follows gradients)
    const neighborDist = colorDistance(
      pixels[px], pixels[px+1], pixels[px+2],
      pixels[ppx], pixels[ppx+1], pixels[ppx+2]
    );

    // Also compare to original seed color (prevents drifting too far)
    const seedDist = colorDistance(
      pixels[px], pixels[px+1], pixels[px+2],
      bgColor.r, bgColor.g, bgColor.b
    );

    // Accept if similar to neighbor AND not too far from seed
    // OR if very close to seed color (original behavior)
    if (neighborDist < stepTol && seedDist < tolerance * 3) {
      removed[idx] = 1;
      pixels[px + 3] = 0;

      const x = idx % w;
      const y = Math.floor(idx / w);
      const neighbors = [];
      if (x > 0) neighbors.push(idx - 1);
      if (x < w - 1) neighbors.push(idx + 1);
      if (y > 0) neighbors.push(idx - w);
      if (y < h - 1) neighbors.push(idx + w);

      for (const ni of neighbors) {
        if (!visited[ni]) {
          visited[ni] = 1;
          queue.push(ni, idx);
        }
      }
    }
  }

  return sharp(pixels, {
    raw: { width: info.width, height: info.height, channels: info.channels },
  }).png();
}

// ── Frame Detection ──────────────────────────────────────────────────────────

function detectFrameCount(width, height) {
  // Assume horizontal strip — frame count = width / height (nearest integer)
  // since frames are expected to be square-ish
  const ratio = width / height;
  const count = Math.round(ratio);
  return Math.max(1, count);
}

// ── Main Processing ──────────────────────────────────────────────────────────

async function processStrip(inputPath, args) {
  console.log(`Reading: ${inputPath}`);
  const img = sharp(inputPath);
  const meta = await img.metadata();
  console.log(`  Input size: ${meta.width}x${meta.height}`);

  // Determine frame count and grid layout
  const rows = args.rows;
  const srcRowH = Math.floor(meta.height / rows);
  const totalFrames = args.frames || detectFrameCount(meta.width, srcRowH) * rows;
  const cols = Math.ceil(totalFrames / rows);
  const srcFrameW = Math.floor(meta.width / cols);
  const srcFrameH = srcRowH;
  console.log(`  Layout: ${cols}x${rows} grid, ${totalFrames} frames (${srcFrameW}x${srcFrameH} each)`);

  // Extract individual frames (left-to-right, top-to-bottom)
  const frames = [];
  for (let i = 0; i < totalFrames; i++) {
    const col = i % cols;
    const row = Math.floor(i / cols);
    let left = col * srcFrameW + args.padding;
    let top = row * srcFrameH + args.padding;
    let width = srcFrameW - args.padding * 2;
    let height = srcFrameH - args.padding * 2;

    // Clamp to image bounds
    left = Math.max(0, Math.min(left, meta.width - 1));
    top = Math.max(0, Math.min(top, meta.height - 1));
    width = Math.min(width, meta.width - left);
    height = Math.min(height, meta.height - top);

    let frame = sharp(inputPath).extract({ left, top, width, height });

    // Remove background if requested
    if (args.removeBg) {
      let bgColor = args.bgColor
        ? parseHexColor(args.bgColor)
        : await sampleCornerColor(sharp(inputPath).extract({ left, top, width, height }));

      if (i === 0) {
        console.log(`  Background color: rgb(${bgColor.r}, ${bgColor.g}, ${bgColor.b}) tolerance=${args.tolerance}`);
      }

      frame = await removeBackground(frame, bgColor, args.tolerance);
    }

    // Resize to target frame size
    if (!args.noResize) {
      frame = frame.resize(args.frameWidth, args.frameHeight, {
        fit: "contain",
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      });
    }

    // Boost colors to compensate for bg removal + downscale wash-out
    if (args.saturate !== 1.0) {
      frame = frame.modulate({ saturation: args.saturate });
    }

    const buf = await frame.png().toBuffer();
    frames.push(buf);
  }

  return frames;
}

async function processSeparateImages(inputs, args) {
  const frames = [];
  for (const inputPath of inputs) {
    console.log(`Reading: ${inputPath}`);
    let frame = sharp(inputPath);

    if (args.removeBg) {
      const bgColor = args.bgColor
        ? parseHexColor(args.bgColor)
        : await sampleCornerColor(frame.clone());

      if (frames.length === 0) {
        console.log(`  Background color: rgb(${bgColor.r}, ${bgColor.g}, ${bgColor.b}) tolerance=${args.tolerance}`);
      }

      frame = await removeBackground(frame, bgColor, args.tolerance);
    }

    if (!args.noResize) {
      frame = frame.resize(args.frameWidth, args.frameHeight, {
        fit: "contain",
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      });
    }

    const buf = await frame.png().toBuffer();
    frames.push(buf);
  }

  return frames;
}

async function main() {
  const args = parseArgs(process.argv);

  // Process input(s) into frame buffers
  let frames;
  if (args.inputs.length === 1) {
    frames = await processStrip(args.inputs[0], args);
  } else {
    frames = await processSeparateImages(args.inputs, args);
  }

  console.log(`  Processed ${frames.length} frames @ ${args.frameWidth}x${args.frameHeight}`);

  if (args.split) {
    // Save individual frames
    fs.mkdirSync(args.outDir, { recursive: true });
    for (let i = 0; i < frames.length; i++) {
      const framePath = path.join(args.outDir, `frame-${String(i).padStart(3, "0")}.png`);
      fs.writeFileSync(framePath, frames[i]);
    }
    console.log(`  Saved ${frames.length} frames to ${args.outDir}`);
  } else {
    // Stitch into horizontal strip
    const totalWidth = args.frameWidth * frames.length;
    const composites = [];
    for (let i = 0; i < frames.length; i++) {
      composites.push({
        input: frames[i],
        left: i * args.frameWidth,
        top: 0,
      });
    }

    // Ensure output directory exists
    const outDir = path.dirname(args.out);
    if (outDir && outDir !== ".") {
      fs.mkdirSync(outDir, { recursive: true });
    }

    await sharp({
      create: {
        width: totalWidth,
        height: args.frameHeight,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      },
    })
      .composite(composites)
      .png()
      .toFile(args.out);

    console.log(`\n  Output: ${args.out} (${totalWidth}x${args.frameHeight}, ${frames.length} frames)`);
  }
}

main().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});
