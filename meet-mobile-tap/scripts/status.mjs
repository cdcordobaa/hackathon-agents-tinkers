#!/usr/bin/env node
// status.mjs — derives SecureGuIA's build status straight from the repo on disk.
//
// Zero dependencies, on purpose: this has to run cleanly while three other
// workflows are mid-write in shared/, server/ and mobile/. Every fact below is
// either a filesystem probe or the exit code of a real command — nothing here
// is a status string we typed by hand. If a probe throws (a half-written
// package, a missing binary, a timeout) it is caught and reported as
// "unknown", never allowed to crash the whole report or silently read as
// "passing" — on this project, silence and success look identical, and this
// tool exists so that stops being true.
//
// Usage:
//   node scripts/status.mjs             human-readable coloured table
//   node scripts/status.mjs --json      same data as JSON (for a dashboard)

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const JSON_MODE = process.argv.includes("--json");
// A test file can leave an open handle (an un-closed WS/HTTP server) and hang
// forever instead of exiting — seen live on this repo. Every command probe is
// bounded by this, and probes for different packages run concurrently (see
// buildReport), so one hang costs its own timeout once, not once per track
// that happens to share the package.
const CMD_TIMEOUT_MS = 8_000;

// ---------------------------------------------------------------------------
// tiny colour helper — disabled for --json, for non-TTY, and when NO_COLOR is set
// ---------------------------------------------------------------------------
const useColor = !JSON_MODE && process.stdout.isTTY && !process.env.NO_COLOR;
const paint = (code, s) => (useColor ? `\x1b[${code}m${s}\x1b[0m` : s);
const c = {
  green: (s) => paint(32, s),
  red: (s) => paint(31, s),
  yellow: (s) => paint(33, s),
  dim: (s) => paint(2, s),
  bold: (s) => paint(1, s),
  cyan: (s) => paint(36, s),
};

// ---------------------------------------------------------------------------
// generic safe probes — every one of these can be handed a half-written
// package and must come back with a value, never throw past this file
// ---------------------------------------------------------------------------

/** Run fn(), returning { ok: true, value } or { ok: false, reason } on throw. */
function safe(fn) {
  try {
    return { ok: true, value: fn() };
  } catch (err) {
    return { ok: false, reason: err && err.message ? err.message : String(err) };
  }
}

/** Async twin of safe(): await fn(), same { ok, value|reason } shape. */
async function safeAsync(fn) {
  try {
    return { ok: true, value: await fn() };
  } catch (err) {
    return { ok: false, reason: err && err.message ? err.message : String(err) };
  }
}

function abs(...segments) {
  return path.join(ROOT, ...segments);
}

function pathExists(relPath) {
  return safe(() => existsSync(abs(relPath))).value ?? false;
}

function isNonEmptyDir(relPath) {
  return (
    safe(() => {
      const p = abs(relPath);
      if (!existsSync(p)) return false;
      if (!statSync(p).isDirectory()) return false;
      return readdirSync(p).length > 0;
    }).value ?? false
  );
}

function findFilesRecursive(relDir, predicate, maxDepth = 6) {
  const result = safe(() => {
    const root = abs(relDir);
    if (!existsSync(root)) return [];
    const found = [];
    const walk = (dir, depth) => {
      if (depth > maxDepth) return;
      let entries;
      try {
        entries = readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full, depth + 1);
        } else if (predicate(entry.name, full)) {
          found.push(path.relative(ROOT, full));
        }
      }
    };
    walk(root, 0);
    return found;
  });
  return result.ok ? result.value : [];
}

function readJSONFile(relPath) {
  return safe(() => JSON.parse(readFileSync(abs(relPath), "utf8")));
}

function readTextFile(relPath) {
  return safe(() => readFileSync(abs(relPath), "utf8"));
}

