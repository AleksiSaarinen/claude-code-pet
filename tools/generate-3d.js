#!/usr/bin/env node
/**
 * 3D Character Generator for Claude Code Pet
 *
 * Takes an image and generates a rigged, animated 3D character via the asset gen API.
 *
 * Usage:
 *   node tools/generate-3d.js <image-path> --name <character-name>
 *
 * Example:
 *   node tools/generate-3d.js ~/Downloads/character.jpg --name my-3d-pet
 */

const fs = require("fs");
const https = require("https");
const http = require("http");
const path = require("path");

// Parse .env file manually (no dotenv dependency needed)
function loadEnv() {
  const envPath = path.join(__dirname, "..", ".env");
  if (!fs.existsSync(envPath)) {
    console.error("Error: .env file not found.");
    process.exit(1);
  }
  const env = {};
  fs.readFileSync(envPath, "utf8")
    .split("\n")
    .forEach((line) => {
      const eq = line.indexOf("=");
      if (eq > 0) {
        const key = line.slice(0, eq).trim();
        const val = line.slice(eq + 1).trim();
        if (key) env[key] = val;
      }
    });
  return env;
}

// App state → Tripo animation clip name mapping
// The animated GLB from the API contains: bow, fall, idle, running, wait, walk
const STATE_ANIMATIONS = {
  idle:       { animation: "idle",    loop: true  },
  coding:     { animation: "running", loop: true  },
  thinking:   { animation: "idle",    loop: true  },
  debugging:  { animation: "fall",    loop: true  },
  testing:    { animation: "idle",    loop: true  },
  searching:  { animation: "running", loop: true  },
  reading:    { animation: "wait",    loop: true  },
  success:    { animation: "bow",     loop: false },
  error:      { animation: "fall",    loop: false },
  installing: { animation: "wait",    loop: true  },
  deploying:  { animation: "running", loop: true  },
  cooking:    { animation: "idle",    loop: true  },
  hatching:   { animation: "bow",     loop: false },
  deleting:   { animation: "running", loop: true  },
  downloading:{ animation: "wait",    loop: true  },
};

function apiRequest(url, method, headers, body) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const lib = parsed.protocol === "https:" ? https : http;
    const opts = { method, headers };
    const req = lib.request(url, opts, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, body: data });
        }
      });
    });
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

function downloadFile(url, destPath) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const lib = parsed.protocol === "https:" ? https : http;
    const file = fs.createWriteStream(destPath);
    lib
      .get(url, (res) => {
        if (res.statusCode === 301 || res.statusCode === 302) {
          file.close();
          fs.unlinkSync(destPath);
          return downloadFile(res.headers.location, destPath).then(resolve).catch(reject);
        }
        res.pipe(file);
        file.on("finish", () => file.close(resolve));
      })
      .on("error", (err) => {
        fs.unlink(destPath, () => {});
        reject(err);
      });
  });
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  const args = process.argv.slice(2);
  if (!args[0]) {
    console.error("Usage: node tools/generate-3d.js <image-path> --name <character-name>");
    process.exit(1);
  }

  const imagePath = path.resolve(args[0]);
  const nameIdx = args.indexOf("--name");
  const charName = nameIdx !== -1 ? args[nameIdx + 1] : path.basename(imagePath, path.extname(imagePath));
  const charId = charName.toLowerCase().replace(/\s+/g, "-");

  if (!fs.existsSync(imagePath)) {
    console.error(`Error: Image not found: ${imagePath}`);
    process.exit(1);
  }

  const env = loadEnv();
  const API_URL = env.ASSET_GEN_API_URL;
  const API_TOKEN = env.ASSET_GEN_API_TOKEN;
  if (!API_URL || !API_TOKEN) {
    console.error("Error: ASSET_GEN_API_URL and ASSET_GEN_API_TOKEN must be set in .env");
    process.exit(1);
  }

  // Encode image as base64 data URL
  console.log(`Reading image: ${imagePath}`);
  const imageData = fs.readFileSync(imagePath);
  const ext = path.extname(imagePath).slice(1).toLowerCase();
  const mime = ext === "jpg" || ext === "jpeg" ? "image/jpeg" : `image/${ext}`;
  const base64Image = `data:${mime};base64,${imageData.toString("base64")}`;

  // Submit to API
  console.log("Submitting to 3D generation API...");
  const body = JSON.stringify({
    image: base64Image,
    generation_type: "character",
    smart_low_poly: true,
    actions: ["mesh_gen", "rigging", "animation"],
  });

  const submitRes = await apiRequest(`${API_URL}/api/v1/3d/process`, "POST", {
    "Content-Type": "application/json",
    "Authorization": `Bearer ${API_TOKEN}`,
    "Content-Length": Buffer.byteLength(body),
  }, body);

  if (submitRes.status !== 200) {
    console.error("Submission failed:", submitRes.body);
    process.exit(1);
  }

  const generationId = submitRes.body.generation_id || submitRes.body.id;
  console.log(`Generation ID: ${generationId}`);

  // Poll for completion
  let lastStage = "";
  let lastProgress = -1;
  while (true) {
    await sleep(3000);
    const statusRes = await apiRequest(
      `${API_URL}/api/v1/pipeline/status/${generationId}`,
      "GET",
      { "Authorization": `Bearer ${API_TOKEN}` }
    );

    if (statusRes.status !== 200) {
      console.error("Status check failed:", statusRes.body);
      process.exit(1);
    }

    const { stage, progress, error } = statusRes.body;

    if (stage !== lastStage) {
      if (lastProgress >= 0) process.stdout.write("\n");
      console.log(`→ ${stage}`);
      lastStage = stage;
      lastProgress = -1;
    }
    if (progress !== undefined && progress !== lastProgress) {
      process.stdout.write(`\r  ${progress}%`);
      lastProgress = progress;
    }

    if (stage === "failed") {
      process.stdout.write("\n");
      console.error("Generation failed:", error);
      process.exit(1);
    }

    if (stage === "complete") {
      process.stdout.write("\n");
      console.log("Complete!");

      const { animated_model_url, rigged_model_url, model_url } = statusRes.body;
      const modelUrl = animated_model_url || rigged_model_url || model_url;
      const modelFile = animated_model_url
        ? "model-animated.glb"
        : rigged_model_url
        ? "model-rigged.glb"
        : "model.glb";

      const charDir = path.join(__dirname, "..", "characters", charId);
      fs.mkdirSync(charDir, { recursive: true });

      console.log(`Downloading ${modelFile}...`);
      await downloadFile(modelUrl, path.join(charDir, modelFile));
      console.log(`Saved to characters/${charId}/${modelFile}`);

      const characterJson = {
        id: charId,
        name: charName,
        renderMode: "3d",
        file: modelFile,
        states: STATE_ANIMATIONS,
        fallbackMap: {},
        tierStrategy: "none",
        particlesEnabled: false,
        accessoriesEnabled: false,
      };

      fs.writeFileSync(
        path.join(charDir, "character.json"),
        JSON.stringify(characterJson, null, 2)
      );

      console.log(`\nCharacter "${charName}" saved to characters/${charId}/`);
      console.log(`  Model:  characters/${charId}/${modelFile}`);
      console.log(`  Config: characters/${charId}/character.json`);
      break;
    }
  }
}

main().catch((err) => {
  console.error("Fatal:", err.message || err);
  process.exit(1);
});
