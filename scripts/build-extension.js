// Builds the Chrome extension: copies extension/ and the two userscripts into dist/extension/ (load that folder
// unpacked) and zips it to dist/elm451-dedup-tools-v<version>.zip. No dependencies; plain Node.
// The version comes from EXT_VERSION (the release workflow sets it from the tag) or extension/manifest.json.
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'extension');
const OUT = path.join(ROOT, 'dist');
const UNPACKED = path.join(OUT, 'extension');
const SCRIPTS = ['Element451-UI-Perfection-v2.user.js', 'csv-database-v2.js'];

function copyDir(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const e of fs.readdirSync(from, { withFileTypes: true })) {
    const a = path.join(from, e.name), b = path.join(to, e.name);
    if (e.isDirectory()) copyDir(a, b); else fs.copyFileSync(a, b);
  }
}
function listFiles(dir, base = dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? listFiles(p, base) : [path.relative(base, p).split(path.sep).join('/')];
  }).sort();
}
const crcTable = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = (buf) => { let c = 0xFFFFFFFF; for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
// A small zip writer (deflate), so the build needs neither a zip binary nor an npm package.
function zip(dir, files, outFile) {
  const parts = [], central = [];
  let offset = 0;
  const d = new Date(2026, 0, 1);
  const time = (d.getHours() << 11) | (d.getMinutes() << 5), date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  for (const f of files) {
    const data = fs.readFileSync(path.join(dir, f)), comp = zlib.deflateRawSync(data, { level: 9 }), name = Buffer.from(f);
    const crc = crc32(data);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0x0800, 6); lh.writeUInt16LE(8, 8);
    lh.writeUInt16LE(time, 10); lh.writeUInt16LE(date, 12); lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(comp.length, 18); lh.writeUInt32LE(data.length, 22); lh.writeUInt16LE(name.length, 26);
    parts.push(lh, name, comp);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(0x0800, 8); ch.writeUInt16LE(8, 10);
    ch.writeUInt16LE(time, 12); ch.writeUInt16LE(date, 14); ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(comp.length, 20); ch.writeUInt32LE(data.length, 24); ch.writeUInt16LE(name.length, 28);
    ch.writeUInt32LE(offset, 42);
    central.push(ch, name);
    offset += 30 + name.length + comp.length;
  }
  const cd = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  fs.writeFileSync(outFile, Buffer.concat([...parts, cd, end]));
}

fs.rmSync(OUT, { recursive: true, force: true });
copyDir(SRC, UNPACKED);
fs.mkdirSync(path.join(UNPACKED, 'scripts'), { recursive: true });
const versions = {};
for (const s of SCRIPTS) {
  const code = fs.readFileSync(path.join(ROOT, s), 'utf8');
  new vm.Script(code, { filename: s }); // syntax check
  const m = code.match(/@version\s+(\S+)/);
  if (!m) throw new Error(s + ' has no @version');
  versions[s] = m[1];
  fs.writeFileSync(path.join(UNPACKED, 'scripts', s), code);
}
for (const f of ['background.js', 'popup.js']) new vm.Script(fs.readFileSync(path.join(UNPACKED, f), 'utf8'), { filename: f });

const manifestPath = path.join(UNPACKED, 'manifest.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const version = (process.env.EXT_VERSION || manifest.version).replace(/^v/, '');
if (!/^\d+(\.\d+){0,3}$/.test(version)) throw new Error('bad version: ' + version);
manifest.version = version;
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
for (const f of [manifest.background.service_worker, manifest.action.default_popup, ...Object.values(manifest.icons)]) {
  if (!fs.existsSync(path.join(UNPACKED, f))) throw new Error('manifest points at a missing file: ' + f);
}

const zipName = 'elm451-dedup-tools-v' + version + '.zip';
zip(UNPACKED, listFiles(UNPACKED), path.join(OUT, zipName));
console.log('Built ' + zipName + ' (' + listFiles(UNPACKED).length + ' files)');
console.log('Scripts: ' + Object.entries(versions).map(([k, v]) => k + ' ' + v).join(', '));
console.log('Unpacked folder: dist/extension');
