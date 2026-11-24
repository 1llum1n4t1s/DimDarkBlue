// ストア提出用 ZIP を作る。依存ゼロ。manifest.json・_locales/・icons/・LICENSE だけを入れる。
// 使い方: bun --no-env-file scripts/pack.ts  → リポジトリ直下に DimDarkBlue.zip
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { deflateRawSync } from "node:zlib";

const root = join(import.meta.dir, "..");
const out = join(root, "DimDarkBlue.zip");

const names = ["manifest.json", "LICENSE", ...readdirSync(join(root, "_locales")).sort().map((l) => `_locales/${l}/messages.json`), ...readdirSync(join(root, "icons")).sort().map((f) => `icons/${f}`)];

const parts: Buffer[] = [];
const central: Buffer[] = [];
let offset = 0;
for (const name of names) {
  const data = readFileSync(join(root, name));
  const comp = deflateRawSync(data, { level: 9 });
  const crc = Bun.hash.crc32(data) >>> 0;
  const nameBuf = Buffer.from(name, "utf8");
  // 固定の日時 (2026-01-01 00:00) で再現可能にする。UTF-8 名フラグ (bit 11) を立てる。
  const time = 0, date = ((2026 - 1980) << 9) | (1 << 5) | 1;
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6);
  local.writeUInt16LE(8, 8); local.writeUInt16LE(time, 10); local.writeUInt16LE(date, 12);
  local.writeUInt32LE(crc, 14); local.writeUInt32LE(comp.length, 18); local.writeUInt32LE(data.length, 22);
  local.writeUInt16LE(nameBuf.length, 26); local.writeUInt16LE(0, 28);
  const cd = Buffer.alloc(46);
  cd.writeUInt32LE(0x02014b50, 0); cd.writeUInt16LE(20, 4); cd.writeUInt16LE(20, 6); cd.writeUInt16LE(0x0800, 8);
  cd.writeUInt16LE(8, 10); cd.writeUInt16LE(time, 12); cd.writeUInt16LE(date, 14);
  cd.writeUInt32LE(crc, 16); cd.writeUInt32LE(comp.length, 20); cd.writeUInt32LE(data.length, 24);
  cd.writeUInt16LE(nameBuf.length, 28); cd.writeUInt32LE(offset, 42);
  parts.push(local, nameBuf, comp);
  central.push(cd, nameBuf);
  offset += 30 + nameBuf.length + comp.length;
}
const cdBuf = Buffer.concat(central);
const end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50, 0);
end.writeUInt16LE(names.length, 8); end.writeUInt16LE(names.length, 10);
end.writeUInt32LE(cdBuf.length, 12); end.writeUInt32LE(offset, 16);
writeFileSync(out, Buffer.concat([...parts, cdBuf, end]));
console.log(`作成: ${out}`);
for (const n of names) console.log("  " + n);
