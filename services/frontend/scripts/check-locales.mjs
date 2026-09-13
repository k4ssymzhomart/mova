// Checks the locale dictionaries. ru.json and en.json must have identical key sets. kk.json may be partial
// (missing keys fall back to Russian at runtime) but must not contain keys Russian lacks. Exits 1 on failure.
import { readFileSync } from "node:fs";

const load = (loc) => JSON.parse(readFileSync(new URL(`../src/locales/${loc}.json`, import.meta.url), "utf8"));
const keys = (obj, prefix = "") =>
  Object.entries(obj).flatMap(([k, v]) => (v && typeof v === "object" ? keys(v, `${prefix}${k}.`) : [`${prefix}${k}`]));

const ru = new Set(keys(load("ru")));
const en = new Set(keys(load("en")));
const kk = new Set(keys(load("kk")));

const onlyRu = [...ru].filter((k) => !en.has(k));
const onlyEn = [...en].filter((k) => !ru.has(k));
const kkExtra = [...kk].filter((k) => !ru.has(k));

let failed = false;
if (onlyRu.length) { failed = true; console.error(`Missing from en.json (${onlyRu.length}):\n  ${onlyRu.join("\n  ")}`); }
if (onlyEn.length) { failed = true; console.error(`Missing from ru.json (${onlyEn.length}):\n  ${onlyEn.join("\n  ")}`); }
if (kkExtra.length) { failed = true; console.error(`In kk.json but not ru.json (${kkExtra.length}):\n  ${kkExtra.join("\n  ")}`); }

console.log(`ru ${ru.size} · en ${en.size} · kk ${kk.size} (${Math.round((kk.size / ru.size) * 100)}% of ru; the rest falls back to Russian)`);
if (failed) process.exit(1);
