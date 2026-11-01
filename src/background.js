const LOGIN_URL = 'https://doshisha.ex-tic.com/auth/session';

// ショートカットキー押下時のハンドラ
browser.commands.onCommand.addListener((command) => {
  if (command === 'open-login-page') {
    browser.tabs.create({ url: LOGIN_URL });
  }
});
