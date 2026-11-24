# Dim Dark Blue

Chrome のブラウザ UI（タブ、ツールバー、アドレスバー、新しいタブページ）を、落ち着いた濃紺 `#192129` を基調に着せ替えるブラウザテーマです。画像を使わない色指定だけのテーマで、権限・スクリプトはありません。

## Twitter / X とは無関係です

このテーマは Twitter / X 社とは無関係の非公式のものです。配色は、かつての Twitter の「Dim」配色に似た濃紺を参考にしていますが、同社の公式のものではなく、ロゴや画像も使っていません。

## DarkBlueThemeX との違い

| | Dim Dark Blue（このリポジトリ） | DarkBlueThemeX |
|---|---|---|
| 種類 | Chrome のブラウザテーマ | ブラウザ拡張機能 |
| 塗る対象 | Chrome 自体の UI | X のページの配色 |
| 権限・スクリプト | なし | あり（ページへ注入） |

## 配色

正本は `manifest.json` の `theme.colors` です。文字色の組は 4.5 以上のコントラスト比を `scripts/check.ts` で検査しています。

| 用途 | キー | 色 |
|---|---|---|
| ウィンドウ枠・背景タブ・新しいタブ背景 | `frame` `background_tab` `omnibox_background` `ntp_background` | `#192129` |
| ツールバー（アクティブタブ） | `toolbar` | `#313D49` |
| 非アクティブ枠・非アクティブの背景タブ・NTP ヘッダー | `frame_inactive` `background_tab_inactive` `ntp_header` | `#1D2630` |
| シークレットの枠・背景タブ | `frame_incognito` `background_tab_incognito` | `#0F151A` |
| シークレットの非アクティブ | `frame_incognito_inactive` `background_tab_incognito_inactive` | `#141B22` |
| 文字 | `tab_text` `toolbar_text` `bookmark_text` `omnibox_text` `ntp_text` | `#E7E9EA` |
| 補助文字 | `tab_background_text*` | `#8E98A2` |
| ツールバーのアイコン | `toolbar_button_icon` | `#A2ABB4` |
| NTP のリンク | `ntp_link` | `#3A99DB` |

アドレスバーは `omnibox_background` に `#192129` を指定していますが、Chrome 158 の実測では `#262A30` で表示されます（ツールバーから自動で決まる色とみられます）。

`toolbar` を `frame` より明るくし、Chrome の既定のテーマと同じくらいの明暗差（コントラスト比 約1.5）でアクティブなタブを区別しています。その代わり、Brave のピン留めタブの枠線（直接は指定できず、`frame` と `toolbar` の明るさから決まる）は明るくなります。

シークレット用の色は指定していますが、Chrome 158（unpacked 読み込み）での実測ではシークレット窓にテーマは適用されませんでした（既定の暗い色のまま）。

## ローカルで読み込む

1. Chrome で `chrome://extensions` を開く。
2. 右上の「デベロッパー モード」を有効にする。
3. 「パッケージ化されていない拡張機能を読み込む」でこのフォルダーを選ぶ。

元に戻すには、設定の「デザイン」からテーマをリセットします。

## 検査と ZIP の作成

Bun が必要です。依存パッケージはありません。

```
bun --no-env-file scripts/check.ts   # manifest・概要文言・色キー・コントラスト・アイコン実寸の検査
bun --no-env-file scripts/pack.ts    # DimDarkBlue.zip（manifest.json・_locales・icons・LICENSE のみ）を作成
```

## ストア掲載画像

`store/images/en/`（英語 UI）と `store/images/ja/`（日本語 UI）に、スクリーンショットを 3 枚ずつ（`screenshot-01.png` 新しいタブ、`screenshot-02.png` ローカルの固定ページ、`screenshot-03.png` 暗めのページとブックマークバー。いずれも 1280x800）、言語共通の小タイル `store/images/tile-small.png`（440x280）があります。実際の Chrome の窓にテーマを適用して撮っています（Windows のみ）。

```
bun --no-env-file scripts/screenshots.ts                # 英語・日本語を撮り直す（一時プロファイルの Chrome を使い、普段の Chrome には触れない）
bun --no-env-file scripts/screenshots.ts --locale=ja    # 1 言語だけ撮る（en | ja。タイルは en のときだけ作り直す）
bun --no-env-file scripts/screenshots.ts --verify       # 既存の画像（両言語）の寸法・アルファ・画素だけを検査する
```

## ライセンス

MIT。`LICENSE` を参照してください。
