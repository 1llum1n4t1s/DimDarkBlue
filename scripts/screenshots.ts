// Chrome ウェブストア掲載画像を撮り直す。依存ゼロ（Bun 専用: bun:ffi で Win32 を呼ぶ）。Windows のみ。
// 使い方:
//   bun --no-env-file scripts/screenshots.ts            # 英語・日本語の順に、store/images/<言語>/ へ 3 枚ずつ + 共通の tile-small.png を作り直す
//   bun --no-env-file scripts/screenshots.ts --locale=ja # 1 言語だけ撮る（en | ja。タイルは en のときだけ作り直す）
//   bun --no-env-file scripts/screenshots.ts --verify   # 既存の画像（両言語）の寸法・アルファ・画素だけを検査する
//   bun --no-env-file scripts/screenshots.ts --onscreen # 窓を画面内に置く（既定は画面外）
// 言語を指定しない実行は、言語ごとに自分自身を子プロセスで起動する（言語ごとに別の一時プロファイル・別の Chrome）。
//
// 仕組み: 一時プロファイルの Chrome（画面あり・1280x800）に、一時置き場へコピーしたテーマを
// CDP の Extensions.loadUnpacked（--remote-debugging-pipe）で読み込み、その窓だけを
// PrintWindow(PW_RENDERFULLCONTENT) で撮る。デスクトップ全体は撮らない。普段の Chrome には触れない。
// 一時フォルダーはスクリプトが消さない（最後に出力される。Prunlet CLI で片付ける）。
import { dlopen, FFIType, JSCallback, ptr, toArrayBuffer, type Pointer } from "bun:ffi";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deflateSync, inflateSync } from "node:zlib";

const root = join(import.meta.dir, "..");
const imagesRoot = join(root, "store", "images");
const W = 1280, H = 800;
const args = new Set(process.argv.slice(2));
const LOCALES = ["en", "ja"] as const;
type Loc = (typeof LOCALES)[number];
const localeArg = process.argv.find((a) => a.startsWith("--locale="))?.slice("--locale=".length);
if (localeArg && !(LOCALES as readonly string[]).includes(localeArg)) throw new Error(`--locale は ${LOCALES.join(" | ")} のどれか`);
const locale = (localeArg ?? "en") as Loc;
const outDir = join(imagesRoot, locale);

// ---- PNG（RGB 8bit のみ書く。RGB / RGBA 8bit を読む） ----
type Raw = { w: number; h: number; rgb: Uint8Array }; // rgb は w*h*3

function crc32(b: Uint8Array): number { return Bun.hash.crc32(b) >>> 0; }

function encodePng({ w, h, rgb }: Raw): Buffer {
  const stride = w * 3;
  const raw = Buffer.alloc((stride + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (stride + 1)] = 0;
    raw.set(rgb.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1);
  }
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2; // 8bit, truecolor, アルファなし
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw, { level: 9 })), chunk("IEND", Buffer.alloc(0)),
  ]);
}

function decodePng(buf: Buffer): { w: number; h: number; colorType: number; bitDepth: number; rgb: Uint8Array } {
  let pos = 8, w = 0, h = 0, bitDepth = 0, colorType = 0;
  const idat: Buffer[] = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos), type = buf.toString("ascii", pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === "IHDR") { w = data.readUInt32BE(0); h = data.readUInt32BE(4); bitDepth = data[8]; colorType = data[9]; }
    else if (type === "IDAT") idat.push(data);
    pos += 12 + len;
  }
  const bpp = colorType === 6 ? 4 : colorType === 2 ? 3 : 0;
  if (!bpp || bitDepth !== 8) throw new Error(`未対応の PNG 形式 colorType=${colorType} bitDepth=${bitDepth}`);
  const raw = inflateSync(Buffer.concat(idat));
  const stride = w * bpp;
  const px = new Uint8Array(stride * h);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)], src = y * (stride + 1) + 1, dst = y * stride;
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? px[dst + i - bpp] : 0, b = y > 0 ? px[dst - stride + i] : 0, c = i >= bpp && y > 0 ? px[dst - stride + i - bpp] : 0;
      let v = raw[src + i];
      if (f === 1) v += a; else if (f === 2) v += b; else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      px[dst + i] = v & 255;
    }
  }
  const rgb = new Uint8Array(w * h * 3);
  for (let i = 0; i < w * h; i++) { rgb[i * 3] = px[i * bpp]; rgb[i * 3 + 1] = px[i * bpp + 1]; rgb[i * 3 + 2] = px[i * bpp + 2]; }
  return { w, h, colorType, bitDepth, rgb };
}

// ---- 画素の検査 ----
const hex = (c: number[]) => "#" + c.map((v) => v.toString(16).padStart(2, "0")).join("").toUpperCase();
const px = (r: Raw, x: number, y: number) => { const o = (y * r.w + x) * 3; return [r.rgb[o], r.rgb[o + 1], r.rgb[o + 2]]; };

// 領域内で目的の色が占める割合
function ratio(r: Raw, x0: number, y0: number, x1: number, y1: number, want: number[]): number {
  let n = 0, t = 0;
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { const p = px(r, x, y); t++; if (p[0] === want[0] && p[1] === want[1] && p[2] === want[2]) n++; }
  return n / t;
}

// 行・列を走査して色の連続区間（最頻の上位）を出す。調整用。
function runs(r: Raw, axis: "row" | "col", at: number, minLen = 6): string {
  const out: string[] = [];
  const len = axis === "row" ? r.w : r.h;
  let start = 0, cur = hex(axis === "row" ? px(r, 0, at) : px(r, at, 0));
  for (let i = 1; i <= len; i++) {
    const c = i < len ? hex(axis === "row" ? px(r, i, at) : px(r, at, i)) : "";
    if (c !== cur) { if (i - start >= minLen) out.push(`${start}-${i - 1}:${cur}`); start = i; cur = c; }
  }
  return out.join(" ");
}

