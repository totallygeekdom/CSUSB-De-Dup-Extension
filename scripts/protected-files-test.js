// Tests the Database script's file protection on its own (no browser): the block between the PROTECTED FILES START / END
// markers in database-v2.js is pure (bytes and a password in, bytes out), so it runs in Node as it is.
'use strict';
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '..', 'database-v2.js'), 'utf8');
const a = src.indexOf('// ---- PROTECTED FILES START'), b = src.indexOf('// ---- PROTECTED FILES END');
if (a < 0 || b < a) { console.error('PROTECTED FILES markers not found in database-v2.js'); process.exit(1); }
const api = new Function(src.slice(a, b) + '\nreturn { cfbWrite, cfbRead, agileEncrypt, agileDecrypt, elmdbEncrypt, elmdbDecrypt, isCfb, isElmdb };')();

let failures = 0;
const check = (ok, label) => { console.log((ok ? 'ok   ' : 'FAIL ') + label); if (!ok) failures++; };
const same = (x, y) => x.length === y.length && Buffer.compare(Buffer.from(x), Buffer.from(y)) === 0;
const bytes = (n) => new Uint8Array(n).map((_, i) => (i * 7 + 3) & 255);

(async () => {
  // the container, at sizes around each of its boundaries (mini stream, one FAT sector, the DIFAT)
  for (const n of [0, 1, 64, 4095, 4096, 4097, 65536, 8000000]) {
    const out = api.cfbRead(api.cfbWrite([{ name: 'EncryptionInfo', data: bytes(900) }, { name: 'EncryptedPackage', data: bytes(n) }]));
    check(same(out.EncryptedPackage, bytes(n)) && same(out.EncryptionInfo, bytes(900)), 'compound file round trip, ' + n + ' bytes');
  }
  // the password-protected .xlsx
  const pkg = bytes(50000), enc = await api.agileEncrypt(pkg, 'Corr3ct horse! ñ 密');
  check(api.isCfb(enc), 'the protected .xlsx is a compound file');
  check(same(await api.agileDecrypt(enc, 'Corr3ct horse! ñ 密'), pkg), 'protected .xlsx round trip');
  check(await api.agileDecrypt(enc, 'wrong').then(() => false, e => e.code === 'password'), 'a wrong password is refused');
  const changed = enc.slice(); changed[512 + 100] ^= 1; // a byte of the encrypted package (it starts right after the 512-byte header)
  check(await api.agileDecrypt(changed, 'Corr3ct horse! ñ 密').then(() => false, e => e.code === 'damaged'), 'a file changed after it was protected is refused');
  // the .elmdb
  const entries = [{ firstName: 'And...', lastName: 'Rio...', sparkId1: 'sparkAAA1', dept: 'UnderGrad', lostSpark: 'b' }, { firstName: 'José', rowContents: 'x'.repeat(5000) }];
  const text = await api.elmdbEncrypt(entries, 'pw 1'), u8 = new TextEncoder().encode(text);
  check(api.isElmdb(u8) && !text.includes('sparkAAA1') && !text.includes('UnderGrad'), 'the .elmdb holds no readable entry text');
  check(JSON.stringify(await api.elmdbDecrypt(u8, 'pw 1')) === JSON.stringify(entries), '.elmdb round trip');
  check(await api.elmdbDecrypt(u8, 'pw 2').then(() => false, e => e.code === 'password'), 'the .elmdb refuses a wrong password');
  console.log(failures ? failures + ' check(s) failed' : 'all checks passed');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
