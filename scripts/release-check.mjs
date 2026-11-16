#!/usr/bin/env node
// Consistency checks shared by local `npm run check` and CI.
//
//   node scripts/release-check.mjs              versions agree + CHANGELOG is well-formed
//   node scripts/release-check.mjs --tag v1.2.3 also require the tag to match and the
//                                               CHANGELOG to have a dated 1.2.3 section
//   node scripts/release-check.mjs --notes 1.2.3  print that version's CHANGELOG section
import { readFileSync } from "node:fs";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const fail = (msg) => {
  console.error(`release-check: ${msg}`);
  process.exit(1);
};

const changelog = read("CHANGELOG.md");

/** Body of `## [version] ...` up to the next `## [` heading. */
function section(version) {
  const lines = changelog.split(/\r?\n/);
  const start = lines.findIndex((l) => l.startsWith(`## [${version}]`));
  if (start < 0) return null;
  const end = lines.findIndex((l, i) => i > start && l.startsWith("## ["));
  return { heading: lines[start], body: lines.slice(start + 1, end < 0 ? undefined : end).join("\n").trim() };
}

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

if (args.includes("--notes")) {
  const s = section(flag("--notes"));
  if (!s) fail(`no CHANGELOG section for ${flag("--notes")}`);
  process.stdout.write(s.body.replace(/^\[[^\]]+\]: .*$/gm, "").trim() + "\n");
  process.exit(0);
}

// 1. One version everywhere.
const pkg = JSON.parse(read("package.json")).version;
const conf = JSON.parse(read("src-tauri/tauri.conf.json")).version;
const cargo = read("src-tauri/Cargo.toml").match(/^\[package\][\s\S]*?^version\s*=\s*"([^"]+)"/m)?.[1];
if (!(pkg === conf && conf === cargo)) {
  fail(`version mismatch: package.json=${pkg}, tauri.conf.json=${conf}, Cargo.toml=${cargo}`);
}

// 2. Keep a Changelog structure.
if (!section("Unreleased")) fail("CHANGELOG.md must keep an `## [Unreleased]` section at the top");
const allowed = new Set(["Added", "Changed", "Deprecated", "Removed", "Fixed", "Security"]);
for (const m of changelog.matchAll(/^### (.+)$/gm)) {
  if (!allowed.has(m[1].trim())) fail(`unknown CHANGELOG change type "### ${m[1]}" (use ${[...allowed].join(", ")})`);
}
for (const m of changelog.matchAll(/^## \[(?!Unreleased\])([^\]]+)\](.*)$/gm)) {
  if (!/^ - \d{4}-\d{2}-\d{2}( \[YANKED\])?$/.test(m[2])) {
    fail(`release heading "## [${m[1]}]${m[2]}" must be "## [x.y.z] - YYYY-MM-DD"`);
  }
  if (!new RegExp(`^\\[${m[1].replace(/\./g, "\\.")}\\]: `, "m").test(changelog)) {
    fail(`missing link reference for [${m[1]}] at the bottom of CHANGELOG.md`);
  }
}

// 3. Tag builds: tag == version and that version is released in the CHANGELOG.
const tag = flag("--tag");
if (tag) {
  if (tag !== `v${pkg}`) fail(`tag ${tag} does not match app version v${pkg}`);
  const s = section(pkg);
  if (!s) fail(`CHANGELOG.md has no "## [${pkg}] - YYYY-MM-DD" section; move Unreleased entries into it`);
  if (!s.body) fail(`CHANGELOG section for ${pkg} is empty`);
}

console.log(`release-check: ok (version ${pkg}${tag ? `, tag ${tag}` : ""})`);