// 各画像で「枠」「ツールバー」の色が既定色のままでないことを画素で確かめる（領域は撮影位置が固定なので固定値）
type Check = { name: string; box: [number, number, number, number]; color: number[]; min: number };
const FRAME = [0x19, 0x21, 0x29], TOOLBAR = [0x31, 0x3d, 0x49];
const checks: Record<string, Check[]> = {
  "screenshot-01.png": [
    { name: "枠(タブ列の空き)", box: [1100, 8, 1140, 28], color: FRAME, min: 0.95 },
    { name: "右上の3ボタンの背景", box: [1145, 4, 1155, 28], color: FRAME, min: 1 },
    { name: "ツールバー(上端の帯)", box: [8, 42, 1270, 45], color: TOOLBAR, min: 0.95 },
  ],
  "screenshot-02.png": [
    { name: "枠(タブ列の空き)", box: [1100, 8, 1140, 28], color: FRAME, min: 0.95 },
    { name: "右上の3ボタンの背景", box: [1145, 4, 1155, 28], color: FRAME, min: 1 },
    { name: "ツールバー(上端の帯)", box: [8, 42, 1270, 45], color: TOOLBAR, min: 0.95 },
  ],
  "screenshot-03.png": [
    { name: "枠(タブ列の空き)", box: [1100, 8, 1140, 28], color: FRAME, min: 0.95 },
    { name: "右上の3ボタンの背景", box: [1145, 4, 1155, 28], color: FRAME, min: 1 },
    { name: "ツールバー(上端の帯)", box: [8, 42, 1270, 45], color: TOOLBAR, min: 0.95 },
    { name: "ブックマークバー(右の空き)", box: [1100, 92, 1270, 112], color: TOOLBAR, min: 0.95 },
  ],
};

function inspect(name: string, png: Buffer): { ok: boolean; lines: string[] } {
  const lines: string[] = [];
  let ok = true;
  const d = decodePng(png);
  const hasAlphaChunk = d.colorType !== 2;
  const dimOk = d.w === W && d.h === H;
  lines.push(`${name}: ${d.w}x${d.h} colorType=${d.colorType}(${hasAlphaChunk ? "アルファあり" : "アルファなし"}) bitDepth=${d.bitDepth}`);
  if (!dimOk || hasAlphaChunk || d.bitDepth !== 8) ok = false;
  const r: Raw = { w: d.w, h: d.h, rgb: d.rgb };
  for (const c of checks[name] ?? []) {
    const v = ratio(r, ...c.box, c.color);
    const pass = v >= c.min;
    if (!pass) ok = false;
    lines.push(`  ${pass ? "OK " : "NG "}${c.name} 期待 ${hex(c.color)} 一致率 ${(v * 100).toFixed(1)}% (領域 ${c.box.join(",")}) 代表画素 ${hex(px(r, c.box[0] + 1, c.box[1] + 1))}`);
  }
  const corners = [px(r, 0, 0), px(r, d.w - 1, 0), px(r, 0, d.h - 1), px(r, d.w - 1, d.h - 1)].map(hex).join(" ");
  lines.push(`  四隅の画素(左上 右上 左下 右下): ${corners}`);
  return { ok, lines };
}

// icon-128.png の四隅のアルファ（タイル・ストアアイコンで四隅が透明であること）
function iconCornerAlpha(): number[] {
  const buf = readFileSync(join(root, "icons", "icon-128.png"));
  let pos = 8, w = 0, h = 0; const idat: Buffer[] = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos), type = buf.toString("ascii", pos + 4, pos + 8), data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === "IHDR") { w = data.readUInt32BE(0); h = data.readUInt32BE(4); if (data[9] !== 6 || data[8] !== 8) throw new Error("icon-128.png が RGBA 8bit でない"); }
    else if (type === "IDAT") idat.push(data);
    pos += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat)), stride = w * 4;
  const out = new Uint8Array(stride * h);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)];
    for (let i = 0; i < stride; i++) {
      const a = i >= 4 ? out[y * stride + i - 4] : 0, b = y > 0 ? out[(y - 1) * stride + i] : 0, c = i >= 4 && y > 0 ? out[(y - 1) * stride + i - 4] : 0;
      let v = raw[y * (stride + 1) + 1 + i];
      if (f === 1) v += a; else if (f === 2) v += b; else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      out[y * stride + i] = v & 255;
    }
  }
  const al = (x: number, y: number) => out[y * stride + x * 4 + 3];
  return [al(0, 0), al(w - 1, 0), al(0, h - 1), al(w - 1, h - 1)];
}

const TILE_BG = [0x15, 0x20, 0x2b];
function lum(c: number[]) { const f = (v: number) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); }
// 副題（背景以外の画素がある行の連なりのうち最後のもの）の、背景に対する最大コントラスト比（WCAG）
function tileSubtitleContrast(r: Raw): number {
  let best = 1;
  const lb = lum(TILE_BG);
  const rowHas = (y: number) => { for (let x = 0; x < r.w; x++) { const p = px(r, x, y); if (p[0] !== TILE_BG[0] || p[1] !== TILE_BG[1] || p[2] !== TILE_BG[2]) return true; } return false; };
  let y1 = r.h - 1; while (y1 > 0 && !rowHas(y1)) y1--;
  let y0 = y1; while (y0 > 0 && rowHas(y0 - 1)) y0--;
  for (let y = y0; y <= y1; y++) for (let x = 0; x < r.w; x++) { const l = lum(px(r, x, y)); best = Math.max(best, (Math.max(l, lb) + 0.05) / (Math.min(l, lb) + 0.05)); }
  return best;
}

