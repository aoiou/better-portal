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

`auth-content.js` では初回読み込み時に設定をキャッシュし、以降はキャッシュを使い回す設計になっています。
`storage.onChanged` リスナーを追加してポップアップからの設定変更を即座に反映させることも可能ですが、**意図的に実装していません**。

ログインページを開いている最中に設定が変わって動作が切り替わると、ユーザーにとって混乱を招くためです。
設定変更はページリロード後に反映される現在の挙動が、最もシンプルで予測しやすいと判断しています。
