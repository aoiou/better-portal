# 開発メモ

## `browser` 名前空間について

本拡張機能では、拡張機能 API の呼び出しに `browser.*`（例: `browser.storage.sync`、`browser.tabs.create`）を使用しています。

### Chrome での `browser` 名前空間サポート

**Chrome 148 以降**では、既存の `chrome` 名前空間に加えて、すべての Chrome 拡張機能 API が `browser` 名前空間で使用できるようになりました。
つまり、`browser.tabs.create({})` と `chrome.tabs.create({})` は同等です。

- 参照: https://developer.chrome.com/docs/extensions/develop/concepts/browser-namespace

このため、本拡張機能では `webextension-polyfill` 等のポリフィルを導入せず、`browser.*` をそのまま使用しています。

### `minimum_chrome_version` について

`manifest.json` で `"minimum_chrome_version": "150"` を指定しているのは、上記の `browser` 名前空間サポート（Chrome 148+）が前提となっているためです。
バージョン 148 未満の Chrome ではポリフィルなしに `browser.*` を使用するとエラーになるため、安全マージンを含めて 150 を最低バージョンとしています。

## `manifest.json` の `background` フィールドに `scripts` と `service_worker` が共存している理由

`manifest.json` の `background` フィールドには、MV2 用の `scripts` と MV3 用の `service_worker` の両方が記載されています。

```json
"background": {
  "scripts": ["background.js"],
  "service_worker": "background.js"
}
```

### Chrome（MV3）

Chrome では `service_worker` のみが使用され、`scripts` は無視されます。

### Firefox

Firefox は `background.service_worker` を未サポートです（[Firefox bug 1573659](https://bugzilla.mozilla.org/show_bug.cgi?id=1573659)）。
そのため、`service_worker` が指定されていない場合、または Service Worker 機能が無効な場合に `background.scripts`（または `background.page`）を使用します。

- Firefox 121 未満: `service_worker` が存在すると background page が起動しないバグがありました（[Firefox bug 1860304](https://bugzilla.mozilla.org/show_bug.cgi?id=1860304)）。
- **Firefox 121 以降**: `service_worker` の有無にかかわらず background page が正常に起動します。

本拡張機能の最低バージョンは Firefox 150 であるため、両フィールドを共存させることで Chrome/Firefox 双方に対応しています。
`scripts` フィールドは冗長に見えますが、Firefox 互換性のために必要です。

## ログイン画面における設定変更のリアルタイム反映について

`auth/content.js` では初回読み込み時に設定をキャッシュし、以降はキャッシュを使い回す設計になっています。
`storage.onChanged` リスナーを追加してポップアップからの設定変更を即座に反映させることも可能ですが、**意図的に実装していません**。

ログインページを開いている最中に設定が変わって動作が切り替わると、ユーザーにとって混乱を招くためです。
設定変更はページリロード後に反映される現在の挙動が、最もシンプルで予測しやすいと判断しています。

## ビルドレス構成と `src/manifest.json` による読込順管理

`src/portal/` 配下のモジュール群は、バンドラーやトランスパイラーを使わず、IIFE と `globalThis.BetterPortal` 名前空間で結合しています。
これは、Firefox Add-ons 審査時にビルド成果物とソースコードの再現手順（ソース提出）を不要にするための意図的な設計です。

スクリプトの読み込み順は `src/manifest.json` の `content_scripts` に一元定義されており、テスト側（`tests/helpers/test-helpers.mjs` の `getPortalScriptList`）も配列を重複管理せず `src/manifest.json` から直接読み込んで検証しています。

## `portal/page.js`（MAIN world）による Microsoft 365 リンク書換

コンテンツスクリプトは Isolated world で動作するため、ポータル側の `window.doPortal` やインライン `onclick` を直接書き換えても意図通りに動作しません。
そのため、`portal/url-m365.js` がリンク要素に `data-bp-onclick` を設定して `bp-onclick-change` カスタムイベントを発火し、`world: "MAIN"` で実行される `portal/page.js` が受け取って `onclick` 属性および `window.doPortal(...)` 呼び出しへ反映する橋渡し構造を採用しています。

## プリペイントヒントキャッシュとストレージ書込キュー

ポータル画面では描画前のチラツキ（FOUC）を抑えるため、`document_start` で `localStorage`（`bp-portal-hints`）から表示ヒント属性を同期的にルート要素へ適用しつつ、`browser.storage.sync` と `browser.storage.local` を並列先読み（`Storage.preloadSettings`）しています。

また、連続操作時の競合や古いデータでの上書きを防ぐため、保存処理は単一フライトの書込キュー（`queuedSnapshot`）で最新スナップショットのみを直列に永続化し、`sync` 保存失敗時の `local` フォールバック中（`betterPortalLocalFallback` フラグ保持中）は古い `sync` データで上書きされないよう保護しています。

## Pointer Events + FLIP 並び替えとドロップ時即時確定

`portal/drag-drop.js` は HTML5 Drag and Drop ではなく Pointer Events + FLIP アニメーションで実装しています（ドラッグ中のリアルタイム並び替え、タッチ長押しドラッグ、画面端オートスクロール、`Esc` キャンセルに対応するため）。

並び替え結果の保存コールバック（`onOrderCommit`）はドロップ後の整列（settle）アニメーション完了を待たず `pointerup` 時点で即座に呼び出しており、整列中に編集モードを終了しても新しい並び順が確実に永続化されます。また、`portal/content.js` の `cardById` マップにより、リセットや再描画時もオリジナルカードの DOM 要素・画像ノードを再利用して不要な再生成を防いでいます。

## 自動テストの実行

外部パッケージへの依存はなく、Node.js 標準のテストランナー（`node:test`）のみで実行できます。

```bash
node --test tests/*.test.mjs
```
