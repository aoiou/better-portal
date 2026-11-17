const PORTAL_URL = 'https://doshisha.ex-tic.com/idm/user/portal/';
const PORTAL_URL_MATCH = 'https://doshisha.ex-tic.com/idm/user/portal/*';
const WELCOME_PAGE_PATH = 'welcome/index.html';
const OPEN_PORTAL_COMMAND = 'open-portal-page';
const OPEN_PORTAL_MESSAGE_TYPE = 'bp-open-portal';

/**
 * 現在のアクティブタブの incognito 状態を返す（判定できない場合は null）。
 */
async function getCurrentIncognitoState() {
  try {
    const activeTabs = await browser.tabs.query({ active: true, currentWindow: true });
    const currentTab = activeTabs?.[0];
    return typeof currentTab?.incognito === 'boolean' ? currentTab.incognito : null;
  } catch {
    return null;
  }
}

/**
 * 候補タブ群から有効なポータルタブのみを抽出し、incognito 境界を一致させる。
 */
function filterMatchingPortalTabs(tabs, currentIncognito) {
  return (tabs || []).filter((tab) => {
    if (typeof tab?.id !== 'number') return false;
    const effectiveUrl = tab.pendingUrl || tab.url;
    if (typeof effectiveUrl !== 'string' || !effectiveUrl.startsWith(PORTAL_URL)) return false;
    if (typeof currentIncognito === 'boolean' && typeof tab.incognito === 'boolean') {
      return tab.incognito === currentIncognito;
    }
    return true;
  });
}

/**
 * 複数のポータルタブから優先して遷移する 1 つを選ぶ。
 */
function pickBestPortalTab(tabs) {
  if (!Array.isArray(tabs) || tabs.length === 0) return null;
  return [...tabs].sort((a, b) => {
    const timeDiff = (b.lastAccessed ?? 0) - (a.lastAccessed ?? 0);
    if (timeDiff !== 0) return timeDiff;
    const activeDiff = (b.active ? 1 : 0) - (a.active ? 1 : 0);
    if (activeDiff !== 0) return activeDiff;
    return (a.index ?? 0) - (b.index ?? 0);
  })[0];
}

/**
 * 既存のポータルタブへ移動し、見つからない・失敗した場合は新規タブで開く。
 */
async function openOrFocusPortal() {
  try {
    const currentIncognito = await getCurrentIncognitoState();

    const currentRawTabs = await browser.tabs.query({ url: PORTAL_URL_MATCH, currentWindow: true });
    const currentTabs = filterMatchingPortalTabs(currentRawTabs, currentIncognito);

    const activePortalTab = currentTabs.find((tab) => tab.active);
    if (activePortalTab) {
      return { action: 'noop', tab: activePortalTab };
    }

    const sameWindowTarget = pickBestPortalTab(currentTabs);
    if (sameWindowTarget) {
      await browser.tabs.update(sameWindowTarget.id, { active: true });
      return { action: 'focused', tab: sameWindowTarget };
    }

    const allRawTabs = await browser.tabs.query({ url: PORTAL_URL_MATCH });
    const allTabs = filterMatchingPortalTabs(allRawTabs, currentIncognito);
    const crossWindowTarget = pickBestPortalTab(allTabs);
    if (crossWindowTarget) {
      await browser.tabs.update(crossWindowTarget.id, { active: true });
      if (typeof crossWindowTarget.windowId === 'number' && browser.windows?.update) {
        await browser.windows.update(crossWindowTarget.windowId, { focused: true });
      }
      return { action: 'focused', tab: crossWindowTarget };
    }
  } catch (err) {
    console.warn('[Better Portal] Failed to focus existing portal tab, falling back to new tab:', err);
  }

  const createdTab = await browser.tabs.create({ url: PORTAL_URL });
  return { action: 'created', tab: createdTab };
}

// 初回インストール時のみ初心者向けウェルカムページを開く
browser.runtime.onInstalled.addListener((details) => {
  if (details?.reason === 'install') {
    const url = browser.runtime.getURL(WELCOME_PAGE_PATH);
    Promise.resolve(browser.tabs.create({ url })).catch((err) => {
      console.error('[Better Portal] Failed to open welcome page:', err);
    });
  }
});

// ショートカットキー押下時のハンドラ
browser.commands.onCommand.addListener((command) => {
  if (command === OPEN_PORTAL_COMMAND) {
    openOrFocusPortal().catch((err) => {
      console.error('[Better Portal] Failed to open or focus portal:', err);
    });
  }
});

// ポップアップ等からのポータル移動リクエスト
browser.runtime.onMessage?.addListener?.((message) => {
  if (message?.type !== OPEN_PORTAL_MESSAGE_TYPE) return undefined;
  return openOrFocusPortal();
});
