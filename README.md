# Dim Dark Blue

Chrome のブラウザ UI（タブ、ツールバー、アドレスバー、新しいタブページ）を、落ち着いた濃紺 `#15202B` を基調に着せ替えるブラウザテーマです。画像を使わない色指定だけのテーマで、権限・スクリプトはありません。

> 状態: 開発中。Chrome ウェブストアには未提出です。

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
| ウィンドウ枠・背景タブ・アドレスバー・新しいタブ背景 | `frame` `background_tab` `omnibox_background` `ntp_background` | `#15202B` |
| 非アクティブ枠・非アクティブの背景タブ・NTP ヘッダー | `frame_inactive` `background_tab_inactive` `ntp_header` | `#192734` |
| ツールバー（アクティブタブ）・ボタン背景 | `toolbar` `button_background` | `#22303C` |
| シークレットの枠・背景タブ | `frame_incognito` `background_tab_incognito` | `#0E151C` |
| シークレットの非アクティブ | `frame_incognito_inactive` `background_tab_incognito_inactive` | `#121B24` |
| 文字 | `tab_text` `toolbar_text` `bookmark_text` `omnibox_text` `ntp_text` | `#E7E9EA` |
| 補助文字・アイコン | `tab_background_text*` `toolbar_button_icon` | `#8B98A5` |
| NTP のリンク | `ntp_link` | `#1D9BF0` |

## ローカルで読み込む

1. Chrome で `chrome://extensions` を開く。
2. 右上の「デベロッパー モード」を有効にする。
3. 「パッケージ化されていない拡張機能を読み込む」でこのフォルダーを選ぶ。

元に戻すには、設定の「デザイン」からテーマをリセットします。

## 検査と ZIP の作成

Bun が必要です。依存パッケージはありません。

```
bun --no-env-file scripts/check.ts   # manifest・色キー・コントラスト・アイコン実寸の検査
bun --no-env-file scripts/pack.ts    # DimDarkBlue.zip（manifest.json・icons・LICENSE のみ）を作成
```

## ライセンス

MIT。`LICENSE` を参照してください。
