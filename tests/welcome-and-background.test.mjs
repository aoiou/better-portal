import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { SRC_DIR } from "./helpers/test-helpers.mjs";

function flushMicrotasks() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function loadBackgroundEnv({
  failTabsCreate = false,
  failTabsQuery = false,
  failTabsUpdate = false,
  tabs = [],
  currentWindowId = 1,
} = {}) {
  const installedListeners = [];
  const commandListeners = [];
  const messageListeners = [];
  const createdTabs = [];
  const updatedTabs = [];
  const updatedWindows = [];
  const queryCalls = [];

  const matchesPattern = (url, pattern) => {
    if (!pattern) return true;
    if (pattern.endsWith("*")) {
      return typeof url === "string" && url.startsWith(pattern.slice(0, -1));
    }
    return url === pattern;
  };

  const browserMock = {
    runtime: {
      getURL(relPath) {
        return `extension://unit-test/${relPath}`;
      },
      onInstalled: {
        addListener(fn) {
          installedListeners.push(fn);
        },
      },
      onMessage: {
        addListener(fn) {
          messageListeners.push(fn);
        },
      },
    },
    commands: {
      onCommand: {
        addListener(fn) {
          commandListeners.push(fn);
        },
      },
    },
    tabs: {
      async query(queryInfo = {}) {
        queryCalls.push(queryInfo);
        if (failTabsQuery && queryInfo.url) {
          throw new Error("tabs.query failed");
        }
        return tabs
          .filter((tab) => {
            if (queryInfo.currentWindow && tab.windowId !== currentWindowId) return false;
            if (queryInfo.active !== undefined && Boolean(tab.active) !== Boolean(queryInfo.active)) {
              return false;
            }
            if (queryInfo.url) {
              const effectiveUrl = tab.pendingUrl || tab.url;
              if (!matchesPattern(effectiveUrl, queryInfo.url)) return false;
            }
            return true;
          })
          .map((tab) => ({ ...tab }));
      },
      async update(tabId, updateProperties) {
        updatedTabs.push({ tabId, ...updateProperties });
        if (failTabsUpdate) {
          throw new Error("tabs.update failed");
        }
        const target = tabs.find((t) => t.id === tabId);
        if (!target) throw new Error(`Tab not found: ${tabId}`);
        Object.assign(target, updateProperties);
        return { ...target };
      },
      create(opts) {
        createdTabs.push(opts);
        if (failTabsCreate) {
          return Promise.reject(new Error("tab creation failed"));
        }
        return Promise.resolve({ id: 100 + createdTabs.length, ...opts });
      },
    },
    windows: {
      async update(windowId, updateInfo) {
        updatedWindows.push({ windowId, ...updateInfo });
        return { id: windowId, ...updateInfo };
      },
    },
  };

  const context = vm.createContext({
    browser: browserMock,
    console: { log() {}, warn() {}, error() {} },
    Promise,
  });

  const code = fs.readFileSync(path.join(SRC_DIR, "background.js"), "utf8");
  vm.runInContext(code, context, { filename: "src/background.js" });

  return {
    installedListeners,
    commandListeners,
    messageListeners,
    createdTabs,
    updatedTabs,
    updatedWindows,
    queryCalls,
  };
}

function createFakeNode(tagName, id = "") {
  const attrs = new Map();
  const classes = new Set();
  const listeners = new Map();

  const node = {
    tagName: tagName.toUpperCase(),
    id,
    value: "",
    checked: false,
    title: "",
    textContent: "",
    _doc: null,
    _children: [],
    _parent: null,
    classList: {
      add: (...names) => names.forEach((n) => classes.add(n)),
      remove: (...names) => names.forEach((n) => classes.delete(n)),
      toggle: (name, force) => {
        const shouldAdd = force === undefined ? !classes.has(name) : Boolean(force);
        if (shouldAdd) classes.add(name);
        else classes.delete(name);
        return shouldAdd;
      },
      contains: (name) => classes.has(name),
    },
    setAttribute(name, value) {
      attrs.set(name, String(value));
    },
    getAttribute(name) {
      return attrs.has(name) ? attrs.get(name) : null;
    },
    hasAttribute(name) {
      return attrs.has(name);
    },
    removeAttribute(name) {
      attrs.delete(name);
    },
    addEventListener(type, fn) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(fn);
    },
    dispatchEvent(event) {
      const ev = {
        preventDefault() {},
        stopPropagation() {},
        target: node,
        ...event,
      };
      for (const fn of listeners.get(ev.type) || []) {
        fn.call(node, ev);
      }
    },
    focus() {
      if (node._doc) node._doc.activeElement = node;
    },
    blur() {
      if (node._doc && node._doc.activeElement === node) {
        node._doc.activeElement = node._doc.body;
      }
      node.dispatchEvent({ type: "blur" });
    },
    closest(selector) {
      if (selector === ".option-item") {
        return node._optionItem || null;
      }
      return null;
    },
    contains(other) {
      if (other === node) return true;
      return node._children.includes(other);
    },
    querySelector(selector) {
      if (selector === ".theme-menu-item.active") {
        return node._children.find((c) => c.classList.contains("active")) || null;
      }
      if (selector === ".theme-menu-item") {
        return node._children[0] || null;
      }
      return null;
    },
    offsetWidth: 100,
  };
  return node;
}

