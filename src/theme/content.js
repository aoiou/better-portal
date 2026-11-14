(() => {
  'use strict';

  const CACHE_KEY = 'bp-theme-setting';
  let currentSetting = 'system';

  function resolveTheme(setting) {
    if (setting === 'dark' || setting === 'light') {
      return setting;
    }
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }

  function applyTheme(setting) {
    const validSetting = (setting === 'light' || setting === 'dark') ? setting : 'system';
    currentSetting = validSetting;
    const resolved = resolveTheme(validSetting);
    document.documentElement.setAttribute('data-bp-theme', resolved);
    return validSetting;
  }

  function cacheSetting(setting) {
    try {
      localStorage.setItem(CACHE_KEY, setting);
    } catch {
      // localStorage が無効な環境では無視
    }
  }

  // 1. ページ描画前のチラツキ（FOUC）を防ぐため、document_start で同期的にキャッシュを適用
  let initialSetting = 'system';
  try {
    initialSetting = localStorage.getItem(CACHE_KEY) || 'system';
  } catch {
    initialSetting = 'system';
  }
  applyTheme(initialSetting);

  // 2. 拡張機能ストレージから最新のテーマ設定を取得して同期
  async function storageGet(keys) {
    try {
      return await browser.storage.sync.get(keys);
    } catch {
      return await browser.storage.local.get(keys);
    }
  }

  async function syncThemeFromStorage() {
    try {
      const res = await storageGet(['theme']);
      const applied = applyTheme(res?.theme || 'system');
      cacheSetting(applied);
    } catch {
      // ストレージ取得失敗時は初期設定を維持
    }
  }

  syncThemeFromStorage();

  // 3. ポップアップでのテーマ変更をリアルタイムに反映
  browser.storage?.onChanged?.addListener((changes) => {
    if (changes.theme) {
      const applied = applyTheme(changes.theme.newValue || 'system');
      cacheSetting(applied);
    }
  });

  // 4. OSのカラーテーマ変更に動的追従（システム設定選択時）
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (currentSetting === 'system') {
      applyTheme('system');
    }
  });
})();
