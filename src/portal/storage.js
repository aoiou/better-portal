(() => {
  "use strict";

  const BP = (globalThis.BetterPortal = globalThis.BetterPortal || {});
  const { CONSTANTS, TOGGLE_CONFIG, UrlM365 } = BP;

  let preloadedPromise = null;
  let activeSavePromise = null;
  let queuedSnapshot = null;
  let lifecycleFlushBound = false;

  function cloneSettings(settings) {
    return {
      ...settings,
      hiddenIds: [...settings.hiddenIds],
      order: [...settings.order],
      readNoticeBlocks: [...settings.readNoticeBlocks],
      customCards: settings.customCards.map((card) => ({ ...card })),
    };
  }

  function getDefaultSettings() {
    return {
      hiddenIds: [],
      order: [],
      hideNavbar: false,
      hidePageTitle: false,
      hideSearchBar: false,
      hideSubNav: false,
      noticeToBottom: false,
      readNoticeBlocks: [],
      m365RedirectUrl: "",
      m365RedirectMethod: UrlM365.M365_REDIRECT_METHODS.DOMAIN_HINT,
      // オリジナルカード: { id, title, url, iconType: "default" | "emoji" | "url", iconValue }
      customCards: [],
    };
  }

  function normalizeSettings(raw) {
    const defaults = getDefaultSettings();
    if (!raw || typeof raw !== "object") return defaults;
    return {
      hiddenIds: Array.isArray(raw.hiddenIds)
        ? raw.hiddenIds.filter((id) => typeof id === "string")
        : defaults.hiddenIds,
      order: Array.isArray(raw.order)
        ? raw.order.filter((id) => typeof id === "string")
        : defaults.order,
      hideNavbar: Boolean(raw.hideNavbar),
      hidePageTitle: Boolean(raw.hidePageTitle),
      hideSearchBar: Boolean(raw.hideSearchBar),
      hideSubNav: Boolean(raw.hideSubNav),
      noticeToBottom: Boolean(raw.noticeToBottom),
      readNoticeBlocks: Array.isArray(raw.readNoticeBlocks)
        ? [...new Set(raw.readNoticeBlocks.filter((h) => typeof h === "string" && h.length > 0))]
        : defaults.readNoticeBlocks,
      m365RedirectUrl: typeof raw.m365RedirectUrl === "string"
        ? (UrlM365.normalizeUrl(raw.m365RedirectUrl) || "")
        : defaults.m365RedirectUrl,
      m365RedirectMethod: UrlM365.normalizeM365Method(
        raw.m365RedirectMethod,
        defaults.m365RedirectMethod
      ),
      customCards: Array.isArray(raw.customCards)
        ? raw.customCards
          .filter((c) => c && typeof c === "object" && typeof c.id === "string" && typeof c.title === "string")
          .map((c) => ({ ...c }))
        : defaults.customCards,
    };
  }

  /* =====================================================================
   * プリペイント描画ヒントキャッシュ (localStorage)
   * ===================================================================== */
  function readHintsCache() {
    try {
      const raw = localStorage.getItem(CONSTANTS.HINTS_CACHE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" ? parsed : null;
    } catch {
      return null;
    }
  }

  function writeHintsCache(hints) {
    try {
      localStorage.setItem(CONSTANTS.HINTS_CACHE_KEY, JSON.stringify(hints));
    } catch {
      // localStorage が無効な環境では無視
    }
  }

  function applyHintsToRoot(hints) {
    const root = document.documentElement;
    if (!root || !hints) return;
    for (const cfg of TOGGLE_CONFIG) {
      if (hints[cfg.hintKey]) root.setAttribute(cfg.hintAttr, "1");
      else root.removeAttribute(cfg.hintAttr);
    }
    if (hints.nc) root.setAttribute(CONSTANTS.HINT_ATTRS.NOTICE_COLLAPSED, "1");
    else root.removeAttribute(CONSTANTS.HINT_ATTRS.NOTICE_COLLAPSED);
  }

  const Hints = {
    applyFromCache() {
      applyHintsToRoot(readHintsCache());
    },

    sync(settings, noticeCollapsed) {
      const prev = readHintsCache() || {};
      const next = { ...prev };
      for (const cfg of TOGGLE_CONFIG) {
        next[cfg.hintKey] = Boolean(settings[cfg.key]);
      }
      if (typeof noticeCollapsed === "boolean") {
        next.nc = noticeCollapsed;
      }
      writeHintsCache(next);
      if (!document.body?.classList.contains(CONSTANTS.CLASSES.READY)) {
        applyHintsToRoot(next);
      }
    },

    setNoticeCollapsed(collapsed) {
      const prev = readHintsCache() || {};
      const next = { ...prev, nc: Boolean(collapsed) };
      writeHintsCache(next);
    },

    clearAttr(attrName) {
      document.documentElement?.removeAttribute(attrName);
    },

    clearTempAttrs() {
      const root = document.documentElement;
      if (!root) return;
      for (const attr of Object.values(CONSTANTS.HINT_ATTRS)) {
        root.removeAttribute(attr);
      }
    },
  };

  /* =====================================================================
   * 拡張機能ストレージ層 (sync + 安全な local フォールバック + 書込キュー)
   * ===================================================================== */
  async function storageGetRaw() {
    const key = CONSTANTS.STORAGE_KEY;
    const fallbackKey = CONSTANTS.LOCAL_FALLBACK_KEY;

    const [syncSettled, localSettled] = await Promise.allSettled([
      browser.storage.sync.get(key),
      browser.storage.local.get([key, fallbackKey]),
    ]);

    const syncResult = syncSettled.status === "fulfilled" ? syncSettled.value : null;
    const localResult = localSettled.status === "fulfilled" ? localSettled.value : null;

    if (localResult?.[fallbackKey] && localResult[key] !== undefined) {
      browser.storage.sync
        .set({ [key]: localResult[key] })
        .then(() => browser.storage.local.remove(fallbackKey).catch(() => {}))
        .catch(() => {});
      return localResult[key];
    }

    if (syncResult && syncResult[key] !== undefined) {
      return syncResult[key];
    }

    if (localResult && localResult[key] !== undefined) {
      browser.storage.sync.set({ [key]: localResult[key] }).catch(() => {});
      return localResult[key];
    }

    if (syncSettled.status === "rejected" && localSettled.status === "rejected") {
      throw syncSettled.reason;
    }

    return undefined;
  }

  async function storageSetRaw(payload) {
    const key = CONSTANTS.STORAGE_KEY;
    const fallbackKey = CONSTANTS.LOCAL_FALLBACK_KEY;
    try {
      await browser.storage.sync.set({ [key]: payload });
      await browser.storage.local.remove(fallbackKey).catch(() => {});
    } catch {
      await browser.storage.local.set({ [key]: payload, [fallbackKey]: true });
    }
  }

  function preloadSettings() {
    if (!preloadedPromise) {
      preloadedPromise = storageGetRaw()
        .then((raw) => normalizeSettings(raw))
        .catch((err) => {
          console.error("[Better Portal] Failed to load settings:", err);
          return getDefaultSettings();
        });
    }
    return preloadedPromise;
  }

  async function loadSettings() {
    return preloadSettings();
  }

  function bindLifecycleFlush() {
    if (lifecycleFlushBound) return;
    lifecycleFlushBound = true;
    window.addEventListener("pagehide", flushPendingSave);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") {
        flushPendingSave();
      }
    });
  }

  async function drainSaveQueue() {
    try {
      while (queuedSnapshot) {
        const snapshot = queuedSnapshot;
        queuedSnapshot = null;
        try {
          await storageSetRaw(snapshot);
        } catch (err) {
          console.error("[Better Portal] Failed to save settings:", err);
        }
      }
    } finally {
      activeSavePromise = null;
    }
  }

  function saveSettings(settings, { noticeCollapsed } = {}) {
    bindLifecycleFlush();
    Hints.sync(settings, noticeCollapsed);
    queuedSnapshot = cloneSettings(settings);
    if (!activeSavePromise) {
      activeSavePromise = drainSaveQueue();
    }
    return activeSavePromise;
  }

  function flushPendingSave() {
    if (queuedSnapshot && !activeSavePromise) {
      activeSavePromise = drainSaveQueue();
    }
    return activeSavePromise;
  }

  BP.Storage = {
    Hints,
    getDefaultSettings,
    normalizeSettings,
    preloadSettings,
    loadSettings,
    saveSettings,
    flushPendingSave,
    resetPreloadForTest() {
      preloadedPromise = null;
      activeSavePromise = null;
      queuedSnapshot = null;
    },
  };
})();