async function createWelcomeTestEnv({
  syncInitial = {},
  localInitial = {},
  failSync = false,
  prefersDark = false,
  manifestVersion = "1.6.1",
  platformOs = undefined,
  failPlatformInfo = false,
  navigatorMock = undefined,
} = {}) {
  const syncStore = new Map(Object.entries(syncInitial));
  const localStore = new Map(Object.entries(localInitial));
  const onChangedListeners = [];
  const docListeners = new Map();
  const mediaListeners = [];

  let isPrefersDark = prefersDark;

  const doc = {
    activeElement: null,
    body: createFakeNode("body"),
    documentElement: createFakeNode("html"),
    addEventListener(type, fn) {
      if (!docListeners.has(type)) docListeners.set(type, []);
      docListeners.get(type).push(fn);
    },
    dispatchEvent(event) {
      const ev = { preventDefault() {}, stopPropagation() {}, ...event };
      for (const fn of docListeners.get(ev.type) || []) {
        fn.call(doc, ev);
      }
    },
  };
  doc.activeElement = doc.body;

  const elementsById = new Map();
  const register = (id, tag = "div") => {
    const el = createFakeNode(tag, id);
    el._doc = doc;
    elementsById.set(id, el);
    return el;
  };

  const usernameInput = register("username-input", "input");
  const clearBtn = register("clear-btn", "button");
  const saveIndicator = register("save-indicator", "span");
  const autoSubmitToggle = register("auto-submit-toggle", "input");
  autoSubmitToggle._optionItem = createFakeNode("div");
  const autoFido2Toggle = register("auto-fido2-toggle", "input");
  autoFido2Toggle._optionItem = createFakeNode("div");
  const autoPasswordTabToggle = register("auto-password-tab-toggle", "input");
  autoPasswordTabToggle._optionItem = createFakeNode("div");
  const themeToggle = register("theme-toggle", "button");
  const themeMenu = register("theme-menu", "div");
  themeMenu.setAttribute("hidden", "");
  const themeChoicesContainer = register("theme-choices", "div");
  const versionText = register("version-text", "span");
  const shortcutOsLabel = register("shortcut-os-label", "span");
  const shortcutModKey = register("shortcut-mod-key", "kbd");
  const shortcutKbdGroup = register("shortcut-kbd-group", "span");
  const faqFido2 = register("faq-fido2", "details");
  faqFido2.open = false;
  faqFido2.scrollIntoView = () => {
    faqFido2._scrolled = true;
  };
  const faqFido2Summary = createFakeNode("summary");
  faqFido2Summary._doc = doc;
  faqFido2._children.push(faqFido2Summary);
  faqFido2.querySelector = (sel) => (sel === "summary" ? faqFido2Summary : null);

  const faqJumpLink = createFakeNode("a");
  faqJumpLink._doc = doc;
  faqJumpLink.setAttribute("data-open-faq", "faq-fido2");

  const makeThemeButtons = (parent) =>
    ["system", "light", "dark"].map((val) => {
      const item = createFakeNode("button");
      item._doc = doc;
      item.setAttribute("data-theme-value", val);
      item.setAttribute("aria-checked", "false");
      parent._children.push(item);
      return item;
    });

  const themeMenuItems = makeThemeButtons(themeMenu);
  const themeChoices = makeThemeButtons(themeChoicesContainer);

  doc.getElementById = (id) => elementsById.get(id) || null;
  doc.querySelectorAll = (sel) => {
    if (sel === ".theme-menu-item") return themeMenuItems;
    if (sel === ".theme-choice") return themeChoices;
    if (sel === "[data-open-faq]") return [faqJumpLink];
    return [];
  };

  const makeArea = (store, shouldFail) => ({
    async get(keys) {
      if (shouldFail) throw new Error("storage.sync unavailable");
      const keyList = Array.isArray(keys) ? keys : [keys];
      const out = {};
      for (const k of keyList) {
        if (store.has(k)) out[k] = store.get(k);
      }
      return out;
    },
    async set(data) {
      if (shouldFail) throw new Error("storage.sync unavailable");
      const changes = {};
      for (const [k, v] of Object.entries(data)) {
        const oldValue = store.get(k);
        store.set(k, v);
        changes[k] = { oldValue, newValue: v };
      }
      for (const fn of onChangedListeners) fn(changes);
    },
  });

  const browserMock = {
    runtime: {
      getManifest: () => ({ version: manifestVersion }),
      getPlatformInfo:
        platformOs !== undefined || failPlatformInfo
          ? async () => {
              if (failPlatformInfo) throw new Error("getPlatformInfo failed");
              return { os: platformOs };
            }
          : undefined,
    },
    storage: {
      sync: makeArea(syncStore, failSync),
      local: makeArea(localStore, false),
      onChanged: {
        addListener(fn) {
          onChangedListeners.push(fn);
        },
      },
    },
  };

  const windowObj = {
    matchMedia(query) {
      return {
        media: query,
        get matches() {
          return isPrefersDark;
        },
        addEventListener(type, fn) {
          if (type === "change") mediaListeners.push(fn);
        },
      };
    },
  };

  const context = vm.createContext({
    document: doc,
    window: windowObj,
    browser: browserMock,
    navigator: navigatorMock,
    console,
    setTimeout,
    clearTimeout,
    Promise,
    Array,
    Object,
  });

  const code = fs.readFileSync(path.join(SRC_DIR, "welcome/index.js"), "utf8");
  vm.runInContext(code, context, { filename: "src/welcome/index.js" });

  doc.dispatchEvent({ type: "DOMContentLoaded" });
  await flushMicrotasks();

  return {
    doc,
    syncStore,
    localStore,
    onChangedListeners,
    elements: {
      usernameInput,
      clearBtn,
      saveIndicator,
      autoSubmitToggle,
      autoFido2Toggle,
      autoPasswordTabToggle,
      themeToggle,
      themeMenu,
      themeMenuItems,
      themeChoicesContainer,
      themeChoices,
      versionText,
      shortcutOsLabel,
      shortcutModKey,
      shortcutKbdGroup,
      faqFido2,
      faqFido2Summary,
      faqJumpLink,
    },
    setOsDark(dark) {
      isPrefersDark = dark;
      for (const fn of mediaListeners) fn({ matches: dark });
    },
  };
}

