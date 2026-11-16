#!/usr/bin/env node
// Builds, signs and publishes a release from this machine (no GitHub Actions minutes).
//
//   npm run release:local            # draft release for the version in package.json
//   npm run release:local -- --publish   # publish immediately (installed copies see it)
//   npm run release:local -- --dry-run   # everything except tag, push and upload
//
// Steps: verify the version, CHANGELOG and a clean tree, run every check, build
// signed installers, write latest.json for the updater, tag + push, and create
// the GitHub release with all assets via `gh`.
//
// The updater key is read from TAURI_SIGNING_PRIVATE_KEY(_PASSWORD) if set,
// otherwise from %USERPROFILE%\.tauri\harbor-updater.key(.password).
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const publish = process.argv.includes("--publish");
const dryRun = process.argv.includes("--dry-run");
const fail = (msg) => {
  console.error(`release-local: ${msg}`);
  process.exit(1);
};
const run = (cmd, args, opts = {}) => {
  console.log(`\n> ${cmd} ${args.join(" ")}`);
  const r = spawnSync(cmd, args, { cwd: root, stdio: "inherit", shell: process.platform === "win32", ...opts });
  if (r.status !== 0) fail(`${cmd} ${args[0] ?? ""} failed`);
};
const out = (cmd, args) => execFileSync(cmd, args, { cwd: root, encoding: "utf8" }).trim();

// ---------- preconditions ----------

const version = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version;
const tag = `v${version}`;
const conf = JSON.parse(readFileSync(join(root, "src-tauri/tauri.conf.json"), "utf8"));
const product = conf.productName;

if (out("git", ["status", "--porcelain"])) fail("commit or stash your changes first");
if (!dryRun && out("git", ["tag", "--list", tag])) fail(`tag ${tag} already exists; bump the version first`);
const remote = out("gh", ["repo", "view", "--json", "nameWithOwner", "--jq", ".nameWithOwner"]);

const env = { ...process.env };
const keyDir = join(homedir(), ".tauri");
if (!env.TAURI_SIGNING_PRIVATE_KEY) {
  const keyFile = join(keyDir, "harbor-updater.key");
  if (!existsSync(keyFile)) fail(`no signing key: set TAURI_SIGNING_PRIVATE_KEY or create ${keyFile}`);
  env.TAURI_SIGNING_PRIVATE_KEY = readFileSync(keyFile, "utf8");
  const pw = join(keyDir, "harbor-updater.key.password");
  if (existsSync(pw)) env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD = readFileSync(pw, "utf8");
}

// ---------- verify and build ----------

run("node", ["scripts/release-check.mjs", "--tag", tag]);
run("npm", ["run", "check"]);
run("npx", ["tauri", "build"], { env });

const bundle = join(root, "src-tauri/target/release/bundle");
const nsis = join(bundle, "nsis", `${product}_${version}_x64-setup.exe`);
const msi = join(bundle, "msi", `${product}_${version}_x64_en-US.msi`);
for (const f of [nsis, `${nsis}.sig`, msi, `${msi}.sig`]) if (!existsSync(f)) fail(`missing build output ${f}`);

// ---------- updater manifest ----------

const notes = out("node", ["scripts/release-check.mjs", "--notes", version]);
const asset = (file) => `https://github.com/${remote}/releases/download/${tag}/${file.split(/[\\/]/).pop().replace(/ /g, ".")}`;
const nsisEntry = { signature: readFileSync(`${nsis}.sig`, "utf8").trim(), url: asset(nsis) };
const msiEntry = { signature: readFileSync(`${msi}.sig`, "utf8").trim(), url: asset(msi) };
const manifest = {
  version,
  notes,
  pub_date: new Date().toISOString(),
  platforms: {
    "windows-x86_64": nsisEntry,
    "windows-x86_64-nsis": nsisEntry,
    "windows-x86_64-msi": msiEntry,
  },
};
const work = mkdtempSync(join(tmpdir(), "harbor-release-"));
const latest = join(work, "latest.json");
const notesFile = join(work, "notes.md");
writeFileSync(latest, JSON.stringify(manifest, null, 2));
writeFileSync(notesFile, notes + "\n");
run("node", ["scripts/attribution-check.mjs", "--text-file", notesFile]);

if (dryRun) {
  console.log(`\nrelease-local: dry run OK for ${tag}. Manifest:\n${JSON.stringify({ ...manifest, notes: manifest.notes.slice(0, 80) + "…" }, null, 2)}`);
  console.log(`latest.json written to ${latest}`);
  process.exit(0);
}

// ---------- tag and publish ----------

run("git", ["tag", "-a", tag, "-m", `"${product} ${tag}"`]);
run("git", ["push", "origin", tag]);
run("gh", [
  "release",
  "create",
  tag,
  "--verify-tag",
  "--title",
  `"${product} ${tag}"`,
  "--notes-file",
  `"${notesFile}"`,
  ...(publish ? [] : ["--draft"]),
  `"${nsis}"`,
  `"${nsis}.sig"`,
  `"${msi}"`,
  `"${msi}.sig"`,
  `"${latest}"`,
]);

console.log(
  `\nrelease-local: ${tag} ${publish ? "published" : "drafted"}.` +
    (publish ? "" : " Publish it on GitHub so installed copies can update."),
);