const verify = () => {
  let allOk = true;
  const alphas = iconCornerAlpha();
  const aOk = alphas.every((a) => a === 0);
  allOk &&= aOk; console.log(`icon-128.png 四隅のアルファ(左上 右上 左下 右下): ${alphas.join(" ")} ${aOk ? "OK" : "NG"}`);
  for (const loc of LOCALES) for (const f of ["screenshot-01.png", "screenshot-02.png", "screenshot-03.png"]) {
    const p = join(imagesRoot, loc, f);
    if (!existsSync(p)) { console.log(`${loc}/${f}: 無い`); allOk = false; continue; }
    const r = inspect(f, readFileSync(p));
    allOk &&= r.ok; console.log(`[${loc}] ` + r.lines.join("\n"));
  }
  const t = join(imagesRoot, "tile-small.png");
  if (existsSync(t)) {
    const d = decodePng(readFileSync(t));
    const cr = tileSubtitleContrast({ w: d.w, h: d.h, rgb: d.rgb });
    const ok = d.w === 440 && d.h === 280 && d.colorType === 2 && cr >= 4.5;
    allOk &&= ok; console.log(`tile-small.png: ${d.w}x${d.h} colorType=${d.colorType} 副題のコントラスト比 ${cr.toFixed(2)} ${ok ? "OK" : "NG"}`);
  } else { console.log("tile-small.png: 無い"); allOk = false; }
  process.exit(allOk ? 0 : 1);
};

if (process.platform !== "win32") throw new Error("Windows 専用です");

// ---- Win32 ----
const u = dlopen("user32.dll", {
  SetProcessDpiAwarenessContext: { args: [FFIType.i64], returns: FFIType.i32 },
  EnumWindows: { args: [FFIType.function, FFIType.i64], returns: FFIType.i32 },
  GetWindowThreadProcessId: { args: [FFIType.u64, FFIType.ptr], returns: FFIType.u32 },
  IsWindowVisible: { args: [FFIType.u64], returns: FFIType.i32 },
  GetClassNameW: { args: [FFIType.u64, FFIType.ptr, FFIType.i32], returns: FFIType.i32 },
  GetWindowRect: { args: [FFIType.u64, FFIType.ptr], returns: FFIType.i32 },
  SetWindowPos: { args: [FFIType.u64, FFIType.u64, FFIType.i32, FFIType.i32, FFIType.i32, FFIType.i32, FFIType.u32], returns: FFIType.i32 },
  PrintWindow: { args: [FFIType.u64, FFIType.u64, FFIType.u32], returns: FFIType.i32 },
  GetDC: { args: [FFIType.u64], returns: FFIType.u64 },
  ReleaseDC: { args: [FFIType.u64, FFIType.u64], returns: FFIType.i32 },
  SetForegroundWindow: { args: [FFIType.u64], returns: FFIType.i32 },
  GetForegroundWindow: { args: [], returns: FFIType.u64 },
  ShowWindow: { args: [FFIType.u64, FFIType.i32], returns: FFIType.i32 },
  keybd_event: { args: [FFIType.u8, FFIType.u8, FFIType.u32, FFIType.u64], returns: FFIType.void },
  AttachThreadInput: { args: [FFIType.u32, FFIType.u32, FFIType.i32], returns: FFIType.i32 },
}).symbols;
const g = dlopen("gdi32.dll", {
  CreateCompatibleDC: { args: [FFIType.u64], returns: FFIType.u64 },
  CreateDIBSection: { args: [FFIType.u64, FFIType.ptr, FFIType.u32, FFIType.ptr, FFIType.u64, FFIType.u32], returns: FFIType.u64 },
  SelectObject: { args: [FFIType.u64, FFIType.u64], returns: FFIType.u64 },
  DeleteObject: { args: [FFIType.u64], returns: FFIType.i32 },
  DeleteDC: { args: [FFIType.u64], returns: FFIType.i32 },
}).symbols;
const dwm = dlopen("dwmapi.dll", {
  DwmGetWindowAttribute: { args: [FFIType.u64, FFIType.u32, FFIType.ptr, FFIType.u32], returns: FFIType.i32 },
  DwmSetWindowAttribute: { args: [FFIType.u64, FFIType.u32, FFIType.ptr, FFIType.u32], returns: FFIType.i32 },
}).symbols;
const k = dlopen("kernel32.dll", {
  WriteFile: { args: [FFIType.u64, FFIType.ptr, FFIType.u32, FFIType.ptr, FFIType.ptr], returns: FFIType.i32 },
  ReadFile: { args: [FFIType.u64, FFIType.ptr, FFIType.u32, FFIType.ptr, FFIType.ptr], returns: FFIType.i32 },
  PeekNamedPipe: { args: [FFIType.u64, FFIType.ptr, FFIType.u32, FFIType.ptr, FFIType.ptr, FFIType.ptr], returns: FFIType.i32 },
  GetCurrentThreadId: { args: [], returns: FFIType.u32 },
}).symbols;

u.SetProcessDpiAwarenessContext(-4n); // Per-Monitor DPI Aware V2: 座標・撮影を物理ピクセルで扱う

type Rect = { l: number; t: number; r: number; b: number };
const rectOf = (buf: Int32Array): Rect => ({ l: buf[0], t: buf[1], r: buf[2], b: buf[3] });