test("background.js opens welcome page only on fresh install and routes open-portal-page / message to existing or new portal tab", async () => {
  const PORTAL_URL = "https://doshisha.ex-tic.com/idm/user/portal/";

  // 1. 初回インストールのみウェルカムを開き、ポータル未開時は新規タブを作成
  const freshEnv = loadBackgroundEnv({
    currentWindowId: 1,
    tabs: [{ id: 10, windowId: 1, active: true, incognito: false, url: "https://example.com/" }],
  });

  assert.equal(freshEnv.installedListeners.length, 1);
  assert.equal(freshEnv.commandListeners.length, 1);
  assert.equal(freshEnv.messageListeners.length, 1);

  freshEnv.installedListeners[0]({ reason: "update" });
  freshEnv.installedListeners[0]({ reason: "browser_update" });
  assert.equal(freshEnv.createdTabs.length, 0);

  freshEnv.installedListeners[0]({ reason: "install" });
  assert.equal(freshEnv.createdTabs.length, 1);
  assert.equal(freshEnv.createdTabs[0].url, "extension://unit-test/welcome/index.html");

  freshEnv.commandListeners[0]("open-portal-page");
  await flushMicrotasks();
  assert.equal(freshEnv.createdTabs.length, 2);
  assert.equal(freshEnv.createdTabs[1].url, PORTAL_URL);
  assert.equal(freshEnv.updatedTabs.length, 0);

  // 2. 現在のアクティブタブがすでにポータルなら何もしない
  const alreadyPortalEnv = loadBackgroundEnv({
    currentWindowId: 1,
    tabs: [{ id: 1, windowId: 1, active: true, incognito: false, url: PORTAL_URL }],
  });
  alreadyPortalEnv.commandListeners[0]("open-portal-page");
  await flushMicrotasks();
  assert.equal(alreadyPortalEnv.updatedTabs.length, 0);
  assert.equal(alreadyPortalEnv.updatedWindows.length, 0);
  assert.equal(alreadyPortalEnv.createdTabs.length, 0);

  // 3. 現在ウィンドウ内のバックグラウンドタブ（lastAccessed最新）を優先し、他ウィンドウより優先
  const sameWindowEnv = loadBackgroundEnv({
    currentWindowId: 1,
    tabs: [
      { id: 1, windowId: 1, active: true, incognito: false, url: "https://example.com/" },
      { id: 2, windowId: 1, active: false, incognito: false, index: 1, lastAccessed: 100, url: PORTAL_URL },
      { id: 3, windowId: 1, active: false, incognito: false, index: 2, lastAccessed: 500, url: `${PORTAL_URL}#notices` },
      { id: 4, windowId: 2, active: true, incognito: false, lastAccessed: 999, url: PORTAL_URL },
    ],
  });
  sameWindowEnv.commandListeners[0]("open-portal-page");
  await flushMicrotasks();
  assert.deepEqual(sameWindowEnv.updatedTabs, [{ tabId: 3, active: true }]);
  assert.equal(sameWindowEnv.updatedWindows.length, 0);
  assert.equal(sameWindowEnv.createdTabs.length, 0);

  // 4. 別ウィンドウにのみ同 incognito のポータルがある場合はウィンドウごと前面化（incognito違いは越境しない）
  const crossWindowEnv = loadBackgroundEnv({
    currentWindowId: 1,
    tabs: [
      { id: 1, windowId: 1, active: true, incognito: false, url: "https://example.com/" },
      { id: 2, windowId: 2, active: true, incognito: true, lastAccessed: 999, url: PORTAL_URL },
      { id: 3, windowId: 3, active: true, incognito: false, lastAccessed: 300, url: PORTAL_URL },
    ],
  });
  const msgResult = await crossWindowEnv.messageListeners[0]({ type: "bp-open-portal" });
  assert.equal(msgResult.action, "focused");
  assert.deepEqual(crossWindowEnv.updatedTabs, [{ tabId: 3, active: true }]);
  assert.deepEqual(crossWindowEnv.updatedWindows, [{ windowId: 3, focused: true }]);
  assert.equal(crossWindowEnv.createdTabs.length, 0);
  assert.equal(crossWindowEnv.messageListeners[0]({ type: "unrelated" }), undefined);

  // 5. incognito ウィンドウからは通常ウィンドウのポータルタブへ越境せず新規タブを開く
  const incognitoIsolationEnv = loadBackgroundEnv({
    currentWindowId: 2,
    tabs: [
      { id: 1, windowId: 1, active: true, incognito: false, url: PORTAL_URL },
      { id: 2, windowId: 2, active: true, incognito: true, url: "https://example.com/" },
    ],
  });
  incognitoIsolationEnv.commandListeners[0]("open-portal-page");
  await flushMicrotasks();
  assert.equal(incognitoIsolationEnv.updatedTabs.length, 0);
  assert.equal(incognitoIsolationEnv.createdTabs.length, 1);
  assert.equal(incognitoIsolationEnv.createdTabs[0].url, PORTAL_URL);

  // 6. tabs.query / tabs.update が失敗しても新規タブ作成へ安全にフォールバックする
  const queryFailEnv = loadBackgroundEnv({ failTabsQuery: true });
  queryFailEnv.commandListeners[0]("open-portal-page");
  await flushMicrotasks();
  assert.equal(queryFailEnv.createdTabs.length, 1);
  assert.equal(queryFailEnv.createdTabs[0].url, PORTAL_URL);

  const updateFailEnv = loadBackgroundEnv({
    failTabsUpdate: true,
    currentWindowId: 1,
    tabs: [
      { id: 1, windowId: 1, active: true, incognito: false, url: "https://example.com/" },
      { id: 2, windowId: 1, active: false, incognito: false, url: PORTAL_URL },
    ],
  });
  updateFailEnv.commandListeners[0]("open-portal-page");
  await flushMicrotasks();
  assert.equal(updateFailEnv.createdTabs.length, 1);
  assert.equal(updateFailEnv.createdTabs[0].url, PORTAL_URL);

  // 7. onInstalled の tabs.create 失敗時も未処理拒否にならない
  const failingEnv = loadBackgroundEnv({ failTabsCreate: true });
  failingEnv.installedListeners[0]({ reason: "install" });
  await flushMicrotasks();
  assert.equal(failingEnv.createdTabs.length, 1);
});

