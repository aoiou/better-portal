import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(__dirname, "../..");
export const SRC_DIR = path.join(REPO_ROOT, "src");

const PORTAL_ENTRY_SCRIPT = "portal/content.js";

/**
 * Read the portal content script load order from src/manifest.json so tests
 * share a single source of truth with the extension manifest.
 */
export function getPortalScriptList(includeMain = true) {
  const manifestPath = path.join(SRC_DIR, "manifest.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const portalContentScript = (manifest.content_scripts || []).find(
    (cs) => cs.world !== "MAIN" && Array.isArray(cs.js) && cs.js.includes(PORTAL_ENTRY_SCRIPT)
  );
  if (!portalContentScript) {
    throw new Error(`Could not find ${PORTAL_ENTRY_SCRIPT} content_scripts entry in src/manifest.json`);
  }
  return includeMain
    ? [...portalContentScript.js]
    : portalContentScript.js.filter((rel) => rel !== PORTAL_ENTRY_SCRIPT);
}

function splitOutsideParens(str, delimiterRe) {
  const parts = [];
  let parenDepth = 0;
  let bracketDepth = 0;
  let start = 0;
  for (let i = 0; i < str.length; i++) {
    const ch = str[i];
    if (ch === "(") parenDepth++;
    else if (ch === ")" && parenDepth > 0) parenDepth--;
    else if (ch === "[") bracketDepth++;
    else if (ch === "]" && bracketDepth > 0) bracketDepth--;
    else if (parenDepth === 0 && bracketDepth === 0 && delimiterRe.test(ch)) {
      const seg = str.slice(start, i).trim();
      if (seg) parts.push(seg);
      start = i + 1;
    }
  }
  const tail = str.slice(start).trim();
  if (tail) parts.push(tail);
  return parts;
}

function matchesSimpleSelector(el, selector) {
  if (!el || el.nodeType !== 1) return false;
  return splitOutsideParens(selector, /,/).some((part) => matchSingleSelector(el, part));
}

function matchSingleSelector(el, sel) {
  if (!sel) return false;
  const parts = splitOutsideParens(sel, /\s/);
  if (parts.length > 1) {
    const tail = parts[parts.length - 1];
    if (!matchCompound(el, tail)) return false;
    let cur = el.parentElement;
    for (let i = parts.length - 2; i >= 0; i--) {
      while (cur && !matchCompound(cur, parts[i])) {
        cur = cur.parentElement;
      }
      if (!cur) return false;
      cur = cur.parentElement;
    }
    return true;
  }
  return matchCompound(el, sel);
}

