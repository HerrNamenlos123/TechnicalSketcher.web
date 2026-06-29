#!/usr/bin/env node
// Bumps the version, commits + tags it (via `npm version`), and pushes - which triggers
// .github/workflows/release-electron.yml to build and publish the Electron app to GitHub
// Releases. Usage: npm run release [-- patch|minor|major|<specific-version>] (default: patch)

import { execSync } from "node:child_process";

const bump = process.argv[2] ?? "patch";

function run(command) {
  execSync(command, { stdio: "inherit" });
}

function output(command) {
  return execSync(command, { encoding: "utf-8" }).trim();
}

const status = output("git status --porcelain");
if (status.length > 0) {
  console.error("Working tree is not clean. Commit or stash your changes before releasing.");
  process.exit(1);
}

console.log(`Bumping version (${bump})...`);
run(`npm version ${bump} -m "Release v%s"`);

console.log("Pushing commit and tag...");
run("git push --follow-tags");

const version = JSON.parse(output("npm pkg get version"));
console.log(`Released v${version}. The Electron build/publish workflow is now running in CI.`);
