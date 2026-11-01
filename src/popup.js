document.addEventListener('DOMContentLoaded', async () => {
  // =====================================================================
  // ストレージヘルパー（sync → local フォールバック）
  // content.js にも同一実装あり。コンテントスクリプトとポップアップは実行コンテキストが
  // 異なりモジュール共有不可のため、意図的な複製。
  // =====================================================================
  async function storageGet(keys) {
    try {
      return await browser.storage.sync.get(keys);
    } catch (e) {
      return await browser.storage.local.get(keys);
    }
  }

  async function storageSet(data) {
    try {
      await browser.storage.sync.set(data);
    } catch (e) {
      await browser.storage.local.set(data);
    }
  }

  const LOGIN_URL = 'https://doshisha.ex-tic.com/auth/session';

  const usernameInput = document.getElementById('username-input');
  const clearBtn = document.getElementById('clear-btn');
  const saveIndicator = document.getElementById('save-indicator');
  const autoSubmitToggle = document.getElementById('auto-submit-toggle');
  const autoFido2Toggle = document.getElementById('auto-fido2-toggle');
  const autoPasswordTabToggle = document.getElementById('auto-password-tab-toggle');
  const themeToggle = document.getElementById('theme-toggle');
  const themeMenu = document.getElementById('theme-menu');
  const themeMenuItems = document.querySelectorAll('.theme-menu-item');
  const targetDomainLink = document.getElementById('target-domain-link');
  const versionText = document.getElementById('version-text');

  let feedbackTimeout = null;
  let debounceTimeout = null;

  // 直前に保存された状態をキャッシュ
  let lastSavedState = {
    username: '',
    autoSubmit: false,
    autoFido2: false,
    autoPasswordTab: false
  };

  // テーマ管理 (system: OS連動 / light: ライト / dark: ダーク)
  let currentThemeSetting = 'system';

  function applyTheme(themeSetting) {
    const validSetting = (themeSetting === 'light' || themeSetting === 'dark') ? themeSetting : 'system';
    currentThemeSetting = validSetting;

    // OS設定を解決して常に 'dark' | 'light' を data-theme にセット（@media 不要）
    const resolvedTheme = validSetting === 'system'
      ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
      : validSetting;

    document.documentElement.setAttribute('data-theme', resolvedTheme);
    document.documentElement.setAttribute('data-theme-setting', validSetting);

    updateThemeToggleUI(validSetting);
    updateThemeMenuUI(validSetting);
    return validSetting;
  }

  function updateThemeToggleUI(themeSetting) {
    if (!themeToggle) return;
    const titles = {
      system: '外観テーマ: システム設定 (クリックで変更)',
      light: '外観テーマ: ライト (クリックで変更)',
      dark: '外観テーマ: ダーク (クリックで変更)'
    };
    const title = titles[themeSetting] || titles.system;
    themeToggle.title = title;
    themeToggle.setAttribute('aria-label', title);
  }

  function updateThemeMenuUI(themeSetting) {
    if (!themeMenuItems) return;
    themeMenuItems.forEach((item) => {
      const val = item.getAttribute('data-theme-value');
      const isActive = val === themeSetting;
      item.classList.toggle('active', isActive);
      item.setAttribute('aria-checked', isActive ? 'true' : 'false');
    });
  }

  async function setTheme(themeSetting) {
    const applied = applyTheme(themeSetting);
    try {
      await storageSet({ theme: applied });
    } catch (err) {
      console.error('Failed to save theme:', err);
    }
  }

  // テーマドロップダウンメニューの開閉制御
  function openThemeMenu() {
    if (!themeMenu || !themeToggle) return;
    themeMenu.removeAttribute('hidden');
    themeToggle.setAttribute('aria-expanded', 'true');
    const activeItem = themeMenu.querySelector('.theme-menu-item.active') || themeMenu.querySelector('.theme-menu-item');
    activeItem?.focus();
  }

  function closeThemeMenu() {
    if (!themeMenu || !themeToggle) return;
    themeMenu.setAttribute('hidden', '');
    themeToggle.setAttribute('aria-expanded', 'false');
  }

  function toggleThemeMenu() {
    if (!themeMenu) return;
    if (themeMenu.hasAttribute('hidden')) {
      openThemeMenu();
    } else {
      closeThemeMenu();
    }
  }

  // トグルカードの非言語保存パルス演出
  function triggerOptionPulse(inputElement) {
    const item = inputElement.closest('.option-item');
    if (!item) return;
    item.classList.remove('saved-pulse');
    void item.offsetWidth;
    item.classList.add('saved-pulse');
    item.addEventListener('animationend', () => {
      item.classList.remove('saved-pulse');
    }, { once: true });
  }

  // 入力欄の保存完了フィードバック演出（枠線の緑発光 & ✓アイコン）
  function showSaveFeedback(duration = 1800) {
    if (feedbackTimeout) {
      clearTimeout(feedbackTimeout);
    }

    usernameInput.classList.add('is-saved');
    saveIndicator.classList.add('visible');

    feedbackTimeout = setTimeout(() => {
      usernameInput.classList.remove('is-saved');
      saveIndicator.classList.remove('visible');
    }, duration);
  }

  // クリアボタンの表示切り替え
  function updateClearButton() {
    clearBtn.classList.toggle('visible', usernameInput.value.length > 0);
  }

  // バージョン番号の動的反映 (manifest.json から取得)
  function renderVersion() {
    if (!versionText) return;
    try {
      const manifest = browser.runtime?.getManifest?.();
      if (manifest && manifest.version) {
        versionText.textContent = `v${manifest.version}`;
      } else {
        versionText.textContent = '';
      }
    } catch (err) {
      console.warn('Failed to load version from manifest:', err);
      versionText.textContent = '';
    }
  }

  // ストレージから設定を取得
  async function loadSettings() {
    try {
      const res = await storageGet(['savedUsername', 'autoSubmit', 'autoFido2', 'autoPasswordTab', 'theme']);
      applyTheme(res.theme || 'system');

      const username = res.savedUsername || '';
      const autoSubmit = !!res.autoSubmit;
      const autoFido2 = !!res.autoFido2;
      const autoPasswordTab = !!res.autoPasswordTab;

      usernameInput.value = username;
      if (autoSubmitToggle) autoSubmitToggle.checked = autoSubmit;
      if (autoFido2Toggle) autoFido2Toggle.checked = autoFido2;
      if (autoPasswordTabToggle) autoPasswordTabToggle.checked = autoPasswordTab;

      lastSavedState = { username, autoSubmit, autoFido2, autoPasswordTab };
      updateClearButton();
    } catch (err) {
      console.error('Failed to load storage:', err);
    }
  }

  // ストレージに保存
  async function saveSettings(options = { showFeedback: true }) {
    if (debounceTimeout) {
      clearTimeout(debounceTimeout);
      debounceTimeout = null;
    }

    const username = usernameInput.value.trim();
    const autoSubmit = autoSubmitToggle?.checked ?? false;
    const autoFido2 = autoFido2Toggle?.checked ?? false;
    const autoPasswordTab = autoPasswordTabToggle?.checked ?? false;

    // 前回の保存内容と同一なら無駄な書き込みをスキップ
    const isUsernameChanged = username !== lastSavedState.username;
    const isOptionsChanged =
      autoSubmit !== lastSavedState.autoSubmit ||
      autoFido2 !== lastSavedState.autoFido2 ||
      autoPasswordTab !== lastSavedState.autoPasswordTab;

    if (!isUsernameChanged && !isOptionsChanged) {
      return;
    }

    const settings = { savedUsername: username, autoSubmit, autoFido2, autoPasswordTab };

    try {
      await storageSet(settings);
      lastSavedState = { username, autoSubmit, autoFido2, autoPasswordTab };
    } catch (err) {
      console.error('Failed to save settings:', err);
      return;
    }

    if (options.showFeedback && isUsernameChanged) {
      showSaveFeedback();
    }
  }

  // 入力停止検知（デバウンス保存: 1000ms）
  function triggerDebouncedSave() {
    updateClearButton();
    if (debounceTimeout) {
      clearTimeout(debounceTimeout);
    }
    debounceTimeout = setTimeout(() => {
      saveSettings({ showFeedback: true });
    }, 1000);
  }

  // イベントリスナー登録

  // 1. 入力中：クリアボタン表示切替 ＆ デバウンス保存（1000ms）
  usernameInput.addEventListener('input', triggerDebouncedSave);

  // 2. フォーカスが外れた時（blur）：即時保存
  usernameInput.addEventListener('blur', () => {
    saveSettings({ showFeedback: true });
  });

  // 3. Enterキー：即時保存してフォーカスを外す
  usernameInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      saveSettings({ showFeedback: true });
      usernameInput.blur();
    }
  });

  // 4. クリアボタン押下：入力値を空にして即時保存
  clearBtn.addEventListener('click', () => {
    usernameInput.value = '';
    updateClearButton();
    saveSettings({ showFeedback: false });
    usernameInput.focus();
  });

  // 5. 「自動で次へ」トグル：即時保存 ＆ 非言語パルス
  autoSubmitToggle?.addEventListener('change', () => {
    saveSettings({ showFeedback: false });
    triggerOptionPulse(autoSubmitToggle);
  });

  // 排他トグル：一方をONにすると他方をOFFにする
  function handleExclusiveToggle(toggled, other) {
    if (toggled.checked && other?.checked) {
      other.checked = false;
      triggerOptionPulse(other);
    }
    saveSettings({ showFeedback: false });
    triggerOptionPulse(toggled);
  }

  // 6. 「パスワードレス認証」トグル
  autoFido2Toggle?.addEventListener('change', () => {
    handleExclusiveToggle(autoFido2Toggle, autoPasswordTabToggle);
  });

  // 7. 「パスワード」タブ自動選択トグル
  autoPasswordTabToggle?.addEventListener('change', () => {
    handleExclusiveToggle(autoPasswordTabToggle, autoFido2Toggle);
  });

  // 8. 外観テーマ設定（ドロップダウンメニュー操作・切り替え）
  if (themeToggle) {
    themeToggle.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleThemeMenu();
    });
  }

  themeMenuItems.forEach((item) => {
    item.addEventListener('click', async (e) => {
      e.stopPropagation();
      const val = item.getAttribute('data-theme-value');
      await setTheme(val);
      closeThemeMenu();
      themeToggle?.focus();
    });
  });

  // メニュー内のキーボード操作（上下矢印キーでの移動）
  if (themeMenu) {
    themeMenu.addEventListener('keydown', (e) => {
      const items = Array.from(themeMenuItems);
      const currentIndex = items.indexOf(document.activeElement);

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        const nextIndex = (currentIndex + 1) % items.length;
        items[nextIndex]?.focus();
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        const prevIndex = (currentIndex - 1 + items.length) % items.length;
        items[prevIndex]?.focus();
      }
    });
  }

  // メニュー外クリックで閉じる
  document.addEventListener('click', (e) => {
    if (themeMenu && !themeMenu.hasAttribute('hidden')) {
      if (!themeMenu.contains(e.target) && !themeToggle?.contains(e.target)) {
        closeThemeMenu();
      }
    }
  });

  // Escapeキーで閉じる
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && themeMenu && !themeMenu.hasAttribute('hidden')) {
      closeThemeMenu();
      themeToggle?.focus();
    }
  });

  // OSテーマ設定変更リスナー（システム設定時のみ動的追従）
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (currentThemeSetting === 'system') {
      applyTheme('system');
    }
  });

  // 9. 対象ドメインクリック：ログインページを新規タブで開く
  if (targetDomainLink) {
    targetDomainLink.addEventListener('click', (e) => {
      e.preventDefault();
      browser.tabs.create({ url: LOGIN_URL });
    });
  }

  // 初期ロード
  renderVersion();
  await loadSettings();
  usernameInput.focus();
});
