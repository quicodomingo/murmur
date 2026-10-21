// Checks the interface translations (src/locales): every language has the same namespaces and
// keys as Catalan (the source), the same {{placeholders}}, no empty strings and no em dashes.
//     node scripts/check-locales.mjs
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = new URL("../src/locales/", import.meta.url).pathname;
const SOURCE = "ca";
const languages = readdirSync(root).filter((d) => !d.startsWith("."));
const problems = [];

/** "a.b.c" → string, for every leaf; plural keys (_one, _other…) folded into their base. */
function flatten(obj, prefix = "", out = {}) {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === "object") flatten(v, key, out);
    else out[key] = v;
  }
  return out;
}
const PLURAL = /_(zero|one|two|few|many|other)$/;
const base = (key) => key.replace(PLURAL, "");
const vars = (s) => [...String(s).matchAll(/\{\{\s*([\w.]+)[^}]*\}\}/g)].map((m) => m[1]).sort().join(",");

function load(lang) {
  const out = {};
  for (const file of readdirSync(join(root, lang)).filter((f) => f.endsWith(".json"))) {
    out[file.replace(/\.json$/, "")] = flatten(JSON.parse(readFileSync(join(root, lang, file), "utf8")));
  }
  return out;
}

const source = load(SOURCE);
for (const lang of languages) {
  const strings = load(lang);
  for (const [ns, keys] of Object.entries(strings)) {
    if (!source[ns]) problems.push(`${lang}/${ns}.json: namespace missing in ${SOURCE}`);
    for (const [key, value] of Object.entries(keys)) {
      if (typeof value !== "string" || !value.trim()) problems.push(`${lang}/${ns}: ${key} is empty`);
      if (String(value).includes("—")) problems.push(`${lang}/${ns}: ${key} has an em dash`);
    }
  }
  if (lang === SOURCE) continue;
  for (const [ns, keys] of Object.entries(source)) {
    const theirs = strings[ns];
    if (!theirs) {
      problems.push(`${lang}/${ns}.json is missing`);
      continue;
    }
    const theirBases = new Set(Object.keys(theirs).map(base));
    for (const [key, value] of Object.entries(keys)) {
      if (!theirBases.has(base(key))) {
        problems.push(`${lang}/${ns}: missing ${key}`);
        continue;
      }
      // Plural forms differ between languages; compare placeholders on the exact key when it exists.
      if (key in theirs && vars(value) !== vars(theirs[key]))
        problems.push(`${lang}/${ns}: ${key} has {{${vars(theirs[key])}}}, ${SOURCE} has {{${vars(value)}}}`);
    }
    const ourBases = new Set(Object.keys(keys).map(base));
    for (const key of Object.keys(theirs)) if (!ourBases.has(base(key))) problems.push(`${lang}/${ns}: ${key} is not in ${SOURCE}`);
  }
}

if (problems.length) {
  console.error(problems.join("\n"));
  console.error(`\n${problems.length} problem(s)`);
  process.exit(1);
}
const count = Object.values(source).reduce((n, keys) => n + Object.keys(keys).length, 0);
console.log(`${languages.join(", ")}: ${Object.keys(source).length} namespaces, ${count} strings, all in step`);