function matchCompound(el, compound) {
  let rest = compound;
  const tagMatch = rest.match(/^[a-zA-Z0-9-]+/);
  if (tagMatch) {
    if (el.tagName.toLowerCase() !== tagMatch[0].toLowerCase()) return false;
    rest = rest.slice(tagMatch[0].length);
  }
  while (rest.length > 0) {
    if (rest.startsWith(":has(")) {
      let depth = 0;
      let endIdx = -1;
      for (let i = 5; i < rest.length; i++) {
        if (rest[i] === "(") depth++;
        else if (rest[i] === ")") {
          if (depth === 0) {
            endIdx = i;
            break;
          }
          depth--;
        }
      }
      if (endIdx < 0) return false;
      const innerSel = rest.slice(5, endIdx);
      if (!el.querySelector(innerSel)) return false;
      rest = rest.slice(endIdx + 1);
      continue;
    }

    const tokenMatch = rest.match(/^(#[a-zA-Z0-9_-]+|\.[a-zA-Z0-9_-]+|\[[^\]]+\])/);
    if (!tokenMatch) return false;
    const tok = tokenMatch[0];
    rest = rest.slice(tok.length);

    if (tok[0] === "#") {
      if (el.id !== tok.slice(1)) return false;
    } else if (tok[0] === ".") {
      if (!el.classList.contains(tok.slice(1))) return false;
    } else {
      const inner = tok.slice(1, -1);
      const opMatch = inner.match(/^([^=^*~$]+?)(\^=|\*=|=)(.+)$/);
      if (!opMatch) {
        if (!el.hasAttribute(inner)) return false;
      } else {
        const attr = opMatch[1].trim();
        const op = opMatch[2];
        const val = opMatch[3].trim().replace(/^['"]|['"]$/g, "");
        const actual = el.getAttribute(attr);
        if (actual === null) return false;
        if (op === "=" && actual !== val) return false;
        if (op === "^=" && !actual.startsWith(val)) return false;
        if (op === "*=" && !actual.includes(val)) return false;
      }
    }
  }
  return true;
}

class MockClassList {
  constructor(el) {
    Object.defineProperties(this, {
      _el: { value: el, enumerable: false, writable: true, configurable: true },
      _set: { value: new Set(), enumerable: false, writable: true, configurable: true },
    });
  }
  [Symbol.for("nodejs.util.inspect.custom")]() {
    return `MockClassList(${this._toString()})`;
  }
  _syncFromString(str) {
    this._set = new Set(String(str || "").split(/\s+/).filter(Boolean));
  }
  _toString() {
    return [...this._set].join(" ");
  }
  add(...tokens) {
    for (const t of tokens) if (t) this._set.add(t);
  }
  remove(...tokens) {
    for (const t of tokens) this._set.delete(t);
  }
  contains(token) {
    return this._set.has(token);
  }
  toggle(token, force) {
    const shouldAdd = force === undefined ? !this._set.has(token) : Boolean(force);
    if (shouldAdd) this._set.add(token);
    else this._set.delete(token);
    return shouldAdd;
  }
  [Symbol.iterator]() {
    return this._set[Symbol.iterator]();
  }
}

class MockNode {
  constructor(nodeType, ownerDocument) {
    Object.defineProperties(this, {
      nodeType: { value: nodeType, enumerable: true, writable: false, configurable: true },
      ownerDocument: { value: ownerDocument, enumerable: false, writable: true, configurable: true },
      parentNode: { value: null, enumerable: false, writable: true, configurable: true },
      childNodes: { value: [], enumerable: false, writable: true, configurable: true },
    });
  }
  [Symbol.for("nodejs.util.inspect.custom")]() {
    if (this.nodeType === 1) {
      const idPart = this.id ? `#${this.id}` : "";
      const clsPart = this.className ? `.${this.className.trim().split(/\s+/).join(".")}` : "";
      return `<MockElement ${this.tagName.toLowerCase()}${idPart}${clsPart}>`;
    }
    if (this.nodeType === 3) {
      return `<MockText ${JSON.stringify(this.nodeValue)}>`;
    }
    return `<MockNode type=${this.nodeType}>`;
  }
  get parentElement() {
    return this.parentNode && this.parentNode.nodeType === 1 ? this.parentNode : null;
  }
  remove() {
    if (!this.parentNode) return;
    const idx = this.parentNode.childNodes.indexOf(this);
    if (idx >= 0) this.parentNode.childNodes.splice(idx, 1);
    this.parentNode = null;
  }
  before(...nodes) {
    if (!this.parentNode) return;
    const parent = this.parentNode;
    const idx = parent.childNodes.indexOf(this);
    const expanded = expandNodes(nodes, this.ownerDocument);
    for (const n of expanded) {
      n.remove();
      n.parentNode = parent;
    }
    const insertIdx = parent.childNodes.indexOf(this);
    parent.childNodes.splice(insertIdx >= 0 ? insertIdx : idx, 0, ...expanded);
  }
  after(...nodes) {
    if (!this.parentNode) return;
    const parent = this.parentNode;
    const expanded = expandNodes(nodes, this.ownerDocument);
    for (const n of expanded) {
      n.remove();
      n.parentNode = parent;
    }
    const idx = parent.childNodes.indexOf(this);
    parent.childNodes.splice(idx + 1, 0, ...expanded);
  }
  replaceWith(...nodes) {
    if (!this.parentNode) return;
    this.before(...nodes);
    this.remove();
  }
}

function expandNodes(nodes, doc) {
  const out = [];
  for (const item of nodes) {
    if (item instanceof MockFragment) {
      out.push(...item.childNodes);
      item.childNodes = [];
    } else if (typeof item === "string") {
      out.push(doc.createTextNode(item));
    } else if (item) {
      out.push(item);
    }
  }
  return out;
}

class MockText extends MockNode {
  constructor(text, ownerDocument) {
    super(3, ownerDocument);
    this.nodeValue = String(text);
  }
  get textContent() {
    return this.nodeValue;
  }
  set textContent(v) {
    this.nodeValue = String(v ?? "");
  }
  cloneNode() {
    return new MockText(this.nodeValue, this.ownerDocument);
  }
}

class MockFragment extends MockNode {
  constructor(ownerDocument) {
    super(11, ownerDocument);
  }
  appendChild(node) {
    for (const n of expandNodes([node], this.ownerDocument)) {
      n.remove();
      n.parentNode = this;
      this.childNodes.push(n);
    }
    return node;
  }
}

class MockEventTarget {
  constructor() {
    Object.defineProperty(this, "_listeners", {
      value: new Map(),
      enumerable: false,
      writable: true,
      configurable: true,
    });
  }
  [Symbol.for("nodejs.util.inspect.custom")]() {
    return `MockEventTarget(${this._listeners.size})`;
  }
  addEventListener(type, fn, captureOrOpts = false) {
    const capture = typeof captureOrOpts === "boolean" ? captureOrOpts : Boolean(captureOrOpts?.capture);
    const once = typeof captureOrOpts === "object" && Boolean(captureOrOpts?.once);
    if (!this._listeners.has(type)) this._listeners.set(type, []);
    this._listeners.get(type).push({ fn, capture, once });
  }
  removeEventListener(type, fn, captureOrOpts = false) {
    const capture = typeof captureOrOpts === "boolean" ? captureOrOpts : Boolean(captureOrOpts?.capture);
    const list = this._listeners.get(type);
    if (!list) return;
    this._listeners.set(
      type,
      list.filter((entry) => !(entry.fn === fn && entry.capture === capture))
    );
  }
  _invokeListeners(type, event, phaseCapture) {
    const list = [...(this._listeners.get(type) || [])];
    for (const entry of list) {
      if (entry.capture !== phaseCapture) continue;
      if (event._stopImmediate) break;
      if (entry.once) this.removeEventListener(type, entry.fn, entry.capture);
      entry.fn.call(this, event);
    }
  }
}

export class MockElement extends MockNode {
  constructor(tagName, ownerDocument) {
    super(1, ownerDocument);
    this.hidden = false;
    this.disabled = false;
    const attrs = new Map();
    const datasetProxy = new Proxy(
      {},
      {
        get: (_t, prop) => {
          const attr = "data-" + String(prop).replace(/[A-Z]/g, (m) => "-" + m.toLowerCase());
          return attrs.has(attr) ? attrs.get(attr) : undefined;
        },
        set: (_t, prop, val) => {
          const attr = "data-" + String(prop).replace(/[A-Z]/g, (m) => "-" + m.toLowerCase());
          attrs.set(attr, String(val));
          return true;
        },
        deleteProperty: (_t, prop) => {
          const attr = "data-" + String(prop).replace(/[A-Z]/g, (m) => "-" + m.toLowerCase());
          attrs.delete(attr);
          return true;
        },
        has: (_t, prop) => {
          const attr = "data-" + String(prop).replace(/[A-Z]/g, (m) => "-" + m.toLowerCase());
          return attrs.has(attr);
        },
        ownKeys: () =>
          [...attrs.keys()]
            .filter((k) => k.startsWith("data-"))
            .map((k) => k.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())),
        getOwnPropertyDescriptor: () => ({ enumerable: true, configurable: true }),
      }
    );
    Object.defineProperties(this, {
      tagName: { value: String(tagName).toUpperCase(), enumerable: true, writable: false, configurable: true },
      classList: { value: new MockClassList(this), enumerable: false, writable: true, configurable: true },
      _attrs: { value: attrs, enumerable: false, writable: true, configurable: true },
      style: { value: {}, enumerable: false, writable: true, configurable: true },
      _eventTarget: { value: new MockEventTarget(), enumerable: false, writable: true, configurable: true },
      _checked: { value: false, enumerable: false, writable: true, configurable: true },
      dataset: { value: datasetProxy, enumerable: false, writable: false, configurable: true },
    });
  }

  get id() {
    return this._attrs.get("id") || "";
  }
  set id(v) {
    if (v === "" || v == null) this._attrs.delete("id");
    else this._attrs.set("id", String(v));
  }
  get className() {
    return this.classList._toString();
  }
  set className(v) {
    this.classList._syncFromString(v);
  }
  get href() {
    return this._attrs.get("href") || "";
  }
  set href(v) {
    this._attrs.set("href", String(v));
  }
  get src() {
    return this._attrs.get("src") || "";
  }
  set src(v) {
    this._attrs.set("src", String(v));
  }
  get title() {
    return this._attrs.get("title") || "";
  }
  set title(v) {
    this._attrs.set("title", String(v));
  }
  get type() {
    return this._attrs.get("type") || "";
  }
  set type(v) {
    this._attrs.set("type", String(v));
  }
  get value() {
    if (this.tagName === "SELECT") {
      if (this._attrs.has("value")) return this._attrs.get("value");
      const opts = this.querySelectorAll("option");
      const sel = opts.find((o) => o.selected) || opts[0];
      return sel ? sel.value : "";
    }
    return this._attrs.get("value") || "";
  }
  set value(v) {
    this._attrs.set("value", String(v));
  }
  get name() {
    return this._attrs.get("name") || "";
  }
  set name(v) {
    this._attrs.set("name", String(v));
  }
  get checked() {
    return this._checked;
  }
  set checked(v) {
    const next = Boolean(v);
    if (next && this.tagName === "INPUT" && this.type === "radio" && this.name) {
      const scope = this.closest("form") || this.ownerDocument;
      if (scope) {
        for (const radio of scope.querySelectorAll('input[type="radio"]')) {
          if (radio !== this && radio.name === this.name) {
            radio._checked = false;
          }
        }
      }
    }
    this._checked = next;
  }
  get children() {
    return this.childNodes.filter((n) => n.nodeType === 1);
  }
  get isConnected() {
    let cur = this;
    while (cur.parentNode) cur = cur.parentNode;
    return cur === this.ownerDocument?.documentElement || cur === this.ownerDocument;
  }
  get offsetParent() {
    return this.hidden ? null : this.parentElement;
  }
  get offsetHeight() {
    return 100;
  }
  get textContent() {
    return this.childNodes.map((n) => n.textContent).join("");
  }
  set textContent(v) {
    this.childNodes = [];
    if (v !== "" && v != null) {
      this.appendChild(this.ownerDocument.createTextNode(String(v)));
    }
  }
  setAttribute(name, val) {
    if (name === "class") this.className = val;
    else this._attrs.set(name, String(val));
  }
  getAttribute(name) {
    if (name === "class") return this.className || null;
    return this._attrs.has(name) ? this._attrs.get(name) : null;
  }
  hasAttribute(name) {
    if (name === "class") return Boolean(this.className);
    return this._attrs.has(name);
  }
  removeAttribute(name) {
    if (name === "class") this.className = "";
    else this._attrs.delete(name);
  }
  appendChild(node) {
    for (const n of expandNodes([node], this.ownerDocument)) {
      n.remove();
      n.parentNode = this;
      this.childNodes.push(n);
    }
    return node;
  }
  append(...nodes) {
    for (const n of expandNodes(nodes, this.ownerDocument)) this.appendChild(n);
  }
  prepend(...nodes) {
    const expanded = expandNodes(nodes, this.ownerDocument);
    for (const n of expanded) {
      n.remove();
      n.parentNode = this;
    }
    this.childNodes.unshift(...expanded);
  }
  replaceChildren(...nodes) {
    for (const c of this.childNodes) c.parentNode = null;
    this.childNodes = [];
    this.append(...nodes);
  }
  contains(other) {
    let cur = other;
    while (cur) {
      if (cur === this) return true;
      cur = cur.parentNode;
    }
    return false;
  }
  matches(selector) {
    return matchesSimpleSelector(this, selector);
  }
  closest(selector) {
    let cur = this;
    while (cur && cur.nodeType === 1) {
      if (cur.matches(selector)) return cur;
      cur = cur.parentElement;
    }
    return null;
  }
  querySelectorAll(selector) {
    const res = [];
    const visit = (node) => {
      for (const child of node.childNodes) {
        if (child.nodeType === 1) {
          if (child.matches(selector)) res.push(child);
          visit(child);
        }
      }
    };
    visit(this);
    return res;
  }
  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null;
  }
  cloneNode(deep = false) {
    const copy = new MockElement(this.tagName, this.ownerDocument);
    copy.className = this.className;
    for (const [k, v] of this._attrs.entries()) copy._attrs.set(k, v);
    copy.style = { ...this.style };
    if (deep) {
      for (const child of this.childNodes) copy.appendChild(child.cloneNode(true));
    }
    return copy;
  }
  getBoundingClientRect() {
    return { left: 0, top: 0, right: 100, bottom: 100, width: 100, height: 100 };
  }
  focus() {
    this.ownerDocument.activeElement = this;
  }
  click() {
    this.dispatchEvent({ type: "click", bubbles: true, target: this, preventDefault() {}, stopPropagation() {} });
  }
  addEventListener(type, fn, opts) {
    this._eventTarget.addEventListener(type, fn, opts);
  }
  removeEventListener(type, fn, opts) {
    this._eventTarget.removeEventListener(type, fn, opts);
  }
  dispatchEvent(event) {
    event.target = event.target || this;
    const path = [];
    let cur = this;
    while (cur) {
      path.unshift(cur);
      cur = cur.parentNode;
    }
    const win = this.ownerDocument?._window;
    if (win) path.unshift(win);
    for (const node of path) {
      node._invokeListeners?.(event.type, event, true);
      node._eventTarget?._invokeListeners(event.type, event, true);
    }
    if (event.bubbles) {
      for (let i = path.length - 1; i >= 0; i--) {
        const node = path[i];
        node._invokeListeners?.(event.type, event, false);
        node._eventTarget?._invokeListeners(event.type, event, false);
      }
    } else {
      this._eventTarget._invokeListeners(event.type, event, false);
    }
    return true;
  }
}

export function createPortalTestEnv({
  syncInitial = {},
  localInitial = {},
  localStorageInitial = {},
  includeMain = false,
  setupDom = null,
} = {}) {
  const syncStore = new Map(Object.entries(syncInitial));
  const localStore = new Map(Object.entries(localInitial));
  const lsStore = new Map(Object.entries(localStorageInitial));
  let failSyncSet = false;
  let syncSetCount = 0;
  let syncSetGate = null;

  const doc = {
    [Symbol.for("nodejs.util.inspect.custom")]() {
      return "[MockDocument]";
    },
    readyState: "complete",
    visibilityState: "visible",
    createElement(tag) {
      return new MockElement(tag, doc);
    },
    createElementNS(_ns, tag) {
      return new MockElement(tag, doc);
    },
    createTextNode(text) {
      return new MockText(text, doc);
    },
    createDocumentFragment() {
      return new MockFragment(doc);
    },
    getElementById(id) {
      return doc.documentElement.querySelector(`#${id}`);
    },
    querySelector(sel) {
      return doc.documentElement.querySelector(sel);
    },
    querySelectorAll(sel) {
      return doc.documentElement.querySelectorAll(sel);
    },
    addEventListener(type, fn, opts) {
      doc._eventTarget.addEventListener(type, fn, opts);
    },
    removeEventListener(type, fn, opts) {
      doc._eventTarget.removeEventListener(type, fn, opts);
    },
    dispatchEvent(ev) {
      doc._eventTarget._invokeListeners(ev.type, ev, false);
    },
  };
  Object.defineProperties(doc, {
    activeElement: { value: null, enumerable: false, writable: true, configurable: true },
    _eventTarget: { value: new MockEventTarget(), enumerable: false, writable: true, configurable: true },
    documentElement: { value: null, enumerable: false, writable: true, configurable: true },
    body: { value: null, enumerable: false, writable: true, configurable: true },
    _window: { value: null, enumerable: false, writable: true, configurable: true },
  });

  const html = new MockElement("html", doc);
  const body = new MockElement("body", doc);
  html.parentNode = doc;
  html.appendChild(body);
  doc.documentElement = html;
  doc.body = body;
  doc.activeElement = body;

  const winTarget = new MockEventTarget();
  const windowObj = {
    [Symbol.for("nodejs.util.inspect.custom")]() {
      return "[MockWindow]";
    },
    matchMedia: () => ({ matches: false }),
    addEventListener: (t, f, o) => winTarget.addEventListener(t, f, o),
    removeEventListener: (t, f, o) => winTarget.removeEventListener(t, f, o),
    _invokeListeners: (t, e, c) => winTarget._invokeListeners(t, e, c),
    dispatchEvent: (e) => {
      winTarget._invokeListeners(e.type, e, true);
      winTarget._invokeListeners(e.type, e, false);
      return true;
    },
    requestAnimationFrame: (cb) => setTimeout(cb, 0),
    cancelAnimationFrame: (id) => clearTimeout(id),
    scrollBy() {},
    scrollY: 0,
    innerHeight: 900,
  };
  Object.defineProperty(windowObj, "document", {
    value: doc,
    enumerable: false,
    writable: true,
    configurable: true,
  });
  doc._window = windowObj;

  function pickFrom(map, keys) {
    const out = {};
    const list = Array.isArray(keys) ? keys : [keys];
    for (const k of list) {
      if (map.has(k)) out[k] = structuredClone(map.get(k));
    }
    return out;
  }

  const browser = {
    storage: {
      sync: {
        async get(keys) {
          return pickFrom(syncStore, keys);
        },
        async set(obj) {
          syncSetCount += 1;
          if (syncSetGate) {
            await syncSetGate();
          }
          if (failSyncSet) {
            throw new Error("Quota exceeded");
          }
          for (const [k, v] of Object.entries(obj)) {
            syncStore.set(k, structuredClone(v));
          }
        },
      },
      local: {
        async get(keys) {
          return pickFrom(localStore, keys);
        },
        async set(obj) {
          for (const [k, v] of Object.entries(obj)) {
            localStore.set(k, structuredClone(v));
          }
        },
        async remove(keys) {
          const list = Array.isArray(keys) ? keys : [keys];
          for (const k of list) localStore.delete(k);
        },
      },
    },
  };

  const localStorage = {
    getItem: (k) => (lsStore.has(k) ? lsStore.get(k) : null),
    setItem: (k, v) => lsStore.set(k, String(v)),
    removeItem: (k) => lsStore.delete(k),
  };

  class CustomEventPolyfill {
    constructor(type, init = {}) {
      this.type = type;
      this.bubbles = Boolean(init.bubbles);
      this.detail = init.detail;
    }
  }

  const context = vm.createContext({
    globalThis: null,
    window: windowObj,
    document: doc,
    browser,
    localStorage,
    Element: MockElement,
    HTMLElement: MockElement,
    CustomEvent: CustomEventPolyfill,
    CSS: { escape: (s) => String(s) },
    URL,
    console,
    setTimeout,
    clearTimeout,
    requestAnimationFrame: windowObj.requestAnimationFrame,
    cancelAnimationFrame: windowObj.cancelAnimationFrame,
    performance,
    queueMicrotask,
  });
  context.globalThis = context;

  const scripts = getPortalScriptList(includeMain);

  if (setupDom) {
    setupDom(doc);
  }

  for (const rel of scripts) {
    const code = fs.readFileSync(path.join(SRC_DIR, rel), "utf8");
    vm.runInContext(code, context, { filename: rel });
  }

  return {
    BP: context.BetterPortal,
    document: doc,
    window: windowObj,
    syncStore,
    localStore,
    lsStore,
    setFailSyncSet: (val) => {
      failSyncSet = val;
    },
    setSyncSetGate: (fn) => {
      syncSetGate = fn;
    },
    getSyncSetCount: () => syncSetCount,
  };
}