test("popup/index.js routes target-domain-link click through background message with new-tab fallback and closes popup", async () => {
  const createPopupEnv = ({ failSendMessage = false } = {}) => {
    const docListeners = new Map();
    const sentMessages = [];
    const createdTabs = [];
    let closedCount = 0;

    const doc = {
      activeElement: null,
      body: createFakeNode("body"),
      documentElement: createFakeNode("html"),
      addEventListener(type, fn) {
        if (!docListeners.has(type)) docListeners.set(type, []);
        docListeners.get(type).push(fn);
      },
      dispatchEvent(event) {
        const ev = { preventDefault() {}, stopPropagation() {}, ...event };
        for (const fn of docListeners.get(ev.type) || []) fn.call(doc, ev);
      },
    };
    doc.activeElement = doc.body;

    const elementsById = new Map();
    const register = (id, tag = "div") => {
      const el = createFakeNode(tag, id);
      el._doc = doc;
      elementsById.set(id, el);
      return el;
    };

    const usernameInput = register("username-input", "input");
    const clearBtn = register("clear-btn", "button");
    const saveIndicator = register("save-indicator", "span");
    register("auto-submit-toggle", "input");
    register("auto-fido2-toggle", "input");
    register("auto-password-tab-toggle", "input");
    register("theme-toggle", "button");
    const themeMenu = register("theme-menu", "div");
    themeMenu.setAttribute("hidden", "");
    const targetDomainLink = register("target-domain-link", "a");
    register("version-text", "span");

    doc.getElementById = (id) => elementsById.get(id) || null;
    doc.querySelectorAll = () => [];

    const browserMock = {
      runtime: {
        getManifest: () => ({ version: "1.7.0" }),
        async sendMessage(msg) {
          sentMessages.push(msg);
          if (failSendMessage) throw new Error("background unavailable");
          return { action: "focused" };
        },
      },
      storage: {
        sync: { async get() { return {}; }, async set() {} },
        local: { async get() { return {}; }, async set() {} },
      },
      tabs: {
        async create(opts) {
          createdTabs.push(opts);
          return { id: createdTabs.length, ...opts };
        },
      },
    };

    const windowObj = {
      close() {
        closedCount += 1;
      },
      matchMedia: () => ({ matches: false, addEventListener() {} }),
    };

    const context = vm.createContext({
      document: doc,
      window: windowObj,
      browser: browserMock,
      console: { log() {}, warn() {}, error() {} },
      setTimeout,
      clearTimeout,
      Promise,
      Array,
      Object,
    });

    const code = fs.readFileSync(path.join(SRC_DIR, "popup/index.js"), "utf8");
    vm.runInContext(code, context, { filename: "src/popup/index.js" });

    return {
      doc,
      targetDomainLink,
      sentMessages,
      createdTabs,
      getClosedCount: () => closedCount,
    };
  };

  const normalEnv = createPopupEnv();
  normalEnv.doc.dispatchEvent({ type: "DOMContentLoaded" });
  await flushMicrotasks();

  normalEnv.targetDomainLink.dispatchEvent({ type: "click" });
  await flushMicrotasks();
  assert.equal(normalEnv.sentMessages.length, 1);
  assert.equal(normalEnv.sentMessages[0].type, "bp-open-portal");
  assert.equal(normalEnv.createdTabs.length, 0);
  assert.equal(normalEnv.getClosedCount(), 1);

  const fallbackEnv = createPopupEnv({ failSendMessage: true });
  fallbackEnv.doc.dispatchEvent({ type: "DOMContentLoaded" });
  await flushMicrotasks();

  fallbackEnv.targetDomainLink.dispatchEvent({ type: "click" });
  await flushMicrotasks();
  assert.equal(fallbackEnv.sentMessages.length, 1);
  assert.equal(fallbackEnv.createdTabs.length, 1);
  assert.equal(fallbackEnv.createdTabs[0].url, "https://doshisha.ex-tic.com/idm/user/portal/");
  assert.equal(fallbackEnv.getClosedCount(), 1);

  const popupHtml = fs.readFileSync(path.join(SRC_DIR, "popup/index.html"), "utf8");
  assert.match(popupHtml, /href="https:\/\/doshisha\.ex-tic\.com\/idm\/user\/portal\/"[^>]*id="target-domain-link"/);
});

