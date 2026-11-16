import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { SRC_DIR } from "./helpers/test-helpers.mjs";

function flushMicrotasks() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function loadBackgroundEnv({ failTabsCreate = false } = {}) {
  const installedListeners = [];
  const commandListeners = [];
  const createdTabs = [];

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
    },
    commands: {
      onCommand: {
        addListener(fn) {
          commandListeners.push(fn);
        },
      },
    },
    tabs: {
      create(opts) {
        createdTabs.push(opts);
        if (failTabsCreate) {
          return Promise.reject(new Error("tab creation failed"));
        }
        return Promise.resolve({ id: createdTabs.length, ...opts });
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

  return { installedListeners, commandListeners, createdTabs };
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
  const versionText = register("version-text", "span");

  const themeMenuItems = ["system", "light", "dark"].map((val) => {
    const item = createFakeNode("button");
    item._doc = doc;
    item.setAttribute("data-theme-value", val);
    item.setAttribute("aria-checked", "false");
    themeMenu._children.push(item);
    return item;
  });

  doc.getElementById = (id) => elementsById.get(id) || null;
  doc.querySelectorAll = (sel) => (sel === ".theme-menu-item" ? themeMenuItems : []);

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
      versionText,
    },
    setOsDark(dark) {
      isPrefersDark = dark;
      for (const fn of mediaListeners) fn({ matches: dark });
    },
  };
}

test("background.js opens welcome page only on fresh install and keeps shortcut handler", async () => {
  const { installedListeners, commandListeners, createdTabs } = loadBackgroundEnv();

  assert.equal(installedListeners.length, 1);
  assert.equal(commandListeners.length, 1);

  installedListeners[0]({ reason: "update" });
  installedListeners[0]({ reason: "browser_update" });
  assert.equal(createdTabs.length, 0);

  installedListeners[0]({ reason: "install" });
  assert.equal(createdTabs.length, 1);
  assert.equal(createdTabs[0].url, "extension://unit-test/welcome/index.html");

  commandListeners[0]("open-login-page");
  assert.equal(createdTabs.length, 2);
  assert.equal(createdTabs[1].url, "https://doshisha.ex-tic.com/auth/session");

  const failingEnv = loadBackgroundEnv({ failTabsCreate: true });
  failingEnv.installedListeners[0]({ reason: "install" });
  await flushMicrotasks();
  assert.equal(failingEnv.createdTabs.length, 1);
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

  // テーマメニューで明示選択し永続化
  elements.themeToggle.dispatchEvent({ type: "click" });
  assert.equal(elements.themeMenu.hasAttribute("hidden"), false);
  elements.themeMenuItems[1].dispatchEvent({ type: "click" });
  await flushMicrotasks();
  assert.equal(syncStore.get("theme"), "light");
  assert.equal(doc.documentElement.getAttribute("data-theme"), "light");
  assert.equal(elements.themeMenu.hasAttribute("hidden"), true);

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

test("welcome/index.html contains required beginner guidance links and shortcut callout", () => {
  const html = fs.readFileSync(path.join(SRC_DIR, "welcome/index.html"), "utf8");
  assert.match(html, /Alt<\/kbd>.*Shift<\/kbd>.*D<\/kbd>/s);
  assert.match(html, /Option<\/kbd>.*Shift<\/kbd>.*D<\/kbd>/s);
  assert.match(html, /https:\/\/doshishaacjp\.sharepoint\.com\/sites\/it\/mfa_manual\/fido_manual\.pdf/);
  assert.match(html, /アンインストール/);
  assert.match(html, /再インストール/);
});
