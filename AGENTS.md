# Dim Dark Blue（Chrome ブラウザテーマ）

- 配色の正本は `manifest.json` の `theme.colors`。色キーは Chromium `chrome/browser/themes/browser_theme_pack.cc` の `kOverwritableColorTable` にあるものだけ（無効キーは Chrome が無言で無視する）。配色表は README.md にも書いているので、変更時は両方を揃える。
- `toolbar` は `frame` と同色にする（Brave のピン留めタブの枠線は `frame` と `toolbar` の明るさから自動で決まり、同色のとき暗くなる）。
- `button_background` は使わない（Windows の右上の3ボタンの背景に重なり、枠 `frame` と色がずれる）。
- 検証: `bun --no-env-file scripts/check.ts`（許可キー・RGB 範囲・文字コントラスト 4.5 以上・アイコン実寸）。
- パッケージ: `bun --no-env-file scripts/pack.ts` で `DimDarkBlue.zip`（manifest.json・icons・LICENSE のみ）。ZIP は git に入れない。
- 版（`manifest.json` の `version`）は通常作業で上げない。上げるのは `/vava` の依頼時だけ。
- ストア用 CI は未導入（CWS の item ID が未取得）。掲載文の下書きは `store/`。掲載画像は `store/images/`（`en/` と `ja/` に `screenshot-01〜03.png`＝1280x800・アルファなし、言語共通の `tile-small.png`＝440x280）。
- 掲載画像の再撮影: `bun --no-env-file scripts/screenshots.ts`（Windows・Chrome・Bun 専用、依存ゼロ。言語指定なしは en・ja を順に、言語ごとに別の一時プロファイルの Chrome で撮る。`--locale=en|ja` で 1 言語だけ。タイルは en のときだけ作り直す。ja は `--lang=ja --accept-lang=ja`、HTML の lang・フォント・タブ名・ブックマーク名を日本語にし、撮影中に location.href・navigator.languages・カード文のはみ出しを CDP で実測する）。一時プロファイルの Chrome に一時置き場のテーマのコピーを CDP の `Extensions.loadUnpacked`（`--remote-debugging-pipe`。Chrome 158 では `--load-extension` が効かない）で読み込み、その窓だけを PrintWindow で撮る。窓は画面外に置く。撮影後は枠とツールバー（どちらも `#15202B`）を画素で確かめる（`--verify` で既存画像の寸法・アルファ・画素、タイルの副題のコントラスト比 4.5 以上、icon-128.png の四隅のアルファ 0 を再検査）。中身は 01 新しいタブ（履歴に残らない data: URL のタブを使い、「よく見るサイト」に自作ページを出さない）、02 `http://garden.localhost/`（外部通信は `MAP * ~NOTFOUND` で遮断し、提案枠の日本語を出さない。`--host-resolver-rules` で 127.0.0.1 とポートを隠す）の自作ページ、03 暗めの自作ページ＋ブックマークバー（Ctrl+Shift+B を送る）。出力される一時フォルダー（`ddb-shot-*`）は Prunlet CLI で片付ける。画像は目視確認してから採用する。
- シークレット窓にはこのテーマが適用されない（Chrome 158・CDP の unpacked 読み込みで実測。ストアから入れた場合は未確認。枠が既定の `#1F2020` のまま）ため、掲載画像にシークレットは使わない（撮影スクリプトに確認処理は残していない）。
- Twitter / X の商標語は manifest・ストア文に入れない。ロゴやそれに似た図形もアイコンに使わない。
- permissions・JS・HTML は追加しない（画像なしの colors テーマ）。