test("welcome/index.js loads initial settings, supports local fallback, and renders manifest version", async () => {
  const env = await createWelcomeTestEnv({
    failSync: true,
    localInitial: {
      savedUsername: "student01",
      autoSubmit: true,
      autoFido2: true,
      autoPasswordTab: false,
      theme: "dark",
    },
  });

  const { elements, doc } = env;
  assert.equal(elements.versionText.textContent, "v1.6.1");
  assert.equal(elements.usernameInput.value, "student01");
  assert.equal(elements.clearBtn.classList.contains("visible"), true);
  assert.equal(elements.autoSubmitToggle.checked, true);
  assert.equal(elements.autoFido2Toggle.checked, true);
  assert.equal(elements.autoPasswordTabToggle.checked, false);
  assert.equal(doc.documentElement.getAttribute("data-theme"), "dark");
  assert.equal(doc.documentElement.getAttribute("data-theme-setting"), "dark");
  assert.equal(elements.themeMenuItems[2].getAttribute("aria-checked"), "true");
});

test("welcome/index.js saves username, handles IME/clear, enforces FIDO2 exclusion, and syncs storage changes", async () => {
  const env = await createWelcomeTestEnv({
    prefersDark: false,
    syncInitial: {
      savedUsername: "",
      autoSubmit: false,
      autoFido2: false,
      autoPasswordTab: false,
      theme: "system",
    },
  });

  const { elements, syncStore, doc, onChangedListeners, setOsDark } = env;

  // IME確定中の Enter は無視される
  elements.usernameInput.focus();
  elements.usernameInput.value = "  doshisha123  ";
  elements.usernameInput.dispatchEvent({ type: "keydown", key: "Enter", isComposing: true });
  await flushMicrotasks();
  assert.equal(syncStore.get("savedUsername"), "");

  // 通常の Enter → blur でトリム済みユーザー名を保存しフィードバックを表示
  elements.usernameInput.dispatchEvent({ type: "keydown", key: "Enter", isComposing: false });
  await flushMicrotasks();
  assert.equal(syncStore.get("savedUsername"), "doshisha123");
  assert.equal(elements.usernameInput.classList.contains("is-saved"), true);
  assert.equal(elements.saveIndicator.classList.contains("visible"), true);

  // クリアボタンで空保存
  elements.clearBtn.dispatchEvent({ type: "click" });
  await flushMicrotasks();
  assert.equal(elements.usernameInput.value, "");
  assert.equal(syncStore.get("savedUsername"), "");
  assert.equal(elements.clearBtn.classList.contains("visible"), false);

  // FIDO2 と パスワードタブの排他制御
  elements.autoFido2Toggle.checked = true;
  elements.autoFido2Toggle.dispatchEvent({ type: "change" });
  await flushMicrotasks();
  assert.equal(syncStore.get("autoFido2"), true);
  assert.equal(syncStore.get("autoPasswordTab"), false);

  elements.autoPasswordTabToggle.checked = true;
  elements.autoPasswordTabToggle.dispatchEvent({ type: "change" });
  await flushMicrotasks();
  assert.equal(elements.autoFido2Toggle.checked, false);
  assert.equal(syncStore.get("autoFido2"), false);
  assert.equal(syncStore.get("autoPasswordTab"), true);

  // システムテーマ時に OS のテーマ変化へ追従する
  assert.equal(doc.documentElement.getAttribute("data-theme"), "light");
  setOsDark(true);
  assert.equal(doc.documentElement.getAttribute("data-theme"), "dark");

  // テーマメニューで明示選択し永続化・初期設定内のテーマ選択肢とも同期
  elements.themeToggle.dispatchEvent({ type: "click" });
  assert.equal(elements.themeMenu.hasAttribute("hidden"), false);
  elements.themeMenuItems[1].dispatchEvent({ type: "click" });
  await flushMicrotasks();
  assert.equal(syncStore.get("theme"), "light");
  assert.equal(doc.documentElement.getAttribute("data-theme"), "light");
  assert.equal(elements.themeMenu.hasAttribute("hidden"), true);
  assert.equal(elements.themeChoices[1].classList.contains("active"), true);
  assert.equal(elements.themeChoices[1].getAttribute("aria-checked"), "true");

  // 初期設定内のテーマ選択肢クリックでも保存・メニュー同期
  elements.themeChoices[2].dispatchEvent({ type: "click" });
  await flushMicrotasks();
  assert.equal(syncStore.get("theme"), "dark");
  assert.equal(doc.documentElement.getAttribute("data-theme"), "dark");
  assert.equal(elements.themeChoices[2].getAttribute("aria-checked"), "true");
  assert.equal(elements.themeMenuItems[2].getAttribute("aria-checked"), "true");

  // 矢印キーでのテーマ切り替え
  elements.themeChoices[2].focus();
  elements.themeChoicesContainer.dispatchEvent({ type: "keydown", key: "ArrowRight" });
  await flushMicrotasks();
  assert.equal(syncStore.get("theme"), "system");
  assert.equal(elements.themeChoices[0].getAttribute("aria-checked"), "true");

  // 初期設定内の FAQ リンククリックで対象アコーディオンを開いてフォーカス・スクロール
  elements.faqJumpLink.dispatchEvent({ type: "click" });
  assert.equal(elements.faqFido2.open, true);
  assert.equal(elements.faqFido2.hasAttribute("open"), true);
  assert.equal(elements.faqFido2._scrolled, true);
  assert.equal(elements.faqFido2.classList.contains("faq-highlight"), true);
  assert.equal(doc.activeElement, elements.faqFido2Summary);

  // 外部（ポップアップ等）からの storage.onChanged 同期
  doc.activeElement = doc.body;
  for (const fn of onChangedListeners) {
    fn({
      savedUsername: { newValue: "popup_user" },
      autoSubmit: { newValue: true },
      theme: { newValue: "dark" },
    });
  }
  assert.equal(elements.usernameInput.value, "popup_user");
  assert.equal(elements.autoSubmitToggle.checked, true);
  assert.equal(doc.documentElement.getAttribute("data-theme"), "dark");

  // 編集中（フォーカス中）は savedUsername の外部変更で入力値を上書きしない
  elements.usernameInput.focus();
  elements.usernameInput.value = "typing_now";
  for (const fn of onChangedListeners) {
    fn({ savedUsername: { newValue: "other_user" } });
  }
  assert.equal(elements.usernameInput.value, "typing_now");
});