/**
 * Run a command with no shell (avoids sourcing the user's rc file, and avoids
 * shell-quoting bugs), bounded by CMD_TIMEOUT_MS, and async so independent
 * probes can run concurrently instead of stacking their worst-case latency.
 *
 * Runs `detached` (its own process group) and kills the whole group, not just
 * the direct child: `npm run test` -> `node --test file.ts` -> node:test's
 * own per-file worker subprocess is three generations deep, and an open
 * socket lives in that innermost one. Killing only the immediate child left
 * real orphans running on this machine during development — confirmed with
 * `ps aux` after a timeout — so this kills -PID (the group), not PID.
 */
function runCommand(command, args, cwd) {
  return safeAsync(
    () =>
      new Promise((resolve, reject) => {
        let child;
        try {
          child = spawn(command, args, { cwd: abs(cwd), shell: false, detached: true });
        } catch (err) {
          reject(err);
          return;
        }
        let stdout = "";
        let stderr = "";
        let timedOut = false;
        let settled = false;
        const killGroup = (signal) => {
          try {
            process.kill(-child.pid, signal);
          } catch {
            // group already gone (e.g. every process in it already exited) — fine
          }
        };
        child.stdout?.on("data", (d) => (stdout += d));
        child.stderr?.on("data", (d) => (stderr += d));
        child.on("error", (err) => {
          if (!settled) {
            settled = true;
            clearTimeout(killTimer);
            if (forceKill) clearTimeout(forceKill);
            reject(err); // e.g. ENOENT — binary not found
          }
        });
        let forceKill;
        const killTimer = setTimeout(() => {
          timedOut = true;
          killGroup("SIGTERM");
          forceKill = setTimeout(() => killGroup("SIGKILL"), 2000);
        }, CMD_TIMEOUT_MS);
        child.on("close", (status, signal) => {
          if (settled) return;
          settled = true;
          clearTimeout(killTimer);
          if (forceKill) clearTimeout(forceKill);
          // The direct child closing after we'd already sent SIGTERM to the
          // group doesn't guarantee every process in it took the hint —
          // finish the sweep now instead of waiting out the 2s force-kill timer.
          if (timedOut) killGroup("SIGKILL");
          resolve({ status, signal, stdout, stderr, timedOut });
        });
      }),
  );
}

