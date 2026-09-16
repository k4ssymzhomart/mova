// demo.mjs — run the Heel Slide demo on this machine: `next dev` with simulated sensors, reachable from this
// machine only, against the Supabase project named in .env.local. The same command on macOS, Linux and Windows
// (cmd or PowerShell), with no new dependency.
//
//   npm run demo                  http://127.0.0.1:3000/signin
//   npm run demo -- --check       check the environment and exit; starts nothing
//   npm run demo -- --port 3001   another port
//   npm run demo -- --lan         also listen on the network (a phone on the same Wi-Fi). Anyone on that network can
//                                 then press the test sign-in buttons, so use it only on a network you trust.
//
// Why a script and not `NEXT_PUBLIC_SENSOR_SIMULATION=1 next dev`: an inline assignment is shell syntax that cmd and
// PowerShell do not understand, and npm runs package.json scripts through cmd on Windows. Here the flag goes into the
// child's environment, and Next's own bin runs under this Node, so no shell and no .cmd shim is involved.
//
// It reads the env files exactly as `next dev` will (@next/env in development mode: .env.development.local,
// .env.local, .env.development, .env) and checks them by NAME only. No value is ever printed.
//
// It never opens anything a production build keeps shut: the test sign-in and the simulation are still decided by
// NODE_ENV, which `next dev` alone makes "development".

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
// A pasted "# comment" arrives as arguments: zsh without interactivecomments (the macOS default) and cmd.exe do not
// treat # as a comment, and npm hands the words to the script.
const rawArgs = process.argv.slice(2);
const commentAt = rawArgs.findIndex((a) => a.startsWith("#"));
const args = commentAt >= 0 ? rawArgs.slice(0, commentAt) : rawArgs;
const KNOWN = new Set(["--check", "--lan", "--port", "--help", "-h"]);

function usage(code, problem) {
  if (problem) console.error(`demo: ${problem}`);
  console.log("Usage: npm run demo [-- --check] [-- --port <n>] [-- --lan]   (Windows PowerShell: npm.cmd run demo)");
  process.exit(code);
}
for (let i = 0; i < args.length; i += 1) {
  if (!KNOWN.has(args[i])) usage(2, `unknown argument ${JSON.stringify(args[i])}.`);
  if (args[i] === "--port") i += 1;
}
if (args.includes("--help") || args.includes("-h")) usage(0);

const CHECK_ONLY = args.includes("--check") || process.env.npm_config_check === "true";
const LAN = args.includes("--lan");
const portAt = args.indexOf("--port");
const port = portAt >= 0 ? args[portAt + 1] : process.env.PORT || "3000";
if (!/^\d{2,5}$/.test(port ?? "")) usage(2);

const errors = [];
const warnings = [];

const [major, minor] = process.versions.node.split(".").map(Number);
if (major < 18 || (major === 18 && minor < 17)) errors.push(`Node ${process.versions.node}: Next 14 needs 18.17 or newer.`);

const require = createRequire(resolve(root, "package.json"));
let nextBin;
let loadEnvConfig;
try {
  nextBin = require.resolve("next/dist/bin/next");
  // @next/env is Next's own loader (a dependency of next), resolved from next so it works however npm laid it out.
  ({ loadEnvConfig } = createRequire(require.resolve("next/package.json"))("@next/env"));
} catch {
  console.error("demo: Next.js is not installed here. Run `npm ci` in services/frontend first.");
  process.exit(1);
}

// The child gets the environment as it was before the env files were read: Next reads them again itself, and it
// skips that when it sees the marker loadEnvConfig leaves behind.
const shellEnv = { ...process.env };
if (shellEnv.NODE_ENV) {
  warnings.push(`NODE_ENV is set in this shell; the demo ignores it ("next dev" must run as development).`);
  delete process.env.NODE_ENV;
}
const quiet = { info() {}, warn() {}, error: console.error };
const { combinedEnv: env } = loadEnvConfig(root, true, quiet, true);
const set = (name) => typeof env[name] === "string" && env[name].trim() !== "";

for (const name of ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY"]) {
  if (!set(name)) errors.push(`${name} is not set. Put it in services/frontend/.env.local.`);
}
for (const name of ["HEEL_SLIDE_PATIENT_PASSWORD", "HEEL_SLIDE_CLINICIAN_PASSWORD"]) {
  if (!set(name)) {
    errors.push(`${name} is not set, so /signin will not show the test sign-in buttons. Ask for it privately.`);
  }
}
for (const name of ["HEEL_SLIDE_PATIENT_EMAIL", "HEEL_SLIDE_CLINICIAN_EMAIL"]) {
  if (set(name) && !env[name].trim().toLowerCase().endsWith("@mova.test")) {
    errors.push(`${name} is not a @mova.test address, so the test sign-in buttons stay hidden. Remove it.`);
  }
}
if (env.NEXT_PUBLIC_SENSOR_MOCK === "1") {
  warnings.push("NEXT_PUBLIC_SENSOR_MOCK=1 is in an env file. The demo turns it off: the mock never starts a session.");
}
if (set("SUPABASE_SERVICE_ROLE_KEY")) {
  warnings.push(
    "SUPABASE_SERVICE_ROLE_KEY is set. The app never reads it (only the seed does), and it bypasses every access " +
      "rule on a database with real patients. Remove it from a presenter's machine.",
  );
}
if (set("VERCEL_ENV")) {
  warnings.push(
    "VERCEL_ENV is set. It means nothing locally, and on `next start` VERCEL_ENV=preview would open the test " +
      "sign-in on a production build. Remove it from the env files.",
  );
}
if (!existsSync(resolve(root, ".env.local"))) warnings.push("There is no services/frontend/.env.local.");

for (const line of warnings) console.warn(`demo: warning: ${line}`);
if (errors.length > 0) {
  for (const line of errors) console.error(`demo: ${line}`);
  console.error("demo: nothing was started.");
  process.exit(1);
}

// Loopback only unless --lan. The printed address is the one Next prints; sign-in cookies belong to that host name.
const url = `http://${LAN ? "localhost" : "127.0.0.1"}:${port}/signin`;
if (CHECK_ONLY) {
  console.log(`demo: ready. \`npm run demo\` will serve ${url} with simulated sensors.`);
  process.exit(0);
}

const childEnv = { ...shellEnv, NEXT_PUBLIC_SENSOR_SIMULATION: "1", NEXT_PUBLIC_SENSOR_MOCK: "" };
delete childEnv.NODE_ENV;

console.log(`demo: simulated sensors on. Open ${url} (the first page takes a while to compile).`);
console.log("demo: sign in with «Войти как тестовый пациент» or «Войти как тестовый врач».");
console.log("demo: do not press «Dev auto-login · dev@mova.local»: it is not the seeded Heel Slide patient.");

const child = spawn(
  process.execPath,
  [nextBin, "dev", "--port", port, ...(LAN ? [] : ["--hostname", "127.0.0.1"])],
  { cwd: root, env: childEnv, stdio: "inherit" },
);
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => child.kill(signal));
}
child.on("exit", (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