function chromeWindows(pid: number): bigint[] {
  const found: bigint[] = [];
  const cls = new Uint16Array(64), pidBuf = new Uint32Array(1), rc = new Int32Array(4);
  const cb = new JSCallback((hwnd: bigint) => {
    u.GetWindowThreadProcessId(hwnd, ptr(pidBuf));
    if (pidBuf[0] !== pid || !u.IsWindowVisible(hwnd)) return 1;
    const n = u.GetClassNameW(hwnd, ptr(cls), 64);
    if (Buffer.from(cls.buffer, 0, n * 2).toString("utf16le") !== "Chrome_WidgetWin_1") return 1;
    u.GetWindowRect(hwnd, ptr(rc));
    if (rc[2] - rc[0] > 400 && rc[3] - rc[1] > 300) found.push(hwnd);
    return 1;
  }, { args: [FFIType.u64, FFIType.i64], returns: FFIType.i32 });
  u.EnumWindows(cb.ptr as Pointer, 0n);
  cb.close();
  return found;
}

function frameBounds(hwnd: bigint): Rect {
  const b = new Int32Array(4);
  if (dwm.DwmGetWindowAttribute(hwnd, 9, ptr(b), 16) !== 0) throw new Error("DwmGetWindowAttribute 失敗");
  return rectOf(b);
}
function windowRect(hwnd: bigint): Rect { const b = new Int32Array(4); u.GetWindowRect(hwnd, ptr(b)); return rectOf(b); }

// 見える枠（拡張枠）がちょうど W x H になるよう、見えない枠の分を足して窓を置く
function placeWindow(hwnd: bigint, x: number, y: number) {
  const sq = new Int32Array([1]); // DWMWCP_DONOTROUND: 角を四角にする
  dwm.DwmSetWindowAttribute(hwnd, 33, ptr(sq), 4);
  for (let i = 0; i < 3; i++) {
    const r = windowRect(hwnd), e = frameBounds(hwnd);
    const w = W + (r.r - r.l) - (e.r - e.l), h = H + (r.b - r.t) - (e.b - e.t);
    u.SetWindowPos(hwnd, 0n, x - (e.l - r.l), y - (e.t - r.t), w, h, 0x0004 | 0x0010 | 0x0040); // NOZORDER|NOACTIVATE|SHOWWINDOW
    Bun.sleepSync(400);
  }
  const e = frameBounds(hwnd);
  if (e.r - e.l !== W || e.b - e.t !== H) throw new Error(`窓の見える寸法が ${e.r - e.l}x${e.b - e.t}（期待 ${W}x${H}）`);
}

function foreground(hwnd: bigint) {
  for (let i = 0; i < 6 && u.GetForegroundWindow() !== hwnd; i++) {
    // 2 回目以降は、前面化の権利を得るため無害なキー（F24）を 1 回押して離す
    if (i > 0) { u.keybd_event(0x87, 0, 0, 0n); u.keybd_event(0x87, 0, 2, 0n); }
    const fg = u.GetForegroundWindow(), me = k.GetCurrentThreadId();
    const fgThread = fg ? u.GetWindowThreadProcessId(fg, null) : 0;
    if (fgThread) u.AttachThreadInput(me, fgThread, 1);
    u.SetForegroundWindow(hwnd);
    if (fgThread) u.AttachThreadInput(me, fgThread, 0);
    Bun.sleepSync(300);
  }
  if (u.GetForegroundWindow() !== hwnd) throw new Error("窓を前面にできない（枠が非アクティブ色になる）");
}

// 窓だけを PrintWindow で撮り、見える枠の範囲を切り出す（拡大縮小なし）
function capture(hwnd: bigint): Raw {
  const r = windowRect(hwnd), e = frameBounds(hwnd);
  const fw = r.r - r.l, fh = r.b - r.t;
  const bmi = new Uint8Array(40), dv = new DataView(bmi.buffer);
  dv.setUint32(0, 40, true); dv.setInt32(4, fw, true); dv.setInt32(8, -fh, true); dv.setUint16(12, 1, true); dv.setUint16(14, 32, true);
  const screen = u.GetDC(0n), mem = g.CreateCompatibleDC(screen);
  const bitsPtr = new BigUint64Array(1);
  const bmp = g.CreateDIBSection(screen, ptr(bmi), 0, ptr(bitsPtr), 0n, 0);
  if (!bmp) throw new Error("CreateDIBSection 失敗");
  const old = g.SelectObject(mem, bmp);
  const okPrint = u.PrintWindow(hwnd, mem, 2); // PW_RENDERFULLCONTENT
  if (!okPrint) throw new Error("PrintWindow 失敗");
  const bgra = new Uint8Array(toArrayBuffer(Number(bitsPtr[0]) as unknown as Pointer, 0, fw * fh * 4));
  const ox = e.l - r.l, oy = e.t - r.t;
  const rgb = new Uint8Array(W * H * 3);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const s = ((y + oy) * fw + (x + ox)) * 4, d = (y * W + x) * 3;
    rgb[d] = bgra[s + 2]; rgb[d + 1] = bgra[s + 1]; rgb[d + 2] = bgra[s];
  }
  g.SelectObject(mem, old); g.DeleteObject(bmp); g.DeleteDC(mem); u.ReleaseDC(0n, screen);
  return { w: W, h: H, rgb };
}