test("welcome/index.js displays only the installed OS shortcut key via getPlatformInfo and navigator fallback", async () => {
  const macEnv = await createWelcomeTestEnv({
    platformOs: "mac",
    navigatorMock: { platform: "Win32", userAgent: "Windows" },
  });
  assert.equal(macEnv.elements.shortcutModKey.textContent, "Option");
  assert.equal(macEnv.elements.shortcutOsLabel.textContent, "Mac");
  assert.equal(
    macEnv.elements.shortcutKbdGroup.getAttribute("aria-label"),
    "ショートカットキー (Mac): Option + Shift + D"
  );

  const winEnv = await createWelcomeTestEnv({ platformOs: "win" });
  assert.equal(winEnv.elements.shortcutModKey.textContent, "Alt");
  assert.equal(winEnv.elements.shortcutOsLabel.textContent, "Windows");
  assert.equal(
    winEnv.elements.shortcutKbdGroup.getAttribute("aria-label"),
    "ショートカットキー (Windows): Alt + Shift + D"
  );

  const linuxEnv = await createWelcomeTestEnv({ platformOs: "linux" });
  assert.equal(linuxEnv.elements.shortcutModKey.textContent, "Alt");
  assert.equal(linuxEnv.elements.shortcutOsLabel.textContent, "Linux");

  const crosEnv = await createWelcomeTestEnv({ platformOs: "cros" });
  assert.equal(crosEnv.elements.shortcutModKey.textContent, "Alt");
  assert.equal(crosEnv.elements.shortcutOsLabel.textContent, "ChromeOS");

  const navMacFallbackEnv = await createWelcomeTestEnv({
    failPlatformInfo: true,
    navigatorMock: { platform: "MacIntel", userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X)" },
  });
  assert.equal(navMacFallbackEnv.elements.shortcutModKey.textContent, "Option");
  assert.equal(navMacFallbackEnv.elements.shortcutOsLabel.textContent, "Mac");

  const navAndroidFallbackEnv = await createWelcomeTestEnv({
    navigatorMock: { platform: "Linux armv81", userAgent: "Mozilla/5.0 (Linux; Android 14)" },
  });
  assert.equal(navAndroidFallbackEnv.elements.shortcutModKey.textContent, "Alt");
  assert.equal(navAndroidFallbackEnv.elements.shortcutOsLabel.textContent, "");

  const unknownFallbackEnv = await createWelcomeTestEnv();
  assert.equal(unknownFallbackEnv.elements.shortcutModKey.textContent, "Alt");
  assert.equal(unknownFallbackEnv.elements.shortcutOsLabel.textContent, "");
  assert.equal(
    unknownFallbackEnv.elements.shortcutKbdGroup.getAttribute("aria-label"),
    "ショートカットキー: Alt + Shift + D"
  );
});

