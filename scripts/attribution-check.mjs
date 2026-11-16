#!/usr/bin/env node
// Fails if AI attribution appears in commit messages, PR text or tracked files.
//
//   node scripts/attribution-check.mjs                   tracked files + every commit on HEAD
//   node scripts/attribution-check.mjs --commits A..B    commit messages in a range
//   node scripts/attribution-check.mjs --message-file F  one message (commit-msg hook)
//   node scripts/attribution-check.mjs --text-file F     arbitrary text (PR title/body in CI)
//   node scripts/attribution-check.mjs --files           tracked files only
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const AI = String.raw`(claude|anthropic|chatgpt|openai|gpt-?\d|copilot|gemini|bard|cursor|codeium|windsurf|devin|tabnine|aider|ai(\s+assistant)?)`;

const RULES = [
  { name: "AI co-author trailer", re: new RegExp(String.raw`^\s*co-authored-by:.*\b${AI}\b`, "im") },
  { name: "AI vendor noreply address", re: /noreply@(anthropic|openai)\.com/i },
  { name: '"Generated with/by <AI>" line', re: new RegExp(String.raw`\b(generated|written|created|authored)\s+(with|by|using)\s+(\[)?${AI}\b`, "i") },
  { name: "robot-emoji attribution", re: /🤖\s*(generated|created|written)/i },
  { name: "AI tool link", re: /claude\.(com|ai)\/(claude-)?code|chatgpt\.com\/share/i },
];

// Files that must name the patterns in order to forbid them.
const EXEMPT_FILES = new Set(["CLAUDE.md", "scripts/attribution-check.mjs"]);

const git = (...args) => execFileSync("git", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });

/** Returns rule hits in `text` as `{ rule, line }`. */
function scan(text) {
  const hits = [];
  for (const rule of RULES) {
    const re = new RegExp(rule.re.source, rule.re.flags.replace("g", "") + "g");
    for (const m of text.matchAll(re)) {
      const lineStart = text.lastIndexOf("\n", m.index) + 1;
      const lineEnd = text.indexOf("\n", m.index);
      hits.push({ rule: rule.name, line: text.slice(lineStart, lineEnd < 0 ? undefined : lineEnd).trim() });
    }
  }
  return hits;
}

const problems = [];
const report = (where, text) => {
  for (const h of scan(text)) problems.push(`${where}: ${h.rule}\n    ${h.line}`);
};

function checkCommits(range) {
  const out = git("log", "--format=%H%x00%B%x1e", range);
  for (const rec of out.split("\x1e")) {
    const [sha, body] = rec.replace(/^\n/, "").split("\x00");
    if (sha && body !== undefined) report(`commit ${sha.slice(0, 7)}`, body);
  }
}

function checkFiles() {
  const files = git("ls-files", "-z").split("\0").filter(Boolean);
  for (const f of files) {
    if (EXEMPT_FILES.has(f)) continue;
    let buf;
    try {
      buf = readFileSync(f);
    } catch {
      continue; // deleted in the working tree
    }
    if (buf.includes(0)) continue; // binary
    report(f, buf.toString("utf8"));
  }
}

const args = process.argv.slice(2);
const values = (flag) => args.flatMap((a, i) => (a === flag && args[i + 1] ? [args[i + 1]] : []));

if (args.length === 0) {
  checkFiles();
  checkCommits("HEAD");
} else {
  if (args.includes("--files")) checkFiles();
  for (const r of values("--commits")) checkCommits(r);
  for (const f of values("--message-file")) {
    // Ignore git's commented template lines in the commit-msg hook.
    report("commit message", readFileSync(f, "utf8").replace(/^#.*$/gm, ""));
  }
  for (const f of values("--text-file")) report(f, readFileSync(f, "utf8"));
}

if (problems.length) {
  console.error("attribution-check: AI attribution is not allowed in this repository (see CLAUDE.md §3).\n");
  console.error(problems.map((p) => "  " + p).join("\n"));
  console.error("\nRemove these lines (for commits: git commit --amend, or git rebase -i to reword).");
  process.exit(1);
}
console.log("attribution-check: ok");
