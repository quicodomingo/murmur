// The latest.json that installed apps read to update (tauri.conf.json › plugins.updater), from the
// update packages and their signatures in a folder. Platforms already in an existing latest.json
// (the Mac's, made by release.sh) are kept; the ones found here are added or replaced.
//
//   node scripts/latest-json.mjs <folder> <version> <base url> [existing latest.json] > latest.json
//
// What each platform downloads (Tauri's updater looks up "<os>-<arch>-<installer>" first, then
// "<os>-<arch>"):
//   *.app.tar.gz      darwin-aarch64          (release.sh)
//   *-setup.exe       windows-x86_64[-nsis]
//   *.AppImage        linux-x86_64[-appimage]
//   *.deb, *.rpm      linux-x86_64-deb, linux-x86_64-rpm
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const [dir, version, base, existing] = process.argv.slice(2);
if (!dir || !version || !base) {
  console.error("Ús: latest-json.mjs <carpeta> <versió> <url base> [latest.json actual]");
  process.exit(1);
}

const KINDS = [
  { test: /\.app\.tar\.gz$/, keys: ["darwin-aarch64", "darwin-aarch64-app"] },
  { test: /-setup\.exe$/, keys: ["windows-x86_64", "windows-x86_64-nsis"] },
  { test: /\.AppImage$/, keys: ["linux-x86_64", "linux-x86_64-appimage"] },
  { test: /\.deb$/, keys: ["linux-x86_64-deb"] },
  { test: /\.rpm$/, keys: ["linux-x86_64-rpm"] },
];

const previous = existing && existsSync(existing) ? JSON.parse(readFileSync(existing, "utf8")) : null;
// A latest.json from another version says nothing about this one.
const platforms = previous?.version === version ? { ...previous.platforms } : {};

for (const file of readdirSync(dir)) {
  const kind = KINDS.find((k) => k.test.test(file));
  const sig = join(dir, `${file}.sig`);
  if (!kind || !existsSync(sig)) continue;
  const entry = { signature: readFileSync(sig, "utf8").trim(), url: `${base.replace(/\/$/, "")}/${encodeURIComponent(file)}` };
  for (const key of kind.keys) platforms[key] = entry;
}

if (!Object.keys(platforms).length) {
  console.error(`Cap paquet d'actualització signat a ${dir}`);
  process.exit(1);
}

const notes = process.env.RELEASE_NOTES || previous?.notes || `Murmur ${version}`;
console.log(JSON.stringify({ version, notes, pub_date: previous?.version === version ? previous.pub_date : new Date().toISOString(), platforms }, null, 2));
