document.addEventListener('DOMContentLoaded', async () => {
  const extBrowser = typeof browser !== 'undefined' ? browser : null;

  // =====================================================================
  // ストレージヘルパー（sync → local フォールバック）
  // =====================================================================
  async function storageGet(keys) {
    if (!extBrowser?.storage) return {};
    try {
      return await extBrowser.storage.sync.get(keys);
    } catch {
      return await extBrowser.storage.local.get(keys);
    }
  }

  async function storageSet(data) {
    if (!extBrowser?.storage) return;
    try {
      await extBrowser.storage.sync.set(data);
    } catch {
      await extBrowser.storage.local.set(data);
    }
  }

  const DEBOUNCE_DELAY = 1000;
  const FEEDBACK_DURATION = 1800;

  const usernameInput = document.getElementById('username-input');
  const clearBtn = document.getElementById('clear-btn');
  const saveIndicator = document.getElementById('save-indicator');
  const autoSubmitToggle = document.getElementById('auto-submit-toggle');
  const autoFido2Toggle = document.getElementById('auto-fido2-toggle');
  const autoPasswordTabToggle = document.getElementById('auto-password-tab-toggle');
  const themeToggle = document.getElementById('theme-toggle');
  const themeMenu = document.getElementById('theme-menu');
  const themeMenuItems = document.querySelectorAll('.theme-menu-item');
  const themeChoicesContainer = document.getElementById('theme-choices');
  const themeChoices = document.querySelectorAll('.theme-choice');
  const versionText = document.getElementById('version-text');
  const shortcutOsLabel = document.getElementById('shortcut-os-label');
  const shortcutModKey = document.getElementById('shortcut-mod-key');
  const shortcutKbdGroup = document.getElementById('shortcut-kbd-group');

  const PLATFORM_SHORTCUTS = {
    mac: { modKey: 'Option', osLabel: 'Mac' },
    win: { modKey: 'Alt', osLabel: 'Windows' },
    linux: { modKey: 'Alt', osLabel: 'Linux' },
    cros: { modKey: 'Alt', osLabel: 'ChromeOS' },
    openbsd: { modKey: 'Alt', osLabel: 'OpenBSD' },
    android: { modKey: 'Alt', osLabel: '' },
    fuchsia: { modKey: 'Alt', osLabel: '' },
    unknown: { modKey: 'Alt', osLabel: '' }
  };

  let feedbackTimeout = null;
  let debounceTimeout = null;
  let currentThemeSetting = 'system';

  let lastSavedState = {
    username: '',
    autoSubmit: false,
    autoFido2: false,
    autoPasswordTab: false
  };

  function applyTheme(themeSetting) {
    const validSetting = (themeSetting === 'light' || themeSetting === 'dark') ? themeSetting : 'system';
    currentThemeSetting = validSetting;

    const prefersDark = window.matchMedia?.('(prefers-color-scheme: dark)').matches;
    const resolvedTheme = validSetting === 'system' ? (prefersDark ? 'dark' : 'light') : validSetting;

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

  function syncThemeButtonGroup(buttons, themeSetting) {
    if (!buttons) return;
    buttons.forEach((btn) => {
      const val = btn.getAttribute('data-theme-value');
      const isActive = val === themeSetting;
      btn.classList.toggle('active', isActive);
      btn.setAttribute('aria-checked', isActive ? 'true' : 'false');
    });
  }

  function updateThemeMenuUI(themeSetting) {
    syncThemeButtonGroup(themeMenuItems, themeSetting);
    syncThemeButtonGroup(themeChoices, themeSetting);
  }

  async function setTheme(themeSetting) {
    const applied = applyTheme(themeSetting);
    try {
      await storageSet({ theme: applied });
    } catch (err) {
      console.error('[Better Portal] Failed to save theme:', err);
    }
  }

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

  function triggerOptionPulse(inputElement) {
    const item = inputElement?.closest('.option-item');
    if (!item) return;
    item.classList.remove('saved-pulse');
    void item.offsetWidth;
    item.classList.add('saved-pulse');
    item.addEventListener('animationend', () => {
      item.classList.remove('saved-pulse');
    }, { once: true });
  }

  function showSaveFeedback(duration = FEEDBACK_DURATION) {
    if (feedbackTimeout) {
      clearTimeout(feedbackTimeout);
    }

    usernameInput?.classList.add('is-saved');
    saveIndicator?.classList.add('visible');

    feedbackTimeout = setTimeout(() => {
      usernameInput?.classList.remove('is-saved');
      saveIndicator?.classList.remove('visible');
    }, duration);
  }

  function updateClearButton() {
    if (!clearBtn || !usernameInput) return;
    clearBtn.classList.toggle('visible', usernameInput.value.length > 0);
  }

  function renderVersion() {
    if (!versionText) return;
    try {
      const manifest = extBrowser?.runtime?.getManifest?.();
      versionText.textContent = manifest?.version ? `v${manifest.version}` : '';
    } catch (err) {
      console.warn('[Better Portal] Failed to load version from manifest:', err);
      versionText.textContent = '';
    }
  }

  function detectPlatformFromNavigator() {
    const nav = typeof navigator !== 'undefined' ? navigator : null;
    if (!nav) return 'unknown';

    const uaDataPlatform = nav.userAgentData?.platform || '';
    const platform = nav.platform || '';
    const userAgent = nav.userAgent || '';

    if (/mac/i.test(uaDataPlatform) || /mac/i.test(platform) || /macintosh|mac os x/i.test(userAgent)) {
      return 'mac';
    }
    if (/win/i.test(uaDataPlatform) || /^win/i.test(platform) || /windows/i.test(userAgent)) {
      return 'win';
    }
    if (/chrome os|cros/i.test(uaDataPlatform) || /cros/i.test(userAgent)) {
      return 'cros';
    }
    if (/android/i.test(uaDataPlatform) || /android/i.test(userAgent)) {
      return 'android';
    }
    if (/linux/i.test(uaDataPlatform) || /linux/i.test(platform) || /linux|x11/i.test(userAgent)) {
      return 'linux';
    }
    return 'unknown';
  }

  async function resolvePlatformOs() {
    const fallbackOs = detectPlatformFromNavigator();
    try {
      const info = await extBrowser?.runtime?.getPlatformInfo?.();
      if (info?.os) {
        return info.os;
      }
    } catch (err) {
      console.warn('[Better Portal] Failed to load platform info:', err);
    }
    return fallbackOs;
  }

  function applyShortcutPlatform(os) {
    const config = PLATFORM_SHORTCUTS[os] || PLATFORM_SHORTCUTS.unknown;
    if (shortcutModKey) {
      shortcutModKey.textContent = config.modKey;
    }
    if (shortcutOsLabel) {
      shortcutOsLabel.textContent = config.osLabel;
    }
    if (shortcutKbdGroup) {
      const label = config.osLabel ? `ショートカットキー (${config.osLabel})` : 'ショートカットキー';
      shortcutKbdGroup.setAttribute('aria-label', `${label}: ${config.modKey} + Shift + D`);
    }
  }

  async function loadSettings() {
    try {
      const res = await storageGet(['savedUsername', 'autoSubmit', 'autoFido2', 'autoPasswordTab', 'theme']);
      applyTheme(res?.theme || 'system');

      const username = res?.savedUsername || '';
      const autoSubmit = !!res?.autoSubmit;
      const autoFido2 = !!res?.autoFido2;
      const autoPasswordTab = !!res?.autoPasswordTab;

      if (usernameInput) usernameInput.value = username;
      if (autoSubmitToggle) autoSubmitToggle.checked = autoSubmit;
      if (autoFido2Toggle) autoFido2Toggle.checked = autoFido2;
      if (autoPasswordTabToggle) autoPasswordTabToggle.checked = autoPasswordTab;

      lastSavedState = { username, autoSubmit, autoFido2, autoPasswordTab };
      updateClearButton();
    } catch (err) {
      console.error('[Better Portal] Failed to load storage:', err);
      applyTheme('system');
    }
  }

  async function saveSettings(options = { showFeedback: true }) {
    if (debounceTimeout) {
      clearTimeout(debounceTimeout);
      debounceTimeout = null;
    }

    const username = usernameInput?.value.trim() || '';
    const autoSubmit = autoSubmitToggle?.checked ?? false;
    const autoFido2 = autoFido2Toggle?.checked ?? false;
    const autoPasswordTab = autoPasswordTabToggle?.checked ?? false;

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
      console.error('[Better Portal] Failed to save settings:', err);
      return;
    }

    if (options.showFeedback && isUsernameChanged) {
      showSaveFeedback();
    }
  }

  function triggerDebouncedSave() {
    updateClearButton();
    if (debounceTimeout) {
      clearTimeout(debounceTimeout);
    }
    debounceTimeout = setTimeout(() => {
      saveSettings({ showFeedback: true });
    }, DEBOUNCE_DELAY);
  }

  function handleExclusiveToggle(toggled, other) {
    if (toggled.checked && other?.checked) {
      other.checked = false;
      triggerOptionPulse(other);
    }
    saveSettings({ showFeedback: false });
    triggerOptionPulse(toggled);
  }

  // イベントリスナー登録
  usernameInput?.addEventListener('input', triggerDebouncedSave);

  usernameInput?.addEventListener('blur', () => {
    saveSettings({ showFeedback: true });
  });

  usernameInput?.addEventListener('keydown', (e) => {
    if (e.isComposing || e.keyCode === 229) return;
    if (e.key === 'Enter') {
      e.preventDefault();
      usernameInput.blur();
    }
  });

  clearBtn?.addEventListener('click', () => {
    if (!usernameInput) return;
    usernameInput.value = '';
    updateClearButton();
    saveSettings({ showFeedback: false });
    usernameInput.focus();
  });

  autoSubmitToggle?.addEventListener('change', () => {
    saveSettings({ showFeedback: false });
    triggerOptionPulse(autoSubmitToggle);
  });

  autoFido2Toggle?.addEventListener('change', () => {
    handleExclusiveToggle(autoFido2Toggle, autoPasswordTabToggle);
  });

  autoPasswordTabToggle?.addEventListener('change', () => {
    handleExclusiveToggle(autoPasswordTabToggle, autoFido2Toggle);
  });

  themeToggle?.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleThemeMenu();
  });

  themeMenuItems.forEach((item) => {
    item.addEventListener('click', async (e) => {
      e.stopPropagation();
      const val = item.getAttribute('data-theme-value');
      await setTheme(val);
      closeThemeMenu();
      themeToggle?.focus();
    });
  });

  themeChoices.forEach((choice) => {
    choice.addEventListener('click', async () => {
      const val = choice.getAttribute('data-theme-value');
      await setTheme(val);
    });
  });

  themeChoicesContainer?.addEventListener('keydown', async (e) => {
    const items = Array.from(themeChoices);
    if (!items.length) return;
    const currentIndex = items.indexOf(document.activeElement);
    if (currentIndex === -1) return;

    let nextIndex = -1;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
      nextIndex = (currentIndex + 1) % items.length;
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
      nextIndex = (currentIndex - 1 + items.length) % items.length;
    }

    if (nextIndex !== -1) {
      e.preventDefault();
      const nextChoice = items[nextIndex];
      nextChoice?.focus();
      const val = nextChoice?.getAttribute('data-theme-value');
      if (val) await setTheme(val);
    }
  });

  themeMenu?.addEventListener('keydown', (e) => {
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

  document.addEventListener('click', (e) => {
    if (themeMenu && !themeMenu.hasAttribute('hidden')) {
      if (!themeMenu.contains(e.target) && !themeToggle?.contains(e.target)) {
        closeThemeMenu();
      }
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && themeMenu && !themeMenu.hasAttribute('hidden')) {
      closeThemeMenu();
      themeToggle?.focus();
    }
  });

  themeMenu?.addEventListener('focusout', (e) => {
    if (!themeMenu.contains(e.relatedTarget) && e.relatedTarget !== themeToggle) {
      closeThemeMenu();
    }
  });

  window.matchMedia?.('(prefers-color-scheme: dark)')?.addEventListener?.('change', () => {
    if (currentThemeSetting === 'system') {
      applyTheme('system');
    }
  });

  // ポップアップ等での設定変更をリアルタイムに同期
  extBrowser?.storage?.onChanged?.addListener((changes) => {
    if (changes.theme) {
      applyTheme(changes.theme.newValue || 'system');
    }
    if (changes.savedUsername && usernameInput) {
      const nextUsername = changes.savedUsername.newValue || '';
      if (document.activeElement !== usernameInput) {
        usernameInput.value = nextUsername;
        lastSavedState.username = nextUsername;
        updateClearButton();
      }
    }
    if (changes.autoSubmit && autoSubmitToggle) {
      const nextVal = !!changes.autoSubmit.newValue;
      autoSubmitToggle.checked = nextVal;
      lastSavedState.autoSubmit = nextVal;
    }
    if (changes.autoFido2 && autoFido2Toggle) {
      const nextVal = !!changes.autoFido2.newValue;
      autoFido2Toggle.checked = nextVal;
      lastSavedState.autoFido2 = nextVal;
    }
    if (changes.autoPasswordTab && autoPasswordTabToggle) {
      const nextVal = !!changes.autoPasswordTab.newValue;
      autoPasswordTabToggle.checked = nextVal;
      lastSavedState.autoPasswordTab = nextVal;
    }
  });

  // 初期ロード
  renderVersion();
  applyShortcutPlatform(detectPlatformFromNavigator());
  await Promise.all([
    loadSettings(),
    resolvePlatformOs().then(applyShortcutPlatform)
  ]);
});
