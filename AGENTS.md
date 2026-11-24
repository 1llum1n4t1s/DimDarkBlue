# Dim Dark Blue（Chrome ブラウザテーマ）

- 配色の正本は `manifest.json` の `theme.colors`。色キーは Chromium `chrome/browser/themes/browser_theme_pack.cc` の `kOverwritableColorTable` にあるものだけ（無効キーは Chrome が無言で無視する）。配色表は README.md にも書いているので、変更時は両方を揃える。
- 検証: `bun --no-env-file scripts/check.ts`（許可キー・RGB 範囲・文字コントラスト 4.5 以上・アイコン実寸）。
- パッケージ: `bun --no-env-file scripts/pack.ts` で `DimDarkBlue.zip`（manifest.json・icons・LICENSE のみ）。ZIP は git に入れない。
- 版（`manifest.json` の `version`）は通常作業で上げない。上げるのは `/vava` の依頼時だけ。
- ストア用 CI は未導入（CWS の item ID が未取得）。掲載文の下書きは `store/`。掲載画像は未作成。
- Twitter / X の商標語は manifest・ストア文に入れない。ロゴやそれに似た図形もアイコンに使わない。
- permissions・JS・HTML は追加しない（画像なしの colors テーマ）。
