#!/usr/bin/env node
// Generates a single self-contained HTML dashboard from `status.mjs --json`.
//
// Why a separate file from status.mjs: status.mjs's job is to PROBE the repo
// (spawn typecheck/test commands, parse task files) and answer truthfully,
// possibly slowly (~8-20s). This script's job is only to RENDER that answer
// as something a phone browser can open with no terminal, no server, no
// network fetch — so a teammate mid-hackathon can glance at it between other
// work. Splitting them means the expensive probing logic has exactly one
// owner and this file can be regenerated cheaply and often.
//
// Usage:
//   node scripts/dashboard.mjs             writes dashboard.html at repo root, prints its path
//   node scripts/dashboard.mjs --out FILE   writes to FILE instead
//
// The output file embeds the full status.mjs JSON verbatim (inside a
// <script type="application/json"> tag, so nothing in it ever executes) plus
// a small `derived` block computed here — see buildDerived() — and is
// otherwise 100% inline CSS/JS. No CDN, no external fetch, works offline.

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, closeSync, openSync, unlinkSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..");
const TEMPLATE_PATH = join(__dirname, "dashboard-template.html");

// Which package directories each track's "run command" is assembled from.
// This is the same structural fact status.mjs itself encodes for its own
// TRACKS table — it is not a status verdict, so hardcoding the *mapping*
// here is fine; what each command actually says is read from disk below,
// never typed out by hand.
const TRACK_PACKAGE_DIRS = {
  T1: ["shared", "server"],
  T2: ["server"],
  T3: ["mobile"],
  // T5's spec names `browser/`, but the code that actually exists right now
  // lives in `web/` (see the exists.webDir vs exists.browserDir mismatch in
  // status.mjs's own output) — checking both means the run command reflects
  // whichever one is really on disk instead of only the name in the spec.
  T5: ["browser", "web"],
  T4: ["agent"],
};

function parseArgs(argv) {
  const out = { outPath: join(REPO_ROOT, "dashboard.html") };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--out" && argv[i + 1]) {
      out.outPath = resolve(process.cwd(), argv[i + 1]);
      i++;
    }
  }
  return out;
}

function runStatus() {
  // status.mjs writes its JSON with console.log and then calls process.exit(0)
  // on the very next line. When stdout is a *pipe* (which is what
  // execFileSync's captured `stdout` option gives you), that write is
  // asynchronous — process.exit(0) can fire before the write flushes, and the
  // output gets silently truncated (observed in practice: cut off at exactly
  // 8192 bytes, Node's pipe highWaterMark). Redirecting the child's stdout
  // straight to a real file — the same thing `node status.mjs --json > f`
  // does at the shell — makes the write synchronous instead, so nothing is
  // lost. Piping through execFileSync's buffer looked fine on a small report
  // and only broke once the JSON grew past one page; a temp file sidesteps
  // the whole failure mode rather than trusting a size threshold to hold.
  const tmpFile = join(tmpdir(), `xentinela-status-${process.pid}-${Date.now()}.json`);
  const fd = openSync(tmpFile, "w");
  try {
    execFileSync("node", [join(REPO_ROOT, "scripts", "status.mjs"), "--json"], {
      cwd: REPO_ROOT,
      stdio: ["ignore", fd, "inherit"],
      timeout: 40_000,
    });
  } catch (err) {
    console.error("dashboard: failed to run scripts/status.mjs --json");
    console.error(String(err.message || err));
    closeSync(fd);
    safeUnlink(tmpFile);
    process.exit(1);
  }
  closeSync(fd);

  let text;
  try {
    text = readFileSync(tmpFile, "utf8");
  } finally {
    safeUnlink(tmpFile);
  }
  try {
    return JSON.parse(text);
  } catch (err) {
    console.error("dashboard: status.mjs --json did not print valid JSON");
    console.error(`(captured ${text.length} bytes; first 500 shown)`);
    console.error(text.slice(0, 500));
    process.exit(1);
  }
}

function safeUnlink(path) {
  try {
    unlinkSync(path);
  } catch {
    // best-effort cleanup only
  }
}

function readPackageScripts(dir) {
  const pkgPath = join(REPO_ROOT, dir, "package.json");
  if (!existsSync(pkgPath)) return null;
  try {
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
    return pkg.scripts || {};
  } catch {
    return null; // malformed package.json — treated the same as "nothing usable here"
  }
}

// Builds a copy-pasteable command from whatever scripts actually exist in
// each package.json right now, rather than asserting a fixed string — so it
// can't go stale the way a hand-typed "cd server && npm test" would the
// moment someone renames a script.
function buildRunCommand(dirs) {
  const segments = [];
  let anyPackageExists = false;
  for (const dir of dirs) {
    const scripts = readPackageScripts(dir);
    if (scripts === null) continue;
    anyPackageExists = true;
    const steps = [];
    if (scripts.typecheck) steps.push("npm run typecheck");
    if (scripts.test) steps.push("npm test");
    if (scripts.check) steps.push("npm run check");
    if (steps.length > 0) segments.push(`cd ${dir} && ${steps.join(" && ")}`);
  }
  if (!anyPackageExists) {
    return { command: null, note: `not started — ${dirs.map((d) => d + "/").join(" or ")} not on disk yet` };
  }
  if (segments.length === 0) {
    return { command: null, note: `${dirs.join("/, ")} exist but define no typecheck/test/check script` };
  }
  return { command: segments.join("   &&   "), note: null };
}

function buildDerived(report) {
  const runCommands = {};
  for (const track of report.tracks || []) {
    const dirs = TRACK_PACKAGE_DIRS[track.id] || [];
    runCommands[track.id] = buildRunCommand(dirs);
  }
  return {
    dashboardGeneratedAt: new Date().toISOString(),
    runCommands,
  };
}

function escapeForInlineJsonScript(json) {
  // A JSON.stringify result can never contain a literal "</script>" close
  // tag by itself, but a probed command's captured stdout/stderr (embedded
  // as a JSON string) genuinely could — so guard the one sequence that
  // would end the surrounding <script> element early.
  return json.replace(/<\/(script)/gi, "<\\/$1");
}

function main() {
  const { outPath } = parseArgs(process.argv.slice(2));
  const report = runStatus();
  const derived = buildDerived(report);
  const payload = { ...report, derived };

  if (!existsSync(TEMPLATE_PATH)) {
    console.error(`dashboard: template not found at ${TEMPLATE_PATH}`);
    process.exit(1);
  }
  const template = readFileSync(TEMPLATE_PATH, "utf8");
  const jsonLiteral = escapeForInlineJsonScript(JSON.stringify(payload));

  if (!template.includes("__STATUS_JSON__")) {
    console.error("dashboard: template is missing the __STATUS_JSON__ placeholder");
    process.exit(1);
  }
  const html = template.replace("__STATUS_JSON__", () => jsonLiteral);

  writeFileSync(outPath, html, "utf8");
  console.log(outPath);
}

main();