// eslint-disable-next-line no-control-regex
const ANSI_RE = /\x1b\[[0-9;]*m/g;
/** Strip colour codes so JSON output (consumed by a dashboard) stays plain text. */
function stripAnsi(s) {
  return s.replace(ANSI_RE, "");
}

/** First line that looks like a real error, for a fast eyeball diagnosis. */
function firstErrorLine(output) {
  const lines = output.split("\n");
  const patterns = [
    /error TS\d+/, // tsc
    /^not ok \d/, // node --test TAP
    /Error:/,
    /\.ts\(\d+,\d+\)/,
  ];
  for (const line of lines) {
    if (patterns.some((re) => re.test(line))) return line.trim();
  }
  // fall back to the first non-empty line of stderr-ish output
  const nonEmpty = lines.map((l) => l.trim()).filter(Boolean);
  return nonEmpty[0] ?? null;
}

// Several tracks share a package (T1 and T2 both look at server/, the demo
// check and T4 both look at agent/) — memoize *promises*, so concurrent
// callers for the same package+script share one in-flight run instead of
// each starting their own.
const scriptResultCache = new Map();

/**
 * Run a package.json script by name if the package and the script both
 * exist. Returns a small typed result; never throws (rejects).
 */
function runPackageScript(pkgRelDir, scriptName, { fallbackArgs } = {}) {
  const cacheKey = `${pkgRelDir}::${scriptName}`;
  if (scriptResultCache.has(cacheKey)) return scriptResultCache.get(cacheKey);
  const promise = runPackageScriptUncached(pkgRelDir, scriptName, { fallbackArgs });
  scriptResultCache.set(cacheKey, promise);
  return promise;
}

async function runPackageScriptUncached(pkgRelDir, scriptName, { fallbackArgs } = {}) {
  const pkgJsonPath = path.join(pkgRelDir, "package.json");
  if (!pathExists(pkgJsonPath)) {
    return { status: "not_applicable", reason: `${pkgRelDir}/package.json does not exist` };
  }
  const pkgJson = readJSONFile(pkgJsonPath);
  if (!pkgJson.ok) {
    return { status: "unknown", reason: `could not parse ${pkgRelDir}/package.json: ${pkgJson.reason}` };
  }
  const scripts = pkgJson.value.scripts || {};
  let command, args;
  if (scripts[scriptName]) {
    command = "npm";
    args = ["run", scriptName, "--silent"];
  } else if (fallbackArgs) {
    // e.g. mobile has no "typecheck" script but does have typescript installed
    if (!pathExists(path.join(pkgRelDir, fallbackArgs.probePath))) {
      return { status: "no_script", reason: `no "${scriptName}" script and no ${fallbackArgs.probePath}` };
    }
    command = fallbackArgs.command;
    args = fallbackArgs.args;
  } else {
    return { status: "no_script", reason: `package.json has no "${scriptName}" script` };
  }

  const run = await runCommand(command, args, pkgRelDir);
  if (!run.ok) {
    return { status: "unknown", reason: `failed to spawn: ${run.reason}` };
  }
  const { status, timedOut, stdout, stderr } = run.value;
  const combined = stripAnsi(`${stdout}\n${stderr}`);
  if (timedOut) {
    return { status: "timeout", reason: `exceeded ${CMD_TIMEOUT_MS}ms — likely an open handle (server/socket) left by a test`, firstError: firstErrorLine(combined) };
  }
  if (status === 0) {
    return { status: "pass", output: combined.trim().slice(0, 4000) };
  }
  return { status: "fail", exitCode: status, firstError: firstErrorLine(combined), output: combined.trim().slice(-4000) };
}

/** Parse node:test TAP summary lines ("# tests N", "# pass N", "# fail N"). */
function parseNodeTestCounts(output) {
  const grab = (label) => {
    const m = output.match(new RegExp(`^# ${label} (\\d+)$`, "m"));
    return m ? Number(m[1]) : null;
  };
  return {
    tests: grab("tests"),
    pass: grab("pass"),
    fail: grab("fail"),
    skipped: grab("skipped"),
  };
}

// ---------------------------------------------------------------------------
// openspec tasks.md parsing
// ---------------------------------------------------------------------------

function countTasks(changeSlug) {
  const relPath = path.join("openspec", "changes", changeSlug, "tasks.md");
  if (!pathExists(relPath)) {
    return { present: false };
  }
  const text = readTextFile(relPath);
  if (!text.ok) {
    return { present: true, error: text.reason };
  }
  const lines = text.value.split("\n");
  let done = 0;
  let total = 0;
  for (const line of lines) {
    const m = line.match(/^\s*-\s\[([ xX])\]/);
    if (!m) continue;
    total += 1;
    if (m[1].toLowerCase() === "x") done += 1;
  }
  return { present: true, done, total };
}

function allOpenspecChanges() {
  const dir = abs("openspec", "changes");
  const result = safe(() => {
    if (!existsSync(dir)) return [];
    return readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isDirectory() && e.name !== "archive")
      .map((e) => e.name)
      .sort();
  });
  return result.ok ? result.value : [];
}

// ---------------------------------------------------------------------------
// .env.example vs .env — presence only, never values
// ---------------------------------------------------------------------------

