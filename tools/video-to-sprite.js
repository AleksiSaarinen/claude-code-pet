const sharp = require("sharp");
const path = require("path");
const fs = require("fs");

const args = process.argv.slice(2);
const framesDir = args[0];
const every = parseInt(args[args.indexOf("--every") + 1] || "3");
const size = parseInt(args[args.indexOf("--size") + 1] || "120");
const outPath = args[args.indexOf("--out") + 1] || "sprite.png";
const neighborTol = parseInt(args[args.indexOf("--tolerance") + 1] || "25");

// Region-growing flood fill from edges using neighbor similarity.
// Each candidate pixel is compared to the neighbor that queued it,
// so it follows gradients naturally.
function floodFillRemoveBg(pixels, w, h, tol) {
  const visited = new Uint8Array(w * h); // 0=unvisited, 1=background, 2=foreground
  // priority: pixels most similar to their parent get processed first
  const queue = [];

  const idx = (x, y) => y * w + x;
  const pIdx = (x, y) => (y * w + x) * 4;

  function colorDist(pi1, pi2) {
    const dr = pixels[pi1] - pixels[pi2];
    const dg = pixels[pi1 + 1] - pixels[pi2 + 1];
    const db = pixels[pi1 + 2] - pixels[pi2 + 2];
    return Math.sqrt(dr * dr + dg * dg + db * db);
  }

  // Also check if a pixel looks like it could be "background" — smooth, low detail
  // by comparing to multiple neighbors for uniformity
  function isSmooth(x, y) {
    const pi = pIdx(x, y);
    let totalDist = 0, count = 0;
    for (const [nx, ny] of [[x-1,y],[x+1,y],[x,y-1],[x,y+1],[x-1,y-1],[x+1,y-1],[x-1,y+1],[x+1,y+1]]) {
      if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue;
      totalDist += colorDist(pi, pIdx(nx, ny));
      count++;
    }
    return count > 0 ? (totalDist / count) < tol * 0.8 : true;
  }

  // Seed from all edge pixels
  for (let x = 0; x < w; x++) {
    for (const y of [0, 1, h - 2, h - 1]) {
      const i = idx(x, y);
      if (!visited[i]) {
        visited[i] = 1;
        queue.push(x, y);
      }
    }
  }
  for (let y = 0; y < h; y++) {
    for (const x of [0, 1, w - 2, w - 1]) {
      const i = idx(x, y);
      if (!visited[i]) {
        visited[i] = 1;
        queue.push(x, y);
      }
    }
  }

  // BFS flood fill — compare candidate to the neighbor that found it
  let qi = 0;
  while (qi < queue.length) {
    const cx = queue[qi++];
    const cy = queue[qi++];
    const cpi = pIdx(cx, cy);

    for (const [nx, ny] of [[cx-1,cy],[cx+1,cy],[cx,cy-1],[cx,cy+1]]) {
      if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue;
      const ni = idx(nx, ny);
      if (visited[ni]) continue;

      const npi = pIdx(nx, ny);
      const dist = colorDist(cpi, npi);

      if (dist < tol && isSmooth(nx, ny)) {
        visited[ni] = 1;
        queue.push(nx, ny);
      } else {
        visited[ni] = 2; // foreground
      }
    }
  }

  // Make background pixels transparent, soften edges
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = idx(x, y);
      const pi = pIdx(x, y);
      if (visited[i] === 1) {
        pixels[pi + 3] = 0;
      } else if (visited[i] === 2) {
        // Check adjacency to background for edge softening
        let adjBg = 0;
        for (const [nx, ny] of [[x-1,y],[x+1,y],[x,y-1],[x,y+1]]) {
          if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue;
          if (visited[idx(nx, ny)] === 1) adjBg++;
        }
        if (adjBg >= 2) {
          pixels[pi + 3] = 180;
        } else if (adjBg === 1) {
          pixels[pi + 3] = 220;
        }
      }
    }
  }
}

async function main() {
  const files = fs.readdirSync(framesDir)
    .filter(f => f.endsWith(".png"))
    .sort()
    .filter((_, i) => i % every === 0);

  console.log(`Using ${files.length} frames (every ${every}th), neighbor tolerance=${neighborTol}`);

  const processed = [];
  for (let fi = 0; fi < files.length; fi++) {
    const file = files[fi];
    const meta = await sharp(path.join(framesDir, file)).metadata();

    const raw = await sharp(path.join(framesDir, file))
      .ensureAlpha()
      .raw()
      .toBuffer();

    const pixels = Buffer.from(raw);
    floodFillRemoveBg(pixels, meta.width, meta.height, neighborTol);

    const resized = await sharp(pixels, { raw: { width: meta.width, height: meta.height, channels: 4 } })
      .resize({ width: size, height: size, fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toBuffer();

    processed.push(resized);
    process.stdout.write(`\rProcessed ${fi + 1}/${files.length}`);
  }
  console.log();

  const sheetWidth = size * processed.length;
  const composites = [];
  for (let i = 0; i < processed.length; i++) {
    composites.push({ input: processed[i], left: i * size, top: 0 });
  }

  await sharp({
    create: { width: sheetWidth, height: size, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } }
  })
    .composite(composites)
    .png()
    .toFile(outPath);

  console.log(`Wrote ${outPath} (${sheetWidth}x${size}, ${processed.length} frames)`);
}

main().catch(e => { console.error(e); process.exit(1); });
