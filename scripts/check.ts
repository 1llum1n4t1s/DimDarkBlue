// manifest.json の検査。依存ゼロ。使い方: bun --no-env-file scripts/check.ts [manifest.jsonのパス]
// 色キーの許可一覧は Chromium chrome/browser/themes/browser_theme_pack.cc の
// kOverwritableColorTable（無効なキーは Chrome が無言で無視するため、ここで弾く）。
// button_background は有効なキーだが、Windows の右上の3ボタンの背景に重なって枠と色がずれるため許可しない。
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const ALLOWED_COLORS = new Set([
  "background_tab", "background_tab_inactive", "background_tab_incognito",
  "background_tab_incognito_inactive", "bookmark_text",
  "frame", "frame_inactive", "frame_incognito", "frame_incognito_inactive",
  "ntp_background", "ntp_header", "ntp_link", "ntp_text",
  "omnibox_background", "omnibox_text",
  "tab_background_text", "tab_background_text_inactive",
  "tab_background_text_incognito", "tab_background_text_incognito_inactive",
  "tab_text", "toolbar", "toolbar_button_icon", "toolbar_text",
]);

// [文字色, 背景色] の組。どちらも theme.colors のキー。
const PAIRS: [string, string][] = [
  ["tab_text", "toolbar"],
  ["toolbar_text", "toolbar"],
  ["toolbar_button_icon", "toolbar"],
  ["bookmark_text", "toolbar"],
  ["tab_background_text", "background_tab"],
  ["tab_background_text_inactive", "background_tab_inactive"],
  ["tab_background_text_incognito", "background_tab_incognito"],
  ["tab_background_text_incognito_inactive", "background_tab_incognito_inactive"],
  ["omnibox_text", "omnibox_background"],
  ["ntp_text", "ntp_background"],
  ["ntp_link", "ntp_background"],
  ["ntp_text", "ntp_header"],
];
const MIN_CONTRAST = 4.5;
// 面どうしの組。toolbar 対 frame が 2.0 以上だと Brave のピン留めタブの枠線が消える（GetToolbarTopSeparatorColor）。
const SURFACE_PAIRS: [string, string][] = [
  ["toolbar", "frame"],
  ["toolbar", "frame_inactive"],
  ["toolbar", "frame_incognito"],
  ["toolbar", "frame_incognito_inactive"],
];
const MIN_SURFACE_CONTRAST = 2.0;

const errors: string[] = [];
const manifestPath = resolve(process.argv[2] ?? join(import.meta.dir, "..", "manifest.json"));
const root = dirname(manifestPath);
const m = JSON.parse(readFileSync(manifestPath, "utf8"));

if (m.manifest_version !== 3) errors.push("manifest_version は 3");
if (!m.name || /__MSG_/.test(m.name)) errors.push("name は直書き");
if (m.description !== "__MSG_appDescription__" || m.default_locale !== "en") errors.push("description は __MSG_appDescription__、default_locale は en");
for (const l of readdirSync(join(root, "_locales"))) {
  const d: string = JSON.parse(readFileSync(join(root, "_locales", l, "messages.json"), "utf8")).appDescription?.message ?? "";
  if (!d || d.length > 132) errors.push(`${l} の appDescription が ${d.length} 文字 (1〜132)`);
  if (/twitter|\bx\b/i.test(d)) errors.push(`${l} の appDescription に商標語`);
}
for (const k of ["permissions", "host_permissions", "content_scripts", "background", "action"])
  if (k in m) errors.push(`${k} は入れない`);

const colors: Record<string, unknown> = m.theme?.colors ?? {};
const rgb = new Map<string, number[]>();
for (const [k, v] of Object.entries(colors)) {
  if (!ALLOWED_COLORS.has(k)) { errors.push(`無効な色キー: ${k}`); continue; }
  if (!Array.isArray(v) || v.length !== 3 || v.some((n) => !Number.isInteger(n) || n < 0 || n > 255))
    errors.push(`RGB が不正: ${k}`);
  else rgb.set(k, v as number[]);
}
for (const k of Object.keys(m.theme ?? {})) if (k !== "colors") errors.push(`theme.${k} は使わない (colors のみ)`);

const lum = (c: number[]) => {
  const [r, g, b] = c.map((x) => { const s = x / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a: number[], b: number[]) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};
for (const [fg, bg] of PAIRS) {
  const f = rgb.get(fg), b = rgb.get(bg);
  if (!f || !b) { errors.push(`コントラスト対象が未設定: ${fg} / ${bg}`); continue; }
  const r = ratio(f, b);
  console.log(`${r >= MIN_CONTRAST ? "OK  " : "NG  "} ${r.toFixed(2).padStart(5)}  ${fg} on ${bg}`);
  if (r < MIN_CONTRAST) errors.push(`コントラスト不足 ${r.toFixed(2)}: ${fg} on ${bg}`);
}

for (const [a, c] of SURFACE_PAIRS) {
  const x = rgb.get(a), y = rgb.get(c);
  if (!x || !y) { errors.push(`コントラスト対象が未設定: ${a} / ${c}`); continue; }
  const r = ratio(x, y);
  console.log(`${r >= MIN_SURFACE_CONTRAST ? "OK  " : "NG  "} ${r.toFixed(2).padStart(5)}  ${a} on ${c} (面・2.0以上)`);
  if (r < MIN_SURFACE_CONTRAST) errors.push(`面の明暗差不足 ${r.toFixed(2)}: ${a} on ${c}`);
}

// アイコン: 宣言サイズと PNG の IHDR の実寸が一致すること
for (const [size, path] of Object.entries<string>(m.icons ?? {})) {
  try {
    const b = readFileSync(join(root, path));
    const sig = b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    const w = b.readUInt32BE(16), h = b.readUInt32BE(20);
    if (!sig) errors.push(`PNG ではない: ${path}`);
    else if (w !== Number(size) || h !== Number(size)) errors.push(`${path} の実寸 ${w}x${h} が宣言 ${size} と不一致`);
    else console.log(`OK   icon ${path} ${w}x${h}`);
  } catch { errors.push(`アイコンが読めない: ${path}`); }
}

if (errors.length) {
  console.error("\n失敗:\n" + errors.map((e) => "  - " + e).join("\n"));
  process.exit(1);
}
console.log("\n検査OK");