test("welcome/index.html contains required beginner guidance links, single shortcut callout, and excludes removed text/buttons", () => {
  const html = fs.readFileSync(path.join(SRC_DIR, "welcome/index.html"), "utf8");
  const css = fs.readFileSync(path.join(SRC_DIR, "welcome/index.css"), "utf8");

  const shortcutCombos = html.match(/class="shortcut-combo"/g) || [];
  assert.equal(shortcutCombos.length, 1);
  assert.match(html, /id="shortcut-mod-key"[^>]*>Alt<\/kbd>.*Shift<\/kbd>.*D<\/kbd>/s);
  assert.doesNotMatch(html, /Option<\/kbd>/);
  assert.match(html, /class="shortcut-or">または<\/p>.*id="open-portal-link"/s);
  assert.match(html, /href="https:\/\/doshisha\.ex-tic\.com\/idm\/user\/portal\/"[^>]*id="open-portal-link"/);
  assert.match(html, /ポータル画面を開く/);
  assert.doesNotMatch(html, /open-login-link/);
  assert.doesNotMatch(html, /リダイレクト/);
  assert.doesNotMatch(html, /約30秒/);
  assert.doesNotMatch(html, /入力を止めて1秒後、またはEnterで自動保存/);
  assert.doesNotMatch(html, /覚えておくと便利な2つのポイント/);
  assert.doesNotMatch(html, /外観テーマ（ダークモード）/);
  assert.doesNotMatch(html, /パスワードも保存しません/);
  assert.match(html, /パスワードは保存しません/);
  assert.match(html, /id="theme-setting-label"[^>]*>外観テーマ<\/span>/);
  assert.match(html, /id="theme-choices"/);
  assert.match(html, /class="card setup-card".*id="theme-choices".*<\/section>\s*<!-- Section 2: 今すぐ試してみよう -->\s*<section class="card try-card"/s);
  assert.match(html, /上の設定が反映されているか確認してみよう/);
  assert.match(html, /パスワードは保存されますか？/);
  assert.match(html, /パスワードは保存されますか？.*より快適にログインしたい場合は.*パスワードレス認証の利用をご検討ください/s);
  assert.equal(html.match(/fido_manual\.pdf/g)?.length, 1);
  assert.match(html, /options-subgroup.*href="#faq-fido2"[^>]*data-open-faq="faq-fido2"/s);
  assert.match(html, /<details id="faq-fido2" class="faq-item">/);
  assert.match(html, /「パスワードレス（FIDO2）」とは何ですか？<\/span>/);
  assert.match(html, /Windows Hello・Touch ID/);
  assert.match(html, /イメージングマトリクス認証.*二段階認証.*不要になり/s);
  assert.doesNotMatch(html, /上の 2 つのスイッチは<strong>両方 OFF のまま/);
  assert.match(html, /https:\/\/doshishaacjp\.sharepoint\.com\/sites\/it\/mfa_manual\/fido_manual\.pdf/);
  assert.match(html, /アンインストール/);
  assert.match(html, /再インストール/);
  assert.match(css, /\.os-label\s*\{[^}]*position:\s*absolute;\s*top:\s*10px;\s*left:\s*12px;/s);
  assert.match(css, /kbd\s*\{[^}]*font-size:\s*clamp\(15px,\s*4\.3vw,\s*34px\)/s);
});