// ---- CDP（--remote-debugging-pipe。Bun.spawn の fd 3/4 は HANDLE 値で返るので kernel32 で読み書きする） ----
class Cdp {
  private seq = 0;
  private pending = Buffer.alloc(0);
  constructor(private wh: bigint, private rh: bigint) {}
  async send(method: string, params: object = {}, sessionId?: string): Promise<any> {
    const id = ++this.seq;
    const msg = Buffer.from(JSON.stringify({ id, method, params, sessionId }) + "\0");
    const n = new Uint32Array(1);
    if (!k.WriteFile(this.wh, ptr(msg), msg.length, ptr(n), null)) throw new Error("pipe 書き込み失敗");
    const deadline = Date.now() + 60000;
    while (Date.now() < deadline) {
      const avail = new Uint32Array(1);
      if (!k.PeekNamedPipe(this.rh, null, 0, null, ptr(avail), null)) throw new Error("pipe が閉じた");
      if (avail[0] > 0) {
        const b = Buffer.alloc(avail[0]);
        k.ReadFile(this.rh, ptr(b), b.length, ptr(n), null);
        this.pending = Buffer.concat([this.pending, b.subarray(0, n[0])]);
        let z: number;
        while ((z = this.pending.indexOf(0)) >= 0) {
          const m = JSON.parse(this.pending.subarray(0, z).toString("utf8"));
          this.pending = this.pending.subarray(z + 1);
          if (m.id === id) { if (m.error) throw new Error(`${method}: ${JSON.stringify(m.error)}`); return m.result; }
        }
      } else await Bun.sleep(20);
    }
    throw new Error(`${method} が応答しない`);
  }
}

// ---- 中身（実在サイト・ロゴ・個人情報なし）----
const favicon = (c: string) => `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><circle cx="8" cy="8" r="7" fill="${c}"/></svg>`)}`;
type Page = { title: string; color: string; dark: boolean; lead: string; cards: [string, string][] };
// 言語に依らない部分（色・明暗）と、言語別の文言。日本語の文は 1 枚のカード（幅約 240px・16px）で 2 行に収まる長さにする。
const pageMeta: Record<string, { color: string; dark: boolean }> = {
  "/notes": { color: "#4f9d69", dark: false }, "/planner": { color: "#d9822b", dark: false }, "/trails": { color: "#3d9be0", dark: true },
};
const pageText: Record<Loc, Record<string, Pick<Page, "title" | "lead" | "cards">>> = {
  en: {
    "/notes": { title: "Garden Notes", lead: "A quiet place to keep track of what the garden needs this week.", cards: [
      ["Herbs", "Water early in the morning and pinch back the basil so it grows bushy."], ["Tomatoes", "Move the seedlings to larger pots and tie the tallest stems to stakes."],
      ["Compost", "Turn the pile on Sunday. Order another bag of leaf mold for the beds."], ["Flower bed", "Sketch the spring layout: tall blue salvia at the back, low thyme at the front."],
      ["Tools", "Clean and oil the pruning shears. Replace the worn pair of gloves."], ["Weather", "Light rain expected on Thursday, so skip the evening watering."] ] },
    "/planner": { title: "Weekly Planner", lead: "Small, steady plans for a calm week.", cards: [
      ["Monday", "Plan the week and tidy the desk."], ["Wednesday", "Library visit and a long walk."], ["Friday", "Cook something new for dinner."],
      ["Weekend", "Read, rest and recharge."], ["Errands", "Post office, groceries and a haircut."], ["Reminder", "Back up the photos on Sunday."] ] },
    "/trails": { title: "Trail Map", lead: "Favorite walks, sorted by distance and effort.", cards: [
      ["Lakeside loop", "4 km, easy. Flat path with benches and plenty of shade."], ["Pine ridge", "9 km, moderate. Steady climb with a wide view at the top."],
      ["Old quarry path", "6 km, easy. Gravel track that is dry even after rain."], ["Summit lookout", "12 km, challenging. Start early and bring extra water."],
      ["River bend", "5 km, easy. Quiet in the evening, good for a slow walk."], ["Meadow circuit", "7 km, moderate. Open fields and a small wooden bridge."] ] },
  },
  ja: {
    "/notes": { title: "庭のノート", lead: "今週の庭仕事を、静かにまとめておく場所です。", cards: [
      ["ハーブ", "朝のうちに水やり。バジルは摘心してこんもり育てる。"], ["トマト", "苗を大きな鉢に移し、背の高い茎は支柱に結ぶ。"],
      ["堆肥", "日曜日に山を切り返す。腐葉土をもう一袋注文。"], ["花壇", "春の配置を描く。奥に青いサルビア、手前に低いタイム。"],
      ["道具", "剪定ばさみを掃除して油を差す。古い手袋は交換。"], ["天気", "木曜は小雨の予報。夕方の水やりは省く。"] ] },
    "/planner": { title: "週間プランナー", lead: "穏やかな一週間のための、小さくて着実な計画。", cards: [
      ["月曜日", "一週間の計画を立て、机を片付ける。"], ["水曜日", "図書館に寄って、ゆっくり散歩。"], ["金曜日", "夕食に新しい料理を作る。"],
      ["週末", "読書をして、のんびり休む。"], ["用事", "郵便局、買い物、散髪。"], ["リマインダー", "日曜日に写真をバックアップ。"] ] },
    "/trails": { title: "散歩マップ", lead: "お気に入りの散歩道を、距離と難易度で並べました。", cards: [
      ["湖畔の周回", "4 km、やさしい。ベンチと木陰の多い平坦な道。"], ["松の尾根", "9 km、ふつう。ゆるやかな登りで、頂上は見晴らし抜群。"],
      ["石切場の小道", "6 km、やさしい。雨上がりでも乾いた砂利道。"], ["山頂展望台", "12 km、きつい。早めに出発し、水を多めに。"],
      ["川のほとり", "5 km、やさしい。夕方は静かでゆっくり歩ける。"], ["草原の周回", "7 km、ふつう。広い野原と小さな木の橋。"] ] },
  },
};
// Chrome 本体の言語（--lang / --accept-lang）、HTML の lang、本文のフォント、ブックマークの名前
const ui: Record<Loc, { chromeLang: string; font: string; bookmarks: string[]; barName: string }> = {
  en: { chromeLang: "en-US", font: `"Segoe UI",system-ui,sans-serif`, bookmarks: ["Recipes", "Reading List"], barName: "Bookmarks bar" },
  ja: { chromeLang: "ja", font: `"Yu Gothic UI","Meiryo UI","Segoe UI",system-ui,sans-serif`, bookmarks: ["レシピ", "読みたい本"], barName: "ブックマーク バー" },
};
const pages: Record<string, Page> = Object.fromEntries(Object.keys(pageMeta).map((path) => [path, { ...pageMeta[path], ...pageText[locale][path] }]));
const pageHtml = (p: Page) => {
  const bg = p.dark ? "#101922" : "#eef2f6", fg = p.dark ? "#dbe3ea" : "#1f2933", card = p.dark ? "#1a2835" : "#ffffff", sub = p.dark ? "#9fb0bf" : "#52606d";
  const nav = Object.values(pages).map((q) => `<li${q.title === p.title ? ' class="on"' : ""}>${q.title}</li>`).join("");
  return `<!doctype html><html lang="${locale}"><head><meta charset="utf-8"><title>${p.title}</title>
