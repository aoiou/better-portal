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