function parseEnvExampleKeys(text) {
  const keys = [];
  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (!line) continue;
    const m = line.match(/^(#\s*)?([A-Z][A-Z0-9_]*)\s*=/);
    if (!m) continue;
    keys.push({ key: m[2], optional: Boolean(m[1]) });
  }
  // de-dupe, keeping the first sighting's "optional" flag
  const seen = new Map();
  for (const { key, optional } of keys) {
    if (!seen.has(key)) seen.set(key, optional);
  }
  return [...seen.entries()].map(([key, optional]) => ({ key, optional }));
}

function parseEnvFileKeys(text) {
  const set = new Map(); // key -> hasNonEmptyValue
  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const m = line.match(/^([A-Z][A-Z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    set.set(m[1], m[2].trim().length > 0);
  }
  return set;
}

function envStatus(pkgRelDir) {
  const examplePath = path.join(pkgRelDir, ".env.example");
  if (!pathExists(examplePath)) {
    return { hasExample: false };
  }
  const exampleText = readTextFile(examplePath);
  if (!exampleText.ok) {
    return { hasExample: true, error: exampleText.reason };
  }
  const declared = parseEnvExampleKeys(exampleText.value);

  const envPath = path.join(pkgRelDir, ".env");
  const envFilePresent = pathExists(envPath);
  let actual = new Map();
  if (envFilePresent) {
    const envText = readTextFile(envPath);
    if (envText.ok) actual = parseEnvFileKeys(envText.value);
  }

  const vars = declared.map(({ key, optional }) => {
    let status;
    if (!envFilePresent) status = "missing";
    else if (!actual.has(key)) status = "missing";
    else if (!actual.get(key)) status = "empty";
    else status = "set";
    return { key, optional, status };
  });

  const missingRequired = vars.filter((v) => !v.optional && v.status !== "set").map((v) => v.key);

  return { hasExample: true, envFilePresent, vars, missingRequired };
}

// ---------------------------------------------------------------------------
// per-track definitions
//
// The slug lists below are the *current* best mapping of a hackathon track to
// the openspec change(s) that describe it — mapping metadata, not a status
// verdict. Any change directory not claimed by a track is still parsed and
// reported, under "unmappedOpenspecChanges", so a renamed/new proposal is
// never silently dropped.
// ---------------------------------------------------------------------------

const TRACKS = [
  {
    id: "T1",
    name: "contract + gateway",
    owns: "shared/ + server/ core, session registry, WS fan-out, replay source",
    openspec: ["add-call-session-contracts"],
    existsProbe() {
      const shared = isNonEmptyDir("shared/src");
      const server = isNonEmptyDir("server");
      return { shared, server };
    },
    packages: ["shared", "server"],
  },
  {
    id: "T2",
    name: "twilio",
    owns: "voice webhook, forwarding TwiML, transcription + status callbacks",
    openspec: ["add-twilio-call-transport"],
    existsProbe() {
      const server = isNonEmptyDir("server");
      const twilioFiles = findFilesRecursive("server", (name) => /twilio/i.test(name));
      return { server, twilioFiles: twilioFiles.length, files: twilioFiles };
    },
    packages: ["server"],
  },
  {
    id: "T3",
    name: "mobile",
    owns: "CopilotKit headless UI, risk HUD, transcript, flags",
    openspec: ["add-mobile-call-shell", "add-copilot-fraud-assistant"],
    existsProbe() {
      const mobileApp = pathExists("mobile/App.tsx");
      const pkg = readJSONFile("mobile/package.json");
      const hasCopilotKitDep = pkg.ok
        ? Object.keys({ ...(pkg.value.dependencies || {}), ...(pkg.value.devDependencies || {}) }).some((d) =>
            d.includes("copilotkit"),
          )
        : false;
      const hudFiles = findFilesRecursive("mobile/src", (name) => /hud|risk|copilot/i.test(name));
      return { mobileApp, hasCopilotKitDep, hudFiles: hudFiles.length, files: hudFiles };
    },
    packages: ["mobile"],
  },
  {
    id: "T4",
    name: "fixtures + eval",
    owns: "agent/src/fixtures/ + agent/src/eval/ (outside Codex session)",
    openspec: ["add-fraud-analysis-evaluation"],
    existsProbe() {
      const fixtures = isNonEmptyDir("agent/src/fixtures");
      const evalDir = isNonEmptyDir("agent/src/eval");
      return { fixtures, eval: evalDir };
    },
    packages: ["agent"],
  },
  {
    id: "T5",
    name: "browser LiveKit rung",
    owns: "browser joins LiveKit room, transcribes locally, POSTs segments to gateway",
    // discovered dynamically below since this track was "not yet specced" as of the brief
    openspec: [],
    existsProbe() {
      const browserDir = isNonEmptyDir("browser");
      const webDir = isNonEmptyDir("web");
      return { browserDir, webDir };
    },
    packages: ["browser"],
  },
];

// T5's spec may have landed mid-build (another workflow is writing openspec
// proposals right now) — pick it up by name pattern rather than hardcoding
// whether it exists.
{
  const t5 = TRACKS.find((t) => t.id === "T5");
  const candidates = allOpenspecChanges().filter((slug) => /browser.*livekit|livekit.*rung|browser.*rung/i.test(slug));
  t5.openspec = candidates;
}

const CLAIMED_SLUGS = new Set(TRACKS.flatMap((t) => t.openspec));

// ---------------------------------------------------------------------------
// build the report
// ---------------------------------------------------------------------------

async function buildTrackReport(track) {
  const exists = safe(() => track.existsProbe());
  const existsSummary = exists.ok ? exists.value : { unknown: true, reason: exists.reason };

  const typecheck = {};
  const tests = {};
  // Packages run concurrently (and de-dupe with any other track probing the
  // same package, via runPackageScript's cache) so N packages cost one
  // command's worst-case latency, not N of them stacked.
  await Promise.all(
    track.packages.map(async (pkg) => {
      const pkgJsonPath = path.join(pkg, "package.json");
      if (!pathExists(pkgJsonPath)) {
        typecheck[pkg] = { status: "not_started", reason: `${pkg}/ does not exist yet` };
        tests[pkg] = { status: "not_started", reason: `${pkg}/ does not exist yet` };
        return;
      }
      const tcFallback =
        pkg === "mobile"
          ? { probePath: "node_modules/typescript/bin/tsc", command: "node", args: ["node_modules/typescript/bin/tsc", "--noEmit"] }
          : undefined;

      const [tcResult, testResult] = await Promise.all([
        safeAsync(() => runPackageScript(pkg, "typecheck", { fallbackArgs: tcFallback })),
        safeAsync(() => runPackageScript(pkg, "test")),
      ]);

      typecheck[pkg] = tcResult.ok ? tcResult.value : { status: "unknown", reason: tcResult.reason };

      if (!testResult.ok) {
        tests[pkg] = { status: "unknown", reason: testResult.reason };
      } else {
        const r = testResult.value;
        if (r.status === "pass" || r.status === "fail") {
          const counts = parseNodeTestCounts(r.output || "");
          tests[pkg] = { ...r, counts };
        } else {
          tests[pkg] = r;
        }
      }
    }),
  );

  const taskCounts = track.openspec.length
    ? Object.fromEntries(track.openspec.map((slug) => [slug, countTasks(slug)]))
    : {};
  const taskTotals = Object.values(taskCounts).reduce(
    (acc, t) => (t.present && typeof t.total === "number" ? { done: acc.done + t.done, total: acc.total + t.total } : acc),
    { done: 0, total: 0 },
  );

  return {
    id: track.id,
    name: track.name,
    owns: track.owns,
    exists: existsSummary,
    typecheck,
    tests,
    tasks: { changes: track.openspec, byChange: taskCounts, done: taskTotals.done, total: taskTotals.total },
  };
}

function deriveBlocked(trackId, trackReports) {
  const byId = Object.fromEntries(trackReports.map((t) => [t.id, t]));
  const reasons = [];
  const sharedExists = byId.T1?.exists?.shared === true;
  const serverExists = byId.T1?.exists?.server === true;

  if (trackId === "T2" && !serverExists) {
    reasons.push("server/ (T1 gateway core) does not exist yet — nowhere to receive Twilio callbacks");
  }
  if (trackId === "T3") {
    if (!sharedExists) reasons.push("shared/ contract package does not exist yet — no typed event union to render against");
    if (!serverExists) reasons.push("server/ gateway not present — mobile has no live WS source, only replay/mocks");
  }
  if (trackId === "T5") {
    if (!sharedExists) reasons.push("shared/ contract package does not exist yet — no event shape to POST");
    if (!serverExists) reasons.push("server/ gateway not present — nowhere to POST transcribed segments");
    if (byId.T5?.tasks?.changes?.length === 0) reasons.push("no openspec change proposal found for this track yet");
  }
  if (trackId === "T4") {
    // T4 depends on agent/'s own schema, which already exists — rarely blocked.
    if (byId.T1 && !sharedExists) reasons.push("shared/ not present — re-export of RiskProfile for other tracks is missing (does not block agent-local eval work)");
  }
  return reasons;
}

async function checkAgentDemo() {
  const demoScriptPresent = safe(() => {
    const pkg = readJSONFile("agent/package.json");
    if (!pkg.ok) throw new Error(pkg.reason);
    return Boolean(pkg.value.scripts && pkg.value.scripts.demo);
  });
  const replayFilePresent = pathExists("agent/src/replay.ts");
  const fixturePresent = pathExists("agent/src/fixtures/bank-scam.ts");
  // Shares the cache with T4's agent typecheck — runs once between them.
  const typecheck = await safeAsync(() => runPackageScript("agent", "typecheck"));

  const tcValue = typecheck.ok ? typecheck.value : { status: "unknown", reason: typecheck.reason };
  const intact =
    (demoScriptPresent.ok ? demoScriptPresent.value : false) &&
    replayFilePresent &&
    fixturePresent &&
    tcValue.status === "pass";

  return {
    demoScriptPresent: demoScriptPresent.ok ? demoScriptPresent.value : { unknown: true, reason: demoScriptPresent.reason },
    replayFilePresent,
    fixturePresent,
    typecheck: tcValue,
    intact,
  };
}

async function checkAgentCheck() {
  const envPath = "agent/.env";
  const hasEnvFile = pathExists(envPath);
  let modelKeyPresent = false;
  let whichKey = null;
  if (hasEnvFile) {
    const text = readTextFile(envPath);
    if (text.ok) {
      const keys = parseEnvFileKeys(text.value);
      for (const candidate of ["GEMINI_API_KEY", "OPENAI_API_KEY"]) {
        if (keys.get(candidate)) {
          modelKeyPresent = true;
          whichKey = candidate;
          break;
        }
      }
    }
  }

  const runResult = await safeAsync(() => runPackageScript("agent", "check"));
  const check = runResult.ok ? runResult.value : { status: "unknown", reason: runResult.reason };

  return { hasEnvFile, modelKeyPresent, whichKey, check };
}

async function buildReport() {
  const warnings = [];

  // Everything below is either a pure fs read or a spawned command bounded by
  // CMD_TIMEOUT_MS — run it all concurrently so the wall-clock cost is one
  // command's worst case, not the sum of every command in the report.
  const [trackResults, demo, agentCheck] = await Promise.all([
    Promise.all(
      TRACKS.map(async (t) => {
        const r = await safeAsync(() => buildTrackReport(t));
        if (!r.ok) {
          warnings.push(`${t.id}: report build failed — ${r.reason}`);
          return { id: t.id, name: t.name, owns: t.owns, status: "unknown", reason: r.reason };
        }
        return r.value;
      }),
    ),
    safeAsync(() => checkAgentDemo()),
    safeAsync(() => checkAgentCheck()),
  ]);

  const trackReports = trackResults;
  for (const track of trackReports) {
    track.blocked = safe(() => deriveBlocked(track.id, trackReports)).value ?? [];
  }

  const envPackages = ["agent", "mobile", "server", "shared"];
  const env = Object.fromEntries(
    envPackages.map((pkg) => {
      const r = safe(() => envStatus(pkg));
      return [pkg, r.ok ? r.value : { unknown: true, reason: r.reason }];
    }),
  );

  const allChanges = allOpenspecChanges();
  const unmapped = allChanges.filter((slug) => !CLAIMED_SLUGS.has(slug));
  const unmappedTasks = Object.fromEntries(unmapped.map((slug) => [slug, countTasks(slug)]));

  return {
    generatedAt: new Date().toISOString(),
    repoRoot: ROOT,
    tracks: trackReports,
    demo: demo.ok ? demo.value : { unknown: true, reason: demo.reason },
    agentCheck: agentCheck.ok ? agentCheck.value : { unknown: true, reason: agentCheck.reason },
    env,
    openspec: {
      allChanges,
      unmapped,
      unmappedTasks,
    },
    warnings,
  };
}

// ---------------------------------------------------------------------------
// human-readable rendering
// ---------------------------------------------------------------------------

function statusBadge(status) {
  switch (status) {
    case "pass":
    case true:
      return c.green("PASS");
    case "fail":
    case false:
      return c.red("FAIL");
    case "not_started":
      return c.dim("not started");
    case "no_script":
    case "not_applicable":
      return c.dim("n/a");
    case "timeout":
      return c.yellow("TIMEOUT");
    default:
      return c.yellow(String(status));
  }
}

function renderExists(exists) {
  if (exists.unknown) return c.yellow(`unknown (${exists.reason})`);
  return Object.entries(exists)
    .map(([k, v]) => `${k}: ${typeof v === "boolean" ? (v ? c.green("yes") : c.dim("no")) : v}`)
    .join("  ");
}

function renderTypecheckOrTests(map, isTest) {
  return Object.entries(map)
    .map(([pkg, r]) => {
      if (r.status === "pass") {
        if (isTest && r.counts && r.counts.tests != null) {
          return `${pkg}: ${statusBadge("pass")} (${r.counts.pass}/${r.counts.tests})`;
        }
        return `${pkg}: ${statusBadge("pass")}`;
      }
      if (r.status === "fail") {
        const extra = isTest && r.counts && r.counts.tests != null ? ` (${r.counts.pass}/${r.counts.tests})` : "";
        return `${pkg}: ${statusBadge("fail")}${extra} — ${c.dim(r.firstError || "see output")}`;
      }
      if (r.status === "not_started" || r.status === "no_script" || r.status === "not_applicable") {
        return `${pkg}: ${statusBadge(r.status)} (${r.reason})`;
      }
      if (r.status === "timeout") {
        return `${pkg}: ${statusBadge("timeout")} (${r.reason})`;
      }
      return `${pkg}: ${c.yellow("unknown")} (${r.reason || "no reason given"})`;
    })
    .join("\n            ");
}

function renderTasks(tasks) {
  if (!tasks.changes.length) return c.dim("no openspec change mapped yet");
  const lines = tasks.changes.map((slug) => {
    const t = tasks.byChange[slug];
    if (!t.present) return `${slug}: ${c.yellow("tasks.md not found")}`;
    if (t.error) return `${slug}: ${c.yellow("could not parse — " + t.error)}`;
    const pct = t.total > 0 ? Math.round((t.done / t.total) * 100) : 0;
    return `${slug}: ${t.done}/${t.total} done (${pct}%)`;
  });
  if (tasks.changes.length > 1) {
    lines.push(c.bold(`total: ${tasks.done}/${tasks.total}`));
  }
  return lines.join("\n            ");
}

function renderEnvVars(pkgEnv) {
  if (!pkgEnv || pkgEnv.unknown) return c.yellow(`unknown${pkgEnv?.reason ? " — " + pkgEnv.reason : ""}`);
  if (!pkgEnv.hasExample) return c.dim("no .env.example");
  if (!pkgEnv.vars.length) return c.dim(".env.example has no KEY= lines");
  return pkgEnv.vars
    .map((v) => {
      const label = v.optional ? `${v.key}${c.dim("(optional)")}` : v.key;
      const badge = v.status === "set" ? c.green("set") : v.status === "empty" ? c.yellow("empty") : v.optional ? c.dim("unset") : c.red("MISSING");
      return `${label}=${badge}`;
    })
    .join("  ");
}

function renderHuman(report) {
  const lines = [];
  lines.push(c.bold("SecureGuIA — repo status") + c.dim(`  (${report.generatedAt})`));
  lines.push("");

  for (const t of report.tracks) {
    lines.push(c.bold(`${t.id} — ${t.name}`) + c.dim(`  (owns: ${t.owns})`));
    if (t.status === "unknown") {
      lines.push(`  ${c.yellow("could not build report")}: ${t.reason}`);
      lines.push("");
      continue;
    }
    lines.push(`  EXISTS:     ${renderExists(t.exists)}`);
    lines.push(`  TYPECHECK:  ${renderTypecheckOrTests(t.typecheck, false)}`);
    lines.push(`  TESTS:      ${renderTypecheckOrTests(t.tests, true)}`);
    lines.push(`  TASKS:      ${renderTasks(t.tasks)}`);
    lines.push(`  BLOCKED:    ${t.blocked.length ? t.blocked.join("\n              ") : c.green("nothing detected")}`);
    lines.push("");
  }

  lines.push(c.bold("Demo integrity (agent/ npm run demo)"));
  const d = report.demo;
  if (d.unknown) {
    lines.push(`  ${c.yellow("unknown")}: ${d.reason}`);
  } else {
    lines.push(`  demo script present:    ${d.demoScriptPresent === true ? c.green("yes") : c.red("no")}`);
    lines.push(`  replay.ts present:      ${d.replayFilePresent ? c.green("yes") : c.red("no")}`);
    lines.push(`  fixture present:        ${d.fixturePresent ? c.green("yes") : c.red("no")}`);
    lines.push(`  agent typecheck:        ${statusBadge(d.typecheck.status)}${d.typecheck.firstError ? "  " + c.dim(d.typecheck.firstError) : ""}`);
    lines.push(`  ${c.bold("=> demo intact:")}         ${d.intact ? c.green("YES") : c.red("NO")}`);
  }
  lines.push("");

  lines.push(c.bold("agent/npm run check (best single predictor of a working demo)"));
  const a = report.agentCheck;
  if (a.unknown) {
    lines.push(`  ${c.yellow("unknown")}: ${a.reason}`);
  } else {
    lines.push(`  .env present:      ${a.hasEnvFile ? c.green("yes") : c.red("no")}`);
    lines.push(`  model key present: ${a.modelKeyPresent ? c.green("yes (" + a.whichKey + ")") : c.red("no")}`);
    lines.push(`  npm run check:     ${statusBadge(a.check.status)}${a.check.firstError ? "  " + c.dim(a.check.firstError) : ""}`);
  }
  lines.push("");

  lines.push(c.bold("Env vars (declared in .env.example vs present in .env — values never shown)"));
  for (const [pkg, pkgEnv] of Object.entries(report.env)) {
    lines.push(`  ${pkg.padEnd(8)} ${renderEnvVars(pkgEnv)}`);
  }
  lines.push("");

  if (report.openspec.unmapped.length) {
    lines.push(c.bold("Other openspec changes (not mapped to T1-T5)"));
    for (const slug of report.openspec.unmapped) {
      const t = report.openspec.unmappedTasks[slug];
      const summary = t.present ? `${t.done}/${t.total} done` : c.yellow("tasks.md not found");
      lines.push(`  ${slug}: ${summary}`);
    }
    lines.push("");
  }

  if (report.warnings.length) {
    lines.push(c.bold(c.yellow("Warnings (probes that could not run)")));
    for (const w of report.warnings) lines.push(`  - ${w}`);
    lines.push("");
  }

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

const report = await buildReport();

if (JSON_MODE) {
  process.stdout.write(JSON.stringify(report, null, 2) + "\n");
} else {
  process.stdout.write(renderHuman(report) + "\n");
}

process.exit(0); // status report, not a gate — always exit 0
