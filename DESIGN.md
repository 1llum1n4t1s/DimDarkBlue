# Dim Dark Blue 設計

## 目的

Chrome のブラウザ UI（タブ、ツールバー、アドレスバー、新しいタブページ）を、`#192129` を基調とする濃紺に着せ替える。Web ページの配色は変えない。

## 構成と責務

| 要素 | 責務 |
|---|---|
| `manifest.json` | 配布物の本体。Manifest V3 のテーマで、`theme.colors` が配色の正本 |
| `_locales/` | 概要の日英文言（名前は manifest に直書き） |
| `icons/` | 16・48・128px のアイコン |
| `scripts/check.ts` | manifest・概要文言・アイコンの検査（読み取りのみ） |
| `scripts/pack.ts` | ストア提出用 `DimDarkBlue.zip` の作成 |
| `scripts/screenshots.ts` | 掲載画像の撮影と検査（Windows 専用） |
| `store/` | ストア掲載文の下書きと掲載画像。ZIP には入らない |

スクリプトはすべて Bun で動き、依存パッケージを持たない。

## データの流れ

- 実行時: Chrome が `theme.colors` を読み、UI の色に反映する。このテーマ自身のコードは動かない。
- 検査: `check.ts` が manifest の項目、概要文言、色キー、RGB、コントラスト比（文字色は 4.5 以上、ツールバーと枠は 2.0 以上）、アイコンの実寸を調べ、問題があれば終了コード 1 で終わる。
- 配布: `pack.ts` が manifest・LICENSE・`_locales/`・`icons/` を ZIP にまとめる。検査は呼ばないため、別に実行する。
- 掲載画像: `screenshots.ts` がテーマのコピーを一時プロファイルの Chrome に CDP で読み込み、その窓だけを撮って `store/images/` へ書き出す。操作と制約の詳細は [AGENTS.md](AGENTS.md) を参照。

## 不変条件

- `theme` には `colors` だけを置き、権限・スクリプト・画像を持たない。
- 色キーは Chromium の `kOverwritableColorTable` にあるものに限る。
- `toolbar` は `frame`・`frame_inactive`・シークレットの枠より明るくし（コントラスト比 2.0 以上。`check.ts` が検査する）、`button_background` は使わない（後者は `check.ts` が拒否する）。
- 検査対象の文字色と背景色の組は、コントラスト比 4.5 以上を保つ。
- 配布 ZIP の中身は manifest・LICENSE・`_locales/`・`icons/` だけとする。
- 掲載スクリーンショットは 1280x800、小タイルは 440x280 とする。
- README の配色表は `manifest.json` と一致させる。

## 設計判断

| 判断 | 理由 | 代償 |
|---|---|---|
| 色だけのテーマ | 権限もコードも不要になる | 色キーの無い部分は変えられない |
| `toolbar` を `frame` より明るくする | アクティブタブとツールバーを、枠と比 2.0 以上の明暗差で区別する。Brave のピン留めタブの枠線も消える | ツールバーが明るくなり、全体の濃紺の落ち着きはやや減る |
| `button_background` を使わない | Windows の右上の3ボタンの背景に重なり、枠と色がずれる | ボタンの背景色を指定できない |
| 許可キーの一覧を `check.ts` に持つ | Chrome は無効なキーを無言で無視する | Chromium 側の変更に手で追従する |
| ZIP を自前で書き、日時を固定する | 依存を持たず、出力を再現しやすくする | ZIP 形式の処理を保守する |
| 実際の Chrome の窓を撮る | テーマ適用後の見た目を正確に載せる | Windows と Chrome が要り、Chrome の変更の影響を受ける |
| 概要だけを `_locales/` に分ける | ストアの掲載情報を日英に分ける。名前は共通 | 両言語の文言を保守する |
| 言語ごとに別の一時プロファイルで撮る | 普段の Chrome に触れず、UI の言語を分ける | 一時フォルダーの片付けが要る |
| シークレットの画像を載せない | Chrome 158 の unpacked 読み込みでは、シークレット窓にテーマが適用されなかった | 指定済みのシークレット用の色は掲載画像で示せない |
