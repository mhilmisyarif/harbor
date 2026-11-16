#!/usr/bin/env node
// Points git at the repo's .githooks directory. Runs on `npm install`; harmless
// outside a git checkout (for example in a packed tarball).
import { execFileSync } from "node:child_process";

try {
  execFileSync("git", ["rev-parse", "--is-inside-work-tree"], { stdio: "ignore" });
  execFileSync("git", ["config", "core.hooksPath", ".githooks"], { stdio: "ignore" });
} catch {
  // Not a git checkout; nothing to install.
}
