// Downloads a prebuilt llama.cpp release (llama-server + its libraries) into
// src-tauri/resources/llama so it gets bundled with the app.
//
//   npm run fetch-llama                 -> latest release, build for this OS
//   LLAMA_TAG=b6000 npm run fetch-llama -> a pinned release
//   LLAMA_VARIANT=win-cpu-x64 ...       -> force a build variant
//
// Variants (asset name: llama-<tag>-bin-<variant>.zip):
//   Windows: win-vulkan-x64 (default; NVIDIA/AMD/Intel GPUs, falls back to CPU), win-cpu-x64
//   macOS:   macos-arm64 (Apple Silicon, Metal), macos-x64 (Intel)

import { execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dest = path.join(root, "src-tauri", "resources", "llama");

function defaultVariant() {
  if (process.platform === "win32") return "win-vulkan-x64";
  if (process.platform === "darwin") return process.arch === "arm64" ? "macos-arm64" : "macos-x64";
  throw new Error("Only Windows and macOS builds are supported. Set LLAMA_VARIANT to override.");
}

const headers = { "User-Agent": "ma-tarjimon-build", Accept: "application/vnd.github+json" };
if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;

const tag = process.env.LLAMA_TAG?.trim();
const variant = process.env.LLAMA_VARIANT || defaultVariant();

function findAsset(release) {
  if (!Array.isArray(release?.assets)) return null;
  return release.assets.find(
    (a) =>
      a.name.startsWith("llama-") &&
      (a.name.endsWith(`-bin-${variant}.zip`) || a.name.endsWith(`-bin-${variant}.tar.gz`)),
  );
}

let release;
let asset;
if (tag) {
  const api = `https://api.github.com/repos/ggml-org/llama.cpp/releases/tags/${encodeURIComponent(tag)}`;
  release = await (await fetch(api, { headers })).json();
  if (!release.assets) throw new Error(`GitHub API error: ${JSON.stringify(release).slice(0, 300)}`);
  asset = findAsset(release);
  if (!asset) {
    console.error(release.assets.map((a) => a.name).join("\n"));
    throw new Error(`No asset for variant "${variant}" in ${release.tag_name}`);
  }
} else {
  const api = "https://api.github.com/repos/ggml-org/llama.cpp/releases?per_page=15";
  const releases = await (await fetch(api, { headers })).json();
  if (!Array.isArray(releases)) throw new Error(`GitHub API error: ${JSON.stringify(releases).slice(0, 300)}`);
  for (const r of releases) {
    if (r.draft) continue;
    const match = findAsset(r);
    if (match) {
      release = r;
      asset = match;
      break;
    }
  }
  if (!asset) throw new Error(`No recent llama.cpp release contains an asset for variant "${variant}"`);
}
console.log(`llama.cpp ${release.tag_name}: ${asset.name}`);

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "llama-"));
const archive = path.join(tmp, asset.name);
const dlRes = await fetch(asset.browser_download_url, { headers: { "User-Agent": headers["User-Agent"] } });
if (!dlRes.ok) throw new Error(`Failed to download ${asset.browser_download_url}: HTTP ${dlRes.status}`);
const buf = Buffer.from(await dlRes.arrayBuffer());
fs.writeFileSync(archive, buf);

const unz = path.join(tmp, "x");
fs.mkdirSync(unz);
if (asset.name.endsWith(".tar.gz") || asset.name.endsWith(".tgz")) {
  execSync(`tar -xzf "${archive}" -C "${unz}"`, { stdio: "inherit" });
} else if (process.platform === "win32") {
  execSync(`powershell -NoProfile -Command "Expand-Archive -Path '${archive}' -DestinationPath '${unz}' -Force"`, { stdio: "inherit" });
} else {
  execSync(`unzip -q "${archive}" -d "${unz}"`, { stdio: "inherit" });
}

// Find the folder that holds llama-server and copy everything next to it (the shared libraries it needs).
const exeName = variant.startsWith("win") ? "llama-server.exe" : "llama-server";
function find(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isFile() && e.name === exeName) return dir;
    if (e.isDirectory()) {
      const r = find(p);
      if (r) return r;
    }
  }
  return null;
}
const binDir = find(unz);
if (!binDir) throw new Error(`${exeName} not found in ${asset.name}`);

fs.rmSync(dest, { recursive: true, force: true });
fs.mkdirSync(dest, { recursive: true });
for (const f of fs.readdirSync(binDir)) {
  const from = path.join(binDir, f);
  if (!fs.statSync(from).isFile()) continue;
  // Keep llama-server and the shared libraries; skip the other CLI tools to keep the installer small.
  const keep = f === exeName || /\.(dll|dylib|so|metal|metallib)$/i.test(f) || f.startsWith("lib");
  if (keep) fs.copyFileSync(from, path.join(dest, f));
}
if (!variant.startsWith("win") && process.platform !== "win32") fs.chmodSync(path.join(dest, exeName), 0o755);
fs.writeFileSync(path.join(dest, "VERSION.txt"), `${release.tag_name} ${asset.name}\n`);
console.log("Copied to", dest, "\n" + fs.readdirSync(dest).join("\n"));