<link rel="icon" href="${favicon(p.color)}"><style>
html,body{margin:0;height:100%;overflow:hidden}
body{display:flex;font:17px/1.55 ${ui[locale].font};background:${bg};color:${fg}}
aside{width:260px;flex:none;background:#15202B;color:#E7E9EA;padding:36px 28px}
aside b{display:block;font-size:20px;margin-bottom:28px;color:${p.color}}
aside ul{list-style:none;margin:0;padding:0}aside li{padding:10px 14px;margin:4px 0;border-radius:8px;color:#8B98A5}aside li.on{background:#22303C;color:#E7E9EA}
main{flex:1;padding:44px 56px}h1{margin:0 0 6px;font-size:38px}.bar{width:72px;height:6px;border-radius:3px;background:${p.color};margin:14px 0 20px}
.lead{color:${sub};margin:0 0 30px;font-size:19px}
.grid{display:grid;grid-template-columns:1fr 1fr 1fr;gap:20px}
.c{background:${card};border-radius:12px;padding:22px 24px;height:128px;box-shadow:0 2px 10px rgba(0,0,0,${p.dark ? ".35" : ".07"})}
.c h2{margin:0 0 8px;font-size:20px}.c p{margin:0;color:${sub};font-size:16px}${locale === "ja" ? ".c p{word-break:auto-phrase;text-wrap:pretty}" : ""}
</style></head><body><aside><b>${p.title}</b><ul>${nav}</ul></aside><main><h1>${p.title}</h1><div class="bar"></div><p class="lead">${p.lead}</p>
<div class="grid">${p.cards.map(([t, d]) => `<div class="c"><h2>${t}</h2><p>${d}</p></div>`).join("")}</div></main></body></html>`;
};
const dataUrl = (p: Page) => `data:text/html;charset=utf-8;base64,${Buffer.from(pageHtml(p)).toString("base64")}`;

const iconB64 = readFileSync(join(root, "icons", "icon-128.png")).toString("base64");
const TILE_SUB = "#D0D7DE";
const tileHtml = `<!doctype html><html><head><meta charset="utf-8"><style>
html,body{margin:0;width:440px;height:280px;overflow:hidden}
body{background:#15202B;display:flex;flex-direction:column;align-items:center;justify-content:center;font-family:"Segoe UI",system-ui,sans-serif}
img{width:128px;height:128px}h1{margin:18px 0 0;font-size:36px;font-weight:600;color:#FFFFFF;letter-spacing:.5px}
p{margin:4px 0 0;font-size:20px;font-weight:500;color:${TILE_SUB}}</style></head><body><img src="data:image/png;base64,${iconB64}"><h1>Dim Dark Blue</h1><p>Theme for Chrome</p></body></html>`;

if (args.has("--verify")) verify();

// 言語の指定がなければ、言語ごとに自分自身を子プロセスで起動する（別の一時プロファイル・別の Chrome）
if (!localeArg) {
  let code = 0;
  for (const loc of LOCALES) {
    const r = Bun.spawnSync([process.execPath, "--no-env-file", import.meta.path, `--locale=${loc}`, ...(args.has("--onscreen") ? ["--onscreen"] : [])], { stdio: ["inherit", "inherit", "inherit"] });
    if (r.exitCode !== 0) code = r.exitCode ?? 1;
  }
  process.exit(code);
}

// ---- 実行 ----
const work = mkdtempSync(join(tmpdir(), "ddb-shot-"));
const extDir = join(work, "ext"), profDir = join(work, "profile");
mkdirSync(join(extDir, "icons"), { recursive: true }); mkdirSync(profDir, { recursive: true }); mkdirSync(outDir, { recursive: true });
copyFileSync(join(root, "manifest.json"), join(extDir, "manifest.json"));
for (const l of readdirSync(join(root, "_locales"))) {
  mkdirSync(join(extDir, "_locales", l), { recursive: true });
  copyFileSync(join(root, "_locales", l, "messages.json"), join(extDir, "_locales", l, "messages.json"));
}
for (const f of readdirSync(join(root, "icons"))) copyFileSync(join(root, "icons", f), join(extDir, "icons", f));
console.log(`一時フォルダー: ${work}`);

const server = Bun.serve({
  hostname: "127.0.0.1", port: 0,
  fetch(req) {
    const path = new URL(req.url).pathname;
    if (pages[path]) return new Response(pageHtml(pages[path]), { headers: { "content-type": "text/html; charset=utf-8" } });
    if (path === "/tile") return new Response(tileHtml, { headers: { "content-type": "text/html; charset=utf-8" } });
    return new Response("", { status: 404 }); // favicon.ico など
  },
});
// 外部通信は ~NOTFOUND で遮断し、地域に応じた新しいタブの提案枠（日本語など）を出さない。
// アドレスバーに 127.0.0.1 とポートを出さないため、予約の .localhost ドメインを --host-resolver-rules で
// ローカルサーバーへ向ける（ポートも付け替わるので URL は http://garden.localhost/ になる。.localhost は安全な
// コンテキスト扱いで「Not secure」は出ず、証明書エラーも無い）。
const HOST = "garden.localhost";
const base = `http://${HOST}`;

// ブックマークバーに並べる中立な自作のブックマーク（3 枚目で Ctrl+Shift+B で表示する）
const guid = () => crypto.randomUUID();
const bm = (id: number, name: string, path: string) => ({ date_added: "13300000000000000", guid: guid(), id: String(id), name, type: "url", url: base + path });
mkdirSync(join(profDir, "Default"), { recursive: true });
writeFileSync(join(profDir, "Default", "Bookmarks"), JSON.stringify({
  roots: {
    bookmark_bar: { children: [...Object.keys(pages).map((path, i) => bm(5 + i, pages[path].title, path)), bm(8, ui[locale].bookmarks[0], "/recipes"), bm(9, ui[locale].bookmarks[1], "/reading")], date_added: "13300000000000000", date_modified: "13300000000000000", guid: "0bc5d13f-2cba-5d74-951f-3f233fe6c908", id: "1", name: ui[locale].barName, type: "folder" },
    other: { children: [], date_added: "13300000000000000", date_modified: "0", guid: "82b081ec-3dd3-529c-8475-ab6c344590dd", id: "2", name: "Other bookmarks", type: "folder" },
    synced: { children: [], date_added: "13300000000000000", date_modified: "0", guid: "4cf2e351-0e85-532b-bb37-df045d8f8d0f", id: "3", name: "Mobile bookmarks", type: "folder" },
  },
  version: 1,
}));

const chromePath = ["C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe", "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe"].find(existsSync);
if (!chromePath) throw new Error("chrome.exe が見つからない");
const pos = args.has("--onscreen") ? [0, 0] : [-3000, 0];
const proc = Bun.spawn([chromePath,
  `--user-data-dir=${profDir}`, "--remote-debugging-pipe", "--enable-unsafe-extension-debugging",
  `--lang=${ui[locale].chromeLang}`, `--accept-lang=${ui[locale].chromeLang}`, `--host-resolver-rules=MAP ${HOST} 127.0.0.1:${server.port}, MAP * ~NOTFOUND`, "--force-device-scale-factor=1", `--window-size=${W},${H}`, `--window-position=${pos[0]},${pos[1]}`,
  "--no-first-run", "--no-default-browser-check", "--disable-sync", "--disable-component-update", "--disable-background-networking",
  "--password-store=basic", "--disable-search-engine-choice-screen", "--hide-crash-restore-bubble", "--disable-notifications",
  "--disable-features=Translate,MediaRouter,OptimizationHints,ChromeWhatsNewUI,HttpsFirstBalancedModeAutoEnable",
  "about:blank",
], { stdio: ["ignore", "ignore", "ignore", "pipe", "pipe"] as any });
const [, , , wfd, rfd] = (proc as any).stdio as number[];
const cdp = new Cdp(BigInt(wfd), BigInt(rfd));
const pid = proc.pid;
let failed = false;

try {
  await Bun.sleep(2500);
  const { extension } = await Promise.race([
    cdp.send("Extensions.loadUnpacked", { path: extDir }).then((r) => ({ extension: r })),
    Bun.sleep(30000).then(() => { throw new Error("loadUnpacked がタイムアウト"); }),
  ]);
  console.log(`テーマ読み込み: ${JSON.stringify(extension)}`);
  await Bun.sleep(2000);

  // 小タイル（言語共通。別の閲覧コンテキスト。撮影用の窓には混ぜない。英語の実行のときだけ作り直す）
  if (locale === "en") {
    const { browserContextId } = await cdp.send("Target.createBrowserContext", {});
    const { targetId } = await cdp.send("Target.createTarget", { url: `${base}/tile`, browserContextId, newWindow: true });
    const { sessionId } = await cdp.send("Target.attachToTarget", { targetId, flatten: true });
    await cdp.send("Emulation.setDeviceMetricsOverride", { width: 440, height: 280, deviceScaleFactor: 1, mobile: false }, sessionId);
    await Bun.sleep(1500);
    const shot = await cdp.send("Page.captureScreenshot", { format: "png", fromSurface: true }, sessionId);
    const d = decodePng(Buffer.from(shot.data, "base64"));
    if (d.w !== 440 || d.h !== 280) throw new Error(`タイルの寸法が ${d.w}x${d.h}`);
    writeFileSync(join(imagesRoot, "tile-small.png"), encodePng({ w: d.w, h: d.h, rgb: d.rgb }));
    await cdp.send("Target.closeTarget", { targetId });
    await cdp.send("Target.disposeBrowserContext", { browserContextId });
    const cr = tileSubtitleContrast({ w: d.w, h: d.h, rgb: d.rgb });
    console.log(`tile-small.png を作成（副題のコントラスト比 ${cr.toFixed(2)}）`);
    if (cr < 4.5) failed = true;
  }

  // 通常ウィンドウ: 複数タブ
  await Bun.sleep(500);
  const mainWins = chromeWindows(pid);
  if (mainWins.length !== 1) throw new Error(`通常窓が ${mainWins.length} 個`);
  const mainWin = mainWins[0];
  // 1 枚目は、新しいタブの「よく見るサイト」に自作ページが出ないよう、履歴に残らない data: URL のタブで撮る。
  // 撮影後に同じタブを実際のローカルサーバーの URL へ移す（2・3 枚目）。
  const tabs: string[] = [];
  const paths = Object.keys(pages);
  for (const path of paths) {
    const r = await cdp.send("Target.createTarget", { url: dataUrl(pages[path]) });
    tabs.push(r.targetId);
  }
  const ntp = await cdp.send("Target.createTarget", { url: "chrome://newtab" });
  const { targetInfos } = await cdp.send("Target.getTargets");
  const blank = targetInfos.find((t: any) => t.type === "page" && t.url === "about:blank");
  if (blank) await cdp.send("Target.closeTarget", { targetId: blank.targetId });
  placeWindow(mainWin, pos[0], pos[1]);

  const shoot = async (file: string, win: bigint, activate?: string) => {
    if (activate) await cdp.send("Target.activateTarget", { targetId: activate });
    foreground(win);
    await Bun.sleep(3500);
    foreground(win);
    const raw = capture(win);
    const png = encodePng(raw);
    writeFileSync(join(outDir, file), png);
    const r = inspect(file, png);
    console.log(r.lines.join("\n"));
    console.log(`  行 y=10: ${runs(raw, "row", 10)}\n  行 y=60: ${runs(raw, "row", 60)}\n  列 x=20: ${runs(raw, "col", 20)}\n  行 y=0: ${runs(raw, "row", 0, 1).slice(0, 200)}\n  列 x=0: ${runs(raw, "col", 0, 1).slice(0, 200)}`);
    if (!r.ok) failed = true;
  };
  await shoot("screenshot-01.png", mainWin, ntp.targetId);
  {
    // 新しいタブの言語（Google の新しいタブは iframe の URL の hl= で決まる）を確かめる
    const { sessionId } = await cdp.send("Target.attachToTarget", { targetId: ntp.targetId, flatten: true });
    const { frameTree } = await cdp.send("Page.getFrameTree", {}, sessionId);
    const urls: string[] = [];
    const walk = (t: any) => { urls.push(t.frame.url); (t.childFrames ?? []).forEach(walk); };
    walk(frameTree);
    const nav = (await cdp.send("Runtime.evaluate", { expression: "navigator.languages.join(',')", returnByValue: true }, sessionId)).result.value;
    console.log(`  新しいタブ: navigator.languages=${nav} フレーム=${urls.map((s) => s.replace(/\?.*?(hl=[\w-]+).*/, "?…$1").replace(/\?.*/, "?…")).join(" | ")}`);
    await cdp.send("Target.detachFromTarget", { sessionId });
  }

  // data: のタブを実際のローカルサーバーの URL へ移し、location.href が中立であることを CDP で確かめる
  for (let i = 0; i < tabs.length; i++) {
    const { sessionId } = await cdp.send("Target.attachToTarget", { targetId: tabs[i], flatten: true });
    await cdp.send("Page.navigate", { url: base + paths[i] }, sessionId);
    await Bun.sleep(1200);
    // 実測: URL・安全なコンテキスト・タイトル・言語・カード文のはみ出し（高さ超過・横はみ出し）
    const expr = "JSON.stringify([location.href, isSecureContext, document.title, navigator.languages.join(','), document.documentElement.lang, [...document.querySelectorAll('.c')].filter((c) => c.scrollHeight > c.clientHeight || c.scrollWidth > c.clientWidth).length])";
    const r = await cdp.send("Runtime.evaluate", { expression: expr, returnByValue: true }, sessionId);
    const [href, secure, title, langs, htmlLang, overflow] = JSON.parse(r.result.value);
    const bad = /127\.0\.0\.1|:\d{2,5}(\/|$)/.test(href) || !secure || !String(langs).startsWith(ui[locale].chromeLang) || htmlLang !== locale || overflow > 0;
    console.log(`  タブ ${i + 1}: location.href=${href} isSecureContext=${secure} title=${title} navigator.languages=${langs} html lang=${htmlLang} はみ出しカード=${overflow} ${bad ? "NG" : "OK"}`);
    if (bad) failed = true;
    await cdp.send("Target.detachFromTarget", { sessionId });
  }
  await shoot("screenshot-02.png", mainWin, tabs[0]);

  // 3 枚目: 暗めのページ（Trail Map）＋ブックマークバー。Ctrl+Shift+B で表示する（前面の窓が撮影用 Chrome であることを確認してから押す）
  await cdp.send("Target.activateTarget", { targetId: tabs[2] });
  foreground(mainWin);
  for (const [vk, up] of [[0x11, 0], [0x10, 0], [0x42, 0], [0x42, 2], [0x10, 2], [0x11, 2]]) { u.keybd_event(vk, 0, up, 0n); Bun.sleepSync(40); }
  await Bun.sleep(1000);
  await shoot("screenshot-03.png", mainWin, tabs[2]);

} catch (e) {
  failed = true;
  console.error(`失敗: ${e}`);
} finally {
  try { await Promise.race([cdp.send("Browser.close"), Bun.sleep(5000)]); } catch {}
  await Bun.sleep(1500);
  Bun.spawnSync(["taskkill", "/PID", String(pid), "/T", "/F"], { stdout: "ignore", stderr: "ignore" }); // 自分が起動したプロセス木だけ
  server.stop(true);
  console.log(`一時フォルダー（要片付け）: ${work}`);
  process.exit(failed ? 1 : 0);
}
