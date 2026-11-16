const LOGIN_URL = 'https://doshisha.ex-tic.com/auth/session';
const WELCOME_PAGE_PATH = 'welcome/index.html';

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
  if (command === 'open-login-page') {
    browser.tabs.create({ url: LOGIN_URL });
  }
});
