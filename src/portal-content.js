(function () {
  "use strict";

  /* =====================================================================
   * 定数・設定定義 (CONSTANTS)
   * ===================================================================== */
  const CONSTANTS = {
    STORAGE_KEY: "betterPortalSettings",
    CUSTOM_ID_PREFIX: "bp-custom-",
    SVG_NS: "http://www.w3.org/2000/svg",
    CLASSES: {
      EDIT_MODE: "bp-edit-mode",
      READY: "bp-ready",
      SERVICE_CARD: "bp-service-card",
      CUSTOM_CARD: "bp-custom-card",
      HIDDEN_ITEM: "bp-hidden-item",
      DRAGGING: "bp-dragging",
      DROP_BEFORE: "bp-drop-before",
      DROP_AFTER: "bp-drop-after",
      EDIT_OVERLAY: "bp-edit-overlay",
      TOGGLE_OVERLAY: "bp-toggle-overlay",
      NOTICE_BADGE: "bp-notice-badge",
      NOTICE_FOOTER: "bp-notice-footer",
      NOTICE_BOTTOM: "bp-notice-bottom",
      NOTICE_BLOCK_READ: "bp-notice-block--read",
      NOTICE_BLOCK_FOLDED: "bp-notice-block--folded",
      NOTICE_FOLD_BAR: "bp-notice-fold-bar",
      NOTICE_FOLD_BAR_FLUSH_BOTTOM: "bp-notice-fold-bar--flush-bottom",
      NOTICE_BODY_FLUSH_BOTTOM: "bp-notice-body--flush-bottom",
    },
    EVENTS: {
      ONCLICK_CHANGE: "bp-onclick-change",
    },
    SELECTOR: {
      SERVICE_ROW: '.row:has([id^="div-"][class*="col-"] .service-thumb-wrap)',
      SERVICE_CARDS: '[id^="div-"][class*="col-"]:has(.service-thumb-wrap)',
      NOTICE_CARD: "#PortalComment02",
      NOTICE_TOGGLE: '.card-header a[data-bs-toggle="collapse"], .card-header a',
      NOTICE_BODY: "#collapse1, .card-body.collapse",
      NOTICE_CONTENT: ".ql-editor",
    },
  };

  let mainRow = null;
  let hiddenSectionOpen = false;
  let draggedCardId = null;
  let cardTemplate = null;
  let activeModal = null;

  const TOGGLE_CONFIG = [
    { key: "hideNavbar", find: () => document.querySelector("nav.navbar"), showLabel: "ナビバー を表示する", hideLabel: "ナビバー を非表示にする" },
    { key: "hideSubNav", find: () => document.querySelector(".sub-nav"), showLabel: "サブナビ を表示する", hideLabel: "サブナビ を非表示にする" },
    { key: "hidePageTitle", find: () => document.querySelector(".page-title"), showLabel: "「アカウント」帯 を表示する", hideLabel: "「アカウント」帯 を非表示にする" },
    { key: "hideSearchBar", find: () => document.getElementById("filterValue")?.closest(".row"), showLabel: "検索欄 を表示する", hideLabel: "検索欄 を非表示にする" },
    {
      key: "noticeToBottom",
      find: () => document.querySelector(CONSTANTS.SELECTOR.NOTICE_CARD),
      showLabel: "お知らせを一番下に移動 を元に戻す",
      hideLabel: "お知らせを一番下に移動",
      apply(el, active) {
        if (!document.getElementById("bp-notice-anchor")) {
          const anchor = document.createElement("span");
          anchor.id = "bp-notice-anchor";
          anchor.hidden = true;
          el.before(anchor);
        }
        el.classList.toggle(CONSTANTS.CLASSES.NOTICE_BOTTOM, Boolean(active));
        if (active) document.getElementById("div-container")?.appendChild(el);
        else document.getElementById("bp-notice-anchor")?.after(el);
      },
      revert(el, active) {
        el.classList.remove(CONSTANTS.CLASSES.NOTICE_BOTTOM);
        if (active) document.getElementById("bp-notice-anchor")?.after(el);
      },
    },
  ];

  /* =====================================================================
   * ストレージ層 (Storage & Settings)
   * ===================================================================== */
  async function storageGet(keys) {
    try {
      const syncResult = await browser.storage.sync.get(keys);
      if (syncResult && syncResult[CONSTANTS.STORAGE_KEY] !== undefined) {
        return syncResult;
      }
      const localResult = await browser.storage.local.get(keys);
      if (localResult && localResult[CONSTANTS.STORAGE_KEY] !== undefined) {
        await browser.storage.sync.set({ [CONSTANTS.STORAGE_KEY]: localResult[CONSTANTS.STORAGE_KEY] }).catch(() => {});
        return localResult;
      }
      return syncResult;
    } catch {
      return await browser.storage.local.get(keys);
    }
  }

  async function storageSet(data) {
    try {
      await browser.storage.sync.set(data);
    } catch {
      await browser.storage.local.set(data);
    }
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
      m365RedirectMethod: "domain_hint",
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
        ? (normalizeUrl(raw.m365RedirectUrl) || "")
        : defaults.m365RedirectUrl,
      m365RedirectMethod: normalizeM365Method(raw.m365RedirectMethod, defaults.m365RedirectMethod),
      customCards: Array.isArray(raw.customCards)
        ? raw.customCards.filter((c) => c && typeof c === "object" && typeof c.id === "string" && typeof c.title === "string")
        : defaults.customCards,
    };
  }

  async function loadSettings() {
    try {
      const result = await storageGet(CONSTANTS.STORAGE_KEY);
      return normalizeSettings(result[CONSTANTS.STORAGE_KEY]);
    } catch (err) {
      console.error("[Better Portal] Failed to load settings:", err);
      return getDefaultSettings();
    }
  }

  async function saveSettings(settings) {
    try {
      await storageSet({ [CONSTANTS.STORAGE_KEY]: settings });
    } catch (err) {
      console.error("[Better Portal] Failed to save settings:", err);
    }
  }

  /* =====================================================================
   * 並び順計算ロジック (OrderLogic - 純粋関数 / SRP)
   * ===================================================================== */
  const OrderLogic = {
    calcMoveOrder(order, hiddenIds, cardId, direction) {
      const idx = order.indexOf(cardId);
      if (idx < 0) return null;

      const visibleOrder = order.filter((id) => !hiddenIds.includes(id));
      const visibleIdx = visibleOrder.indexOf(cardId);
      if (visibleIdx < 0) return null;

      const newVisibleIdx = visibleIdx + direction;
      if (newVisibleIdx < 0 || newVisibleIdx >= visibleOrder.length) return null;

      const swapId = visibleOrder[newVisibleIdx];
      const swapIdx = order.indexOf(swapId);

      const newOrder = [...order];
      newOrder[idx] = swapId;
      newOrder[swapIdx] = cardId;
      return newOrder;
    },

    calcDragReorder(order, draggedId, targetId, insertBefore) {
      const newOrder = [...order];
      const dragIdx = newOrder.indexOf(draggedId);
      if (dragIdx < 0) return null;

      newOrder.splice(dragIdx, 1);
      let targetIdx = newOrder.indexOf(targetId);
      if (targetIdx < 0) return null;

      if (!insertBefore) targetIdx++;
      newOrder.splice(targetIdx, 0, draggedId);
      return newOrder;
    },
  };

  /* =====================================================================
   * お知らせ更新検知・既読判定ロジック (NoticeLogic - 純粋関数 / SRP)
   * ===================================================================== */
  const NoticeLogic = {
    MAX_BLOCKS_FOR_DIFF: 200,
    BLOCK_SELECTOR: "p, li, h1, h2, h3, h4, h5, h6, blockquote, pre, tr",
    LAYOUT_WRAPPER_TAGS: new Set(["DIV", "SECTION", "ARTICLE", "MAIN", "HEADER", "FOOTER", "ASIDE"]),
    EXTENSION_WIDGET_CLASSES: new Set([
      CONSTANTS.CLASSES.NOTICE_BADGE,
      CONSTANTS.CLASSES.NOTICE_FOOTER,
      CONSTANTS.CLASSES.TOGGLE_OVERLAY,
      CONSTANTS.CLASSES.EDIT_OVERLAY,
      CONSTANTS.CLASSES.NOTICE_FOLD_BAR,
      "bp-notice-fold-icon",
      "bp-notice-fold-label",
      "bp-notice-footer-note",
      "bp-notice-footer-status",
      "bp-notice-ack-btn",
      "bp-notice-unack-btn",
    ]),

    normalizeText(text) {
      return String(text || "").replace(/[\s\u00A0\u3000]+/g, " ").trim();
    },

    hashText(str) {
      let h1 = 0x811c9dc5;
      let h2 = 0x9e3779b1;
      for (let i = 0; i < str.length; i++) {
        const ch = str.charCodeAt(i);
        h1 ^= ch;
        h1 = Math.imul(h1, 0x01000193);
        h2 ^= ch + (i & 0xff);
        h2 = Math.imul(h2, 0x85ebca6b);
      }
      return (h1 >>> 0).toString(36) + "-" + (h2 >>> 0).toString(36);
    },

    isExtensionNode(node) {
      return Boolean(
        node &&
          node.nodeType === 1 &&
          [...node.classList].some((c) => this.EXTENSION_WIDGET_CLASSES.has(c))
      );
    },

    extractRawText(node) {
      if (!node || this.isExtensionNode(node)) return "";
      if (node.nodeType === 3) return node.nodeValue || "";
      if (node.nodeType !== 1) return "";
      if (node.tagName === "BR") return " ";
      let out = "";
      for (const child of node.childNodes) {
        out += this.extractRawText(child);
      }
      return out;
    },

    serializeBlock(el) {
      if (!el || this.isExtensionNode(el)) return "";
      if (el.nodeType === 3) return this.normalizeText(el.nodeValue);
      if (el.nodeType !== 1) return "";

      const text = this.normalizeText(this.extractRawText(el));
      const linkEls = el.matches("a[href]") ? [el] : [...el.querySelectorAll("a[href]")];
      const links = linkEls
        .filter((a) => !this.isExtensionNode(a))
        .map((a) => (a.getAttribute("href") || "").trim())
        .filter(Boolean);
      const imgEls = el.matches("img[src]") ? [el] : [...el.querySelectorAll("img[src]")];
      const imgs = imgEls
        .filter((img) => !this.isExtensionNode(img))
        .map((img) => `${(img.getAttribute("src") || "").trim()}|${(img.getAttribute("alt") || "").trim()}`)
        .filter((s) => s !== "|");

      if (!text && links.length === 0 && imgs.length === 0) return "";
      return [text, links.join("\t"), imgs.join("\t")].filter(Boolean).join("\n");
    },

    collectBlockEntries(root) {
      if (!root) return [];
      const entries = [];

      const walk = (container) => {
        for (const node of container.childNodes) {
          if (this.isExtensionNode(node)) continue;
          if (node.nodeType === 3) {
            const text = this.normalizeText(node.nodeValue);
            if (text) {
              entries.push({ element: null, fingerprint: text, hash: this.hashText(text) });
            }
          } else if (node.nodeType === 1) {
            const hasNestedBlock = Boolean(node.querySelector(this.BLOCK_SELECTOR));
            if (hasNestedBlock) {
              walk(node);
            } else {
              const fp = this.serializeBlock(node);
              if (fp) {
                entries.push({ element: node, fingerprint: fp, hash: this.hashText(fp) });
              }
            }
          }
        }
      };

      walk(root);
      return entries;
    },

    extractBlockData(root) {
      const entries = this.collectBlockEntries(root);
      if (entries.length === 0) {
        return { hashes: [], entries: [], collapsedToSingleHash: false };
      }
      if (entries.length > this.MAX_BLOCKS_FOR_DIFF) {
        return {
          hashes: [this.hashText(entries.map((e) => e.fingerprint).join("\n"))],
          entries,
          collapsedToSingleHash: true,
        };
      }
      return {
        hashes: [...new Set(entries.map((e) => e.hash))],
        entries,
        collapsedToSingleHash: false,
      };
    },

    evaluateNoticeState(currentHashes, readHashes) {
      const current = Array.isArray(currentHashes) ? currentHashes : [];
      const read = Array.isArray(readHashes) ? readHashes : [];
      if (current.length === 0) {
        return {
          status: "empty",
          hasMixedReadAndUnseen: false,
          shouldPrune: read.length > 0,
          prunedReadHashes: [],
        };
      }
      const readSet = new Set(read);
      if (current.some((h) => !readSet.has(h))) {
        return {
          status: "unread",
          hasMixedReadAndUnseen: read.length > 0 && current.some((h) => readSet.has(h)),
          shouldPrune: false,
          prunedReadHashes: read,
        };
      }
      const currentSet = new Set(current);
      const uniqueRead = [...new Set(read)];
      const pruned = uniqueRead.filter((h) => currentSet.has(h));
      return {
        status: "read",
        hasMixedReadAndUnseen: false,
        shouldPrune: pruned.length !== read.length,
        prunedReadHashes: pruned,
      };
    },

    collectFoldGroups(root, entries, readSet) {
      if (!root || !Array.isArray(entries) || entries.length === 0) return [];
      const groups = [];

      const classifyUnit = (el) => {
        const matched = entries.filter((e) => e.element && (e.element === el || el.contains(e.element)));
        if (matched.length === 0) {
          return { kind: "spacer", hashes: [] };
        }
        if (matched.every((e) => readSet.has(e.hash))) {
          return {
            kind: "read",
            hashes: matched.map((e) => e.hash),
          };
        }
        return { kind: "unseen", hashes: [] };
      };

      const walkContainer = (container) => {
        let currentUnits = [];
        let trailingSpacers = [];
        let currentHashes = [];

        const flush = () => {
          if (currentUnits.length > 0) {
            groups.push({
              elements: currentUnits,
              anchor: currentUnits[0],
              key: `${groups.length}:${currentHashes.join("|")}`,
            });
          }
          currentUnits = [];
          trailingSpacers = [];
          currentHashes = [];
        };

        for (const node of container.childNodes) {
          if (this.isExtensionNode(node)) continue;
          if (node.nodeType === 3) {
            if (this.normalizeText(node.nodeValue)) flush();
            continue;
          }
          if (node.nodeType !== 1) continue;

          if (this.LAYOUT_WRAPPER_TAGS.has(node.tagName) && node.querySelector(this.BLOCK_SELECTOR)) {
            flush();
            walkContainer(node);
            continue;
          }

          const info = classifyUnit(node);
          if (info.kind === "read") {
            if (currentUnits.length > 0 && trailingSpacers.length > 0) {
              currentUnits.push(...trailingSpacers);
            }
            trailingSpacers = [];
            currentUnits.push(node);
            currentHashes.push(...info.hashes);
          } else if (info.kind === "spacer") {
            if (currentUnits.length > 0) {
              trailingSpacers.push(node);
            }
          } else {
            flush();
          }
        }

        flush();
      };

      walkContainer(root);
      return groups;
    },
  };

  /* =====================================================================
   * URLユーティリティ & M365サービス (UrlUtils & M365Service)
   * ===================================================================== */
  const M365_REDIRECT_METHODS = {
    LOGIN_SRF: "login_srf",
    DOMAIN_HINT: "domain_hint",
  };
  const M365_DOMAIN_HINT = "mail.doshisha.ac.jp";
  const M365_CUSTOM_OPTION_ID = "custom";
  const M365_REDIRECT_PRESETS = [
    {
      id: "default",
      label: "デフォルト",
      description: "ポータル標準のリンク先を使用",
      url: "",
      method: M365_REDIRECT_METHODS.DOMAIN_HINT,
    },
    {
      id: "onedrive",
      label: "OneDrive (SharePoint)",
      description: "大学のOneDriveを開く",
      url: "https://doshishaacjp-my.sharepoint.com/my",
      method: M365_REDIRECT_METHODS.LOGIN_SRF,
      badge: "旧方式",
    },
    {
      id: "outlook",
      label: "Outlook",
      variants: [
        {
          id: M365_REDIRECT_METHODS.DOMAIN_HINT,
          label: "新方式",
          description: "ヒントをつけてOutlookを開く",
          url: "https://outlook.cloud.microsoft/mail/",
          method: M365_REDIRECT_METHODS.DOMAIN_HINT,
        },
        {
          id: M365_REDIRECT_METHODS.LOGIN_SRF,
          label: "旧方式",
          description: "ポータル経由でOutlookを開く",
          url: "https://outlook.office.com/mail/",
          method: M365_REDIRECT_METHODS.LOGIN_SRF,
        },
      ],
    },
  ];
  const M365_METHOD_OPTIONS = [
    {
      id: M365_REDIRECT_METHODS.DOMAIN_HINT,
      label: "新方式",
      description: "ヒントをつけて開く",
    },
    {
      id: M365_REDIRECT_METHODS.LOGIN_SRF,
      label: "旧方式",
      description: "ポータル経由で開く",
    },
  ];

  function normalizeUrl(input) {
    let value = (input || "").trim();
    if (!value) return null;
    if (!/^https?:\/\//i.test(value)) {
      if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) return null;
      value = "https://" + value;
    }
    try {
      const url = new URL(value);
      if (url.protocol !== "http:" && url.protocol !== "https:") return null;
      return url.href;
    } catch {
      return null;
    }
  }

  function normalizeM365Method(method, fallback = M365_REDIRECT_METHODS.DOMAIN_HINT) {
    if (method === M365_REDIRECT_METHODS.LOGIN_SRF || method === M365_REDIRECT_METHODS.DOMAIN_HINT) {
      return method;
    }
    return fallback;
  }

  function findM365PresetMatch(url, method = M365_REDIRECT_METHODS.DOMAIN_HINT) {
    const trimmed = (url || "").trim();
    if (!trimmed) {
      const preset = M365_REDIRECT_PRESETS[0];
      return { preset, variant: null };
    }
    const normalized = normalizeUrl(trimmed);
    if (!normalized) return null;
    const normalizedMethod = normalizeM365Method(method);

    for (const preset of M365_REDIRECT_PRESETS) {
      if (Array.isArray(preset.variants)) {
        const variant = preset.variants.find(
          (v) => v.url === normalized && v.method === normalizedMethod
        );
        if (variant) return { preset, variant };
      } else if (preset.url === normalized && preset.method === normalizedMethod) {
        return { preset, variant: null };
      }
    }
    return null;
  }

  function buildM365DomainHintUrl(inputUrl, domainHint = M365_DOMAIN_HINT) {
    const targetUrl = normalizeUrl(inputUrl);
    if (!targetUrl) return null;
    const url = new URL(targetUrl);
    const hasDomainHint = [...url.searchParams.keys()].some(
      (key) => key.toLowerCase() === "domain_hint"
    );
    if (!hasDomainHint) {
      url.searchParams.set("domain_hint", domainHint);
    }
    return url.href;
  }

  function isM365Card(el) {
    if (el.classList.contains(CONSTANTS.CLASSES.CUSTOM_CARD)) return false;
    const spanText = el.querySelector("span")?.textContent?.trim();
    if (spanText === "Microsoft365") return true;

    const link = el.querySelector("a.service-thumb");
    const currentOnclick = link?.getAttribute("onclick") || "";
    const originalOnclick = link?.dataset.bpOriginalOnclick || "";
    return currentOnclick.includes("login.microsoftonline.com") ||
           originalOnclick.includes("login.microsoftonline.com");
  }

  function replaceOnclickUrl(originalOnclick, targetUrl) {
    const quotedUrlPattern = /(['"])https?:\/\/(?:\\.|(?!\1).)*\1/i;
    const quotedMatch = originalOnclick.match(quotedUrlPattern);
    if (quotedMatch) {
      const quote = quotedMatch[1];
      const escaped = targetUrl.replace(/\\/g, "\\\\").replaceAll(quote, `\\${quote}`);
      return originalOnclick.replace(quotedUrlPattern, () => `${quote}${escaped}${quote}`);
    }
    const escaped = targetUrl.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
    return originalOnclick.replace(/https?:\/\/[^'"]+/i, () => escaped);
  }

  function buildM365Onclick(originalOnclick, inputUrl, method = M365_REDIRECT_METHODS.DOMAIN_HINT) {
    if (!originalOnclick) return originalOnclick;
    const normalizedMethod = normalizeM365Method(method);
    const targetUrl = normalizedMethod === M365_REDIRECT_METHODS.DOMAIN_HINT
      ? buildM365DomainHintUrl(inputUrl)
      : normalizeUrl(inputUrl);
    if (!targetUrl) return originalOnclick;

    if (
      normalizedMethod === M365_REDIRECT_METHODS.DOMAIN_HINT ||
      /^https?:\/\/login\.microsoftonline\.com\//i.test(targetUrl) ||
      !/[?&]wreply=/i.test(originalOnclick)
    ) {
      return replaceOnclickUrl(originalOnclick, targetUrl);
    }
    return originalOnclick.replace(
      /([?&]wreply=)[^'&"]+/i,
      (_match, p1) => p1 + encodeURIComponent(targetUrl)
    );
  }

  function applyM365Redirect(el, settings) {
    if (!isM365Card(el)) return;
    const link = el.querySelector("a.service-thumb");
    if (!link) return;

    if (!("bpOriginalOnclick" in link.dataset)) {
      link.dataset.bpOriginalOnclick = link.getAttribute("onclick") || "";
    }

    const originalOnclick = link.dataset.bpOriginalOnclick;
    if (!originalOnclick) return;

    const customUrl = settings.m365RedirectUrl?.trim();
    const method = normalizeM365Method(settings.m365RedirectMethod);
    const targetOnclick = customUrl
      ? buildM365Onclick(originalOnclick, customUrl, method)
      : originalOnclick;

    if (link.getAttribute("onclick") !== targetOnclick) {
      link.dataset.bpOnclick = targetOnclick;
      link.dispatchEvent(new CustomEvent(CONSTANTS.EVENTS.ONCLICK_CHANGE, { bubbles: true }));
    }
  }

  /* =====================================================================
   * DOM ユーティリティ & モーダルダイアログ基盤
   * ===================================================================== */
  function createEl(tag, className, text) {
    const el = document.createElement(tag);
    if (className) el.className = className;
    if (text != null) el.textContent = String(text);
    return el;
  }

  function closeModal() {
    if (!activeModal) return;
    document.removeEventListener("keydown", activeModal.onKeydown, true);
    activeModal.backdrop.remove();
    activeModal = null;
  }

  function createModalFrame({ title, ariaLabel, submitText, onRenderBody, onSubmit }) {
    closeModal();

    const backdrop = createEl("div", "bp-modal-backdrop");
    const dialog = createEl("div", "bp-modal-dialog");
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-modal", "true");
    dialog.setAttribute("aria-label", ariaLabel || title);

    const form = createEl("form", "bp-modal-form");
    form.noValidate = true;
    form.appendChild(createEl("h3", "bp-modal-title", title));

    const errorEl = createEl("p", "bp-modal-error");

    const makeField = (labelText, input, hint) => {
      const field = createEl("label", "bp-modal-field");
      field.appendChild(createEl("span", "bp-modal-label", labelText));
      field.appendChild(input);
      if (hint) field.appendChild(createEl("span", "bp-modal-hint", hint));
      return field;
    };

    onRenderBody({ form, makeField, errorEl });
    form.appendChild(errorEl);

    const actions = createEl("div", "bp-modal-actions");
    const cancelBtn = createEl("button", "bp-btn bp-btn-cancel", "キャンセル");
    cancelBtn.type = "button";
    const saveBtn = createEl("button", "bp-btn bp-btn-save", submitText || "保存");
    saveBtn.type = "submit";
    actions.append(cancelBtn, saveBtn);
    form.appendChild(actions);

    form.addEventListener("submit", (e) => {
      e.preventDefault();
      onSubmit({ errorEl, closeModal });
    });

    cancelBtn.addEventListener("click", closeModal);
    backdrop.addEventListener("mousedown", (e) => {
      if (e.target === backdrop) closeModal();
    });

    const onKeydown = (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        closeModal();
      } else if (e.key === "Tab") {
        const focusables = Array.from(
          dialog.querySelectorAll(
            'button:not([disabled]), input:not([disabled]):not([hidden]), select:not([disabled]):not([hidden]), [tabindex]:not([tabindex="-1"])'
          )
        ).filter((el) => {
          if (el.offsetParent === null) return false;
          if (el.type === "radio" && el.name) {
            const checked = dialog.querySelector(
              `input[type="radio"][name="${CSS.escape(el.name)}"]:checked`
            );
            if (checked && checked !== el) return false;
          }
          return true;
        });
        if (focusables.length === 0) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", onKeydown, true);

    dialog.appendChild(form);
    backdrop.appendChild(dialog);
    document.body.appendChild(backdrop);
    activeModal = { backdrop, onKeydown };

    return { dialog, form, errorEl };
  }

  function openM365UrlModal(currentUrl, currentMethod, onSave) {
    const initialMethod = normalizeM365Method(currentMethod);
    const match = findM365PresetMatch(currentUrl, initialMethod);
    const initialOptionId = match ? match.preset.id : M365_CUSTOM_OPTION_ID;
    const initialCustomMethod = (!match && currentUrl)
      ? initialMethod
      : M365_REDIRECT_METHODS.DOMAIN_HINT;
    const modalToken = generateCustomCardId();
    const destRadioName = "bp-m365-redirect-" + modalToken;
    const methodRadioName = "bp-m365-method-" + modalToken;
    const destRadios = {};
    const methodRadios = {};
    const presetSelects = {};
    let customSection = null;
    let customDescEl = null;
    let urlInput = null;

    const getSelectedOptionId = () =>
      Object.values(destRadios).find((radio) => radio.checked)?.value || "default";

    const getSelectedMethod = () =>
      Object.values(methodRadios).find((radio) => radio.checked)?.value || M365_REDIRECT_METHODS.DOMAIN_HINT;

    const syncCustomSection = () => {
      const isCustom = getSelectedOptionId() === M365_CUSTOM_OPTION_ID;
      if (customSection) customSection.hidden = !isCustom;
      if (customDescEl) customDescEl.hidden = isCustom;
    };

    const createRadioOptionItem = ({
      name,
      value,
      checked,
      title,
      description,
      badge,
      variants,
      initialVariantId,
      radiosMap,
      onPointerSelect,
      extraContent,
    }) => {
      const option = createEl(
        "div",
        extraContent ? "bp-modal-option bp-modal-option--expandable" : "bp-modal-option"
      );
      const hitLabel = createEl("label", "bp-modal-option-hit");
      const radio = createEl("input");
      radio.type = "radio";
      radio.name = name;
      radio.value = value;
      radio.checked = checked;
      radiosMap[value] = radio;

      const body = createEl("span", "bp-modal-option-body");
      const header = createEl("span", "bp-modal-option-header");
      header.appendChild(createEl("span", "bp-modal-option-title", title));
      body.appendChild(header);

      const initialVariant = Array.isArray(variants)
        ? (variants.find((v) => v.id === initialVariantId) || variants[0])
        : null;
      const descText = initialVariant
        ? (initialVariant.description || initialVariant.url)
        : description;
      const descEl = descText ? createEl("span", "bp-modal-option-desc", descText) : null;
      if (descEl) body.appendChild(descEl);

      if (onPointerSelect) {
        hitLabel.addEventListener("click", (e) => {
          if (e.detail > 0) onPointerSelect();
        });
      }

      hitLabel.append(radio, body);
      if (badge) {
        hitLabel.appendChild(createEl("span", "bp-modal-option-badge", badge));
      }
      option.appendChild(hitLabel);

      if (Array.isArray(variants) && variants.length > 0) {
        const select = createEl("select", "bp-modal-select");
        select.setAttribute("aria-label", `${title}の方式`);
        for (const variant of variants) {
          const opt = createEl("option", null, variant.label);
          opt.value = variant.id;
          opt.selected = variant.id === initialVariant.id;
          select.appendChild(opt);
        }
        select.addEventListener("change", () => {
          const activeVariant = variants.find((v) => v.id === select.value) || variants[0];
          if (descEl) descEl.textContent = activeVariant.description || activeVariant.url;
          radio.checked = true;
        });
        presetSelects[value] = select;
        option.appendChild(select);
      }

      if (extraContent) {
        option.appendChild(extraContent);
      }

      return option;
    };

    const createRadioGroupField = (
      labelText,
      labelId,
      optionItems,
      listClassName = "bp-modal-option-list"
    ) => {
      const field = createEl("div", "bp-modal-field");
      const labelEl = createEl("span", "bp-modal-label", labelText);
      labelEl.id = labelId;
      field.appendChild(labelEl);

      const optionList = createEl("div", listClassName);
      optionList.setAttribute("role", "radiogroup");
      optionList.setAttribute("aria-labelledby", labelId);
      optionItems.forEach((item) => optionList.appendChild(item));

      field.appendChild(optionList);
      return field;
    };

    const { form, errorEl } = createModalFrame({
      title: "Microsoft365のリンク先設定",
      ariaLabel: "Microsoft365のリンク先を設定",
      submitText: "保存",
      onRenderBody({ form: modalForm }) {
        customSection = createEl("div", "bp-modal-option-extra");

        const urlField = createEl("label", "bp-modal-field");
        const urlLabelRow = createEl("span", "bp-modal-label-row");
        urlLabelRow.append(
          createEl("span", "bp-modal-label", "リンク先URL"),
          createEl("span", "bp-modal-hint", "「https://」は省略できます")
        );
        urlInput = createEl("input", "bp-modal-input");
        urlInput.type = "text";
        urlInput.inputMode = "url";
        urlInput.maxLength = 2000;
        urlInput.placeholder = "例: https://teams.microsoft.com/";
        urlInput.value = match ? "" : (currentUrl || "");
        urlField.append(urlLabelRow, urlInput);
        customSection.appendChild(urlField);

        const methodOptions = M365_METHOD_OPTIONS.map((opt) =>
          createRadioOptionItem({
            name: methodRadioName,
            value: opt.id,
            checked: opt.id === initialCustomMethod,
            title: opt.label,
            description: opt.description,
            radiosMap: methodRadios,
          })
        );
        customSection.appendChild(
          createRadioGroupField(
            "遷移方式",
            methodRadioName + "-label",
            methodOptions,
            "bp-modal-option-list bp-modal-option-list--grid"
          )
        );
        customSection.appendChild(
          createEl(
            "p",
            "bp-modal-hint bp-modal-extra-note",
            "URLやサービス、方式によっては正しく開けない場合があります。"
          )
        );

        const customOption = createRadioOptionItem({
          name: destRadioName,
          value: M365_CUSTOM_OPTION_ID,
          checked: initialOptionId === M365_CUSTOM_OPTION_ID,
          title: "その他（カスタムURL）",
          description: "Teamsなど、お好みのページを指定",
          radiosMap: destRadios,
          onPointerSelect() {
            queueMicrotask(() => {
              if (destRadios[M365_CUSTOM_OPTION_ID]?.checked) {
                syncCustomSection();
                urlInput?.focus();
              }
            });
          },
          extraContent: customSection,
        });
        customDescEl = customOption.querySelector(".bp-modal-option-desc");

        const destOptions = [
          ...M365_REDIRECT_PRESETS.map((preset) =>
            createRadioOptionItem({
              name: destRadioName,
              value: preset.id,
              checked: preset.id === initialOptionId,
              title: preset.label,
              description: preset.description,
              badge: preset.badge,
              variants: preset.variants,
              initialVariantId: match?.preset.id === preset.id ? match.variant?.id : undefined,
              radiosMap: destRadios,
            })
          ),
          customOption,
        ];
        modalForm.appendChild(createRadioGroupField("リンク先", destRadioName + "-label", destOptions));

        syncCustomSection();
      },
      onSubmit({ errorEl: errEl, closeModal: closeFn }) {
        const selectedId = getSelectedOptionId();
        if (selectedId !== M365_CUSTOM_OPTION_ID) {
          const preset = M365_REDIRECT_PRESETS.find((item) => item.id === selectedId);
          closeFn();
          if (preset && Array.isArray(preset.variants)) {
            const select = presetSelects[preset.id];
            const variant = preset.variants.find((v) => v.id === select?.value) || preset.variants[0];
            onSave(variant.url, variant.method);
          } else {
            onSave(preset ? preset.url : "", preset ? preset.method : M365_REDIRECT_METHODS.DOMAIN_HINT);
          }
          return;
        }

        const raw = urlInput.value.trim();
        if (!raw) {
          errEl.textContent = "URLを入力してください。デフォルトに戻す場合は「デフォルト」を選択してください。";
          urlInput.focus();
          return;
        }
        const validated = normalizeUrl(raw);
        if (!validated) {
          errEl.textContent = "有効なURL（http:// または https://）を入力してください。";
          urlInput.focus();
          return;
        }
        closeFn();
        onSave(validated, getSelectedMethod());
      },
    });

    form.addEventListener("input", () => {
      errorEl.textContent = "";
    });
    form.addEventListener("change", () => {
      errorEl.textContent = "";
      syncCustomSection();
    });

    if (initialOptionId === M365_CUSTOM_OPTION_ID) {
      urlInput?.focus();
    } else {
      destRadios[initialOptionId]?.focus();
    }
  }

  /* =====================================================================
   * オリジナルカード・DOMコンポーネント (Card Components)
   * ===================================================================== */
  function generateCustomCardId() {
    return Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 7);
  }

  function findCustomCard(settings, elementId) {
    if (!elementId.startsWith(CONSTANTS.CUSTOM_ID_PREFIX)) return null;
    const id = elementId.slice(CONSTANTS.CUSTOM_ID_PREFIX.length);
    return settings.customCards.find((c) => c.id === id) || null;
  }

  function createDefaultIconSvg() {
    const svg = document.createElementNS(CONSTANTS.SVG_NS, "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("class", "bp-card-default-icon");
    svg.setAttribute("aria-hidden", "true");
    const paths = [
      "M12 2a10 10 0 1 0 0 20a10 10 0 1 0 0-20z",
      "M2 12h20",
      "M12 2a15 15 0 0 1 4 10a15 15 0 0 1-4 10a15 15 0 0 1-4-10a15 15 0 0 1 4-10z",
    ];
    for (const d of paths) {
      const path = document.createElementNS(CONSTANTS.SVG_NS, "path");
      path.setAttribute("d", d);
      path.setAttribute("fill", "none");
      path.setAttribute("stroke", "currentColor");
      path.setAttribute("stroke-width", "1.6");
      path.setAttribute("stroke-linecap", "round");
      path.setAttribute("stroke-linejoin", "round");
      svg.appendChild(path);
    }
    return svg;
  }

  function createIconElement(iconType, iconValue, forPreview = false) {
    const wrap = createEl("div", forPreview ? "bp-custom-icon" : "service-thumb-img bp-custom-icon");

    const imageUrl = iconType === "url" ? normalizeUrl(iconValue) : null;
    if (iconType === "emoji" && iconValue?.trim()) {
      wrap.appendChild(createEl("span", "bp-card-emoji", iconValue.trim()));
    } else if (imageUrl) {
      const img = createEl("img", "bp-card-image");
      img.alt = "";
      img.referrerPolicy = "no-referrer";
      img.draggable = false;
      img.addEventListener("error", () => img.replaceWith(createDefaultIconSvg()), { once: true });
      img.src = imageUrl;
      wrap.appendChild(img);
    } else {
      wrap.appendChild(createDefaultIconSvg());
    }
    return wrap;
  }

  function createCardTemplate(sourceCard) {
    const tpl = sourceCard.cloneNode(true);
    tpl.querySelectorAll("." + CONSTANTS.CLASSES.EDIT_OVERLAY).forEach((el) => el.remove());
    tpl.classList.remove(
      CONSTANTS.CLASSES.SERVICE_CARD,
      CONSTANTS.CLASSES.HIDDEN_ITEM,
      CONSTANTS.CLASSES.DRAGGING,
      CONSTANTS.CLASSES.DROP_BEFORE,
      CONSTANTS.CLASSES.DROP_AFTER
    );
    tpl.removeAttribute("draggable");
    tpl.removeAttribute("style");
    return tpl;
  }

  function createCustomCardElement(card) {
    if (!cardTemplate) return null;
    const el = cardTemplate.cloneNode(true);
    el.querySelectorAll("[id]").forEach((n) => n.removeAttribute("id"));
    el.querySelectorAll("[onclick]").forEach((n) => n.removeAttribute("onclick"));
    el.id = CONSTANTS.CUSTOM_ID_PREFIX + card.id;
    el.classList.add(CONSTANTS.CLASSES.CUSTOM_CARD);

    const link = el.querySelector("a.service-thumb");
    if (!link) return null;
    for (const key of Object.keys(link.dataset)) delete link.dataset[key];
    link.removeAttribute("onclick");
    link.onclick = null;
    const safeUrl = normalizeUrl(card.url) || "#";
    link.href = safeUrl;
    link.title = safeUrl;
    link.target = "_blank";
    link.rel = "noopener noreferrer";

    const icon = createIconElement(card.iconType, card.iconValue);
    const oldIcon = link.querySelector(".service-thumb-img");
    if (oldIcon) oldIcon.replaceWith(icon);
    else link.prepend(icon);

    let label = [...link.querySelectorAll("span")].find((s) => !icon.contains(s));
    if (!label) {
      label = document.createElement("span");
      link.appendChild(label);
    }
    label.textContent = card.title;

    return el;
  }

  function guardCustomCardClick(e) {
    const target = e.target instanceof Element ? e.target : e.target?.parentElement;
    if (!target) return;
    if (target.closest("." + CONSTANTS.CLASSES.EDIT_OVERLAY)) return;
    const link = target.closest("." + CONSTANTS.CLASSES.CUSTOM_CARD + " a.service-thumb");
    if (!link) return;
    e.stopImmediatePropagation();
    if (document.body.classList.contains(CONSTANTS.CLASSES.EDIT_MODE)) {
      e.preventDefault();
    }
  }
  window.addEventListener("click", guardCustomCardClick, true);
  window.addEventListener("auxclick", guardCustomCardClick, true);

  function deleteCustomCard(settings, elementId, onUpdate) {
    const card = findCustomCard(settings, elementId);
    if (!card) return;
    if (!confirm("「" + card.title + "」を削除しますか？\nこの操作は元に戻せません。")) return;
    settings.customCards = settings.customCards.filter((c) => c.id !== card.id);
    settings.order = settings.order.filter((id) => id !== elementId);
    settings.hiddenIds = settings.hiddenIds.filter((id) => id !== elementId);
    saveSettings(settings);
    onUpdate();
  }

  function openCardModal(card, onSave) {
    let titleInput, urlInput, emojiInput, iconUrlInput, previewCard;
    const radios = {};
    const radioName = "bp-icon-type-" + generateCustomCardId();

    const getIconType = () => Object.values(radios).find((r) => r.checked)?.value || "default";
    const getIconValue = (type) =>
      type === "emoji" ? emojiInput.value.trim() : type === "url" ? iconUrlInput.value.trim() : "";

    let lastPreviewKey = null;
    function updatePreview() {
      const type = getIconType();
      emojiInput.hidden = type !== "emoji";
      iconUrlInput.hidden = type !== "url";
      const value = getIconValue(type);
      const title = titleInput.value.trim() || "タイトル未入力";
      const key = JSON.stringify([type, value, title]);
      if (key === lastPreviewKey) return;
      lastPreviewKey = key;
      previewCard.replaceChildren(
        createIconElement(type, value, true),
        createEl("span", "bp-preview-title", title)
      );
    }

    const { form, errorEl } = createModalFrame({
      title: card ? "オリジナルカードを編集" : "オリジナルカードを追加",
      ariaLabel: card ? "オリジナルカードを編集" : "オリジナルカードを追加",
      submitText: card ? "保存" : "追加",
      onRenderBody({ form: modalForm, makeField }) {
        titleInput = createEl("input", "bp-modal-input");
        titleInput.type = "text";
        titleInput.maxLength = 40;
        titleInput.placeholder = "例: Google Classroom";
        titleInput.value = card?.title || "";

        urlInput = createEl("input", "bp-modal-input");
        urlInput.type = "text";
        urlInput.inputMode = "url";
        urlInput.maxLength = 2000;
        urlInput.placeholder = "例: https://classroom.google.com/";
        urlInput.value = card?.url || "";

        modalForm.appendChild(makeField("タイトル", titleInput));
        modalForm.appendChild(makeField("URL", urlInput, "「https://」は省略できます"));

        const iconField = createEl("div", "bp-modal-field");
        iconField.appendChild(createEl("span", "bp-modal-label", "アイコン"));
        const radioRow = createEl("div", "bp-modal-radio-row");
        for (const [value, text] of [["default", "デフォルト"], ["emoji", "絵文字"], ["url", "画像URL"]]) {
          const label = createEl("label", "bp-modal-radio");
          const radio = createEl("input");
          radio.type = "radio";
          radio.name = radioName;
          radio.value = value;
          radios[value] = radio;
          label.append(radio, createEl("span", null, text));
          radioRow.appendChild(label);
        }
        iconField.appendChild(radioRow);

        emojiInput = createEl("input", "bp-modal-input bp-modal-emoji-input");
        emojiInput.type = "text";
        emojiInput.maxLength = 16;
        emojiInput.placeholder = "例: 📚";

        iconUrlInput = createEl("input", "bp-modal-input");
        iconUrlInput.type = "text";
        iconUrlInput.inputMode = "url";
        iconUrlInput.maxLength = 2000;
        iconUrlInput.placeholder = "例: https://example.com/icon.png";

        const initialType = card?.iconType || "default";
        radios[initialType in radios ? initialType : "default"].checked = true;
        if (initialType === "emoji") emojiInput.value = card.iconValue || "";
        if (initialType === "url") iconUrlInput.value = card.iconValue || "";

        iconField.append(emojiInput, iconUrlInput);
        modalForm.appendChild(iconField);

        const previewField = createEl("div", "bp-modal-field");
        previewField.appendChild(createEl("span", "bp-modal-label", "プレビュー"));
        previewCard = createEl("div", "bp-preview-card");
        previewField.appendChild(previewCard);
        modalForm.appendChild(previewField);
      },
      onSubmit({ errorEl: errEl, closeModal: closeFn }) {
        const title = titleInput.value.trim();
        const url = normalizeUrl(urlInput.value);
        const iconType = getIconType();
        const iconValue = getIconValue(iconType);
        const normalizedIconUrl = iconType === "url" ? normalizeUrl(iconValue) : null;

        let error = "";
        let focusTarget = null;
        if (!title) [error, focusTarget] = ["タイトルを入力してください。", titleInput];
        else if (!url) [error, focusTarget] = ["有効なURL（http:// または https://）を入力してください。", urlInput];
        else if (iconType === "emoji" && !iconValue) [error, focusTarget] = ["絵文字を入力してください。", emojiInput];
        else if (iconType === "url" && !normalizedIconUrl) [error, focusTarget] = ["有効な画像URL（http:// または https://）を入力してください。", iconUrlInput];
        if (error) {
          errEl.textContent = error;
          focusTarget.focus();
          return;
        }

        closeFn();
        onSave({
          title,
          url,
          iconType,
          iconValue: normalizedIconUrl ?? iconValue,
        });
      },
    });

    form.addEventListener("input", () => {
      errorEl.textContent = "";
      updatePreview();
    });
    form.addEventListener("change", updatePreview);

    updatePreview();
    titleInput.focus();
  }

  function createAddCardPlaceholder(settings, onUpdate) {
    const col = createEl("div", cardTemplate?.className || "");
    col.classList.add("bp-add-card-col");

    const btn = createEl("button", "bp-add-card-btn");
    btn.type = "button";
    btn.draggable = false;
    btn.append(
      createEl("span", "bp-add-card-plus", "＋"),
      createEl("span", "bp-add-card-label", "新規カードを追加")
    );

    btn.addEventListener("click", (e) => {
      e.preventDefault();
      openCardModal(null, (data) => {
        const card = { id: generateCustomCardId(), ...data };
        settings.customCards.push(card);
        settings.order.push(CONSTANTS.CUSTOM_ID_PREFIX + card.id);
        saveSettings(settings);
        onUpdate();
      });
    });

    col.appendChild(btn);
    return col;
  }

  function getAllServiceCards() {
    return [...document.querySelectorAll(CONSTANTS.SELECTOR.SERVICE_CARDS)];
  }

  function createButton(className, text, onClick) {
    const btn = createEl("button", "bp-btn " + className, text);
    btn.type = "button";
    btn.draggable = false;
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      onClick();
    });
    return btn;
  }

  /* =====================================================================
   * トグル要素コントローラ (Toggle Controller)
   * ===================================================================== */
  function applyExtraHides(settings) {
    if (document.body.classList.contains(CONSTANTS.CLASSES.EDIT_MODE)) return;
    for (const cfg of TOGGLE_CONFIG) {
      const el = cfg.find();
      if (!el) continue;
      if (cfg.apply) cfg.apply(el, settings[cfg.key]);
      else el.style.display = settings[cfg.key] ? "none" : "";
    }
  }

  function createToggleOverlay(targetEl, cfg, settings, onUpdate) {
    targetEl.querySelector("." + CONSTANTS.CLASSES.TOGGLE_OVERLAY)?.remove();

    const wrapper = createEl("div", CONSTANTS.CLASSES.TOGGLE_OVERLAY);

    const isActive = settings[cfg.key];
    wrapper.appendChild(createButton(
      isActive ? "bp-btn-show" : "bp-btn-hide",
      isActive ? cfg.showLabel : cfg.hideLabel,
      () => {
        settings[cfg.key] = !settings[cfg.key];
        saveSettings(settings);
        onUpdate();
      }
    ));

    if (!("bpPrevPosition" in targetEl.dataset)) {
      targetEl.dataset.bpPrevPosition = targetEl.style.position || "";
    }
    targetEl.style.position = "relative";
    targetEl.appendChild(wrapper);
  }

  function setupTogglableElements(settings, onUpdate) {
    for (const cfg of TOGGLE_CONFIG) {
      const el = cfg.find();
      if (!el) continue;
      if (cfg.revert) cfg.revert(el, settings[cfg.key]);
      else if (settings[cfg.key]) el.style.display = "";
      createToggleOverlay(el, cfg, settings, onUpdate);
    }
  }

  function cleanupTogglableElements(settings) {
    document.querySelectorAll("." + CONSTANTS.CLASSES.TOGGLE_OVERLAY).forEach((el) => {
      const parent = el.parentElement;
      if (parent && "bpPrevPosition" in parent.dataset) {
        parent.style.position = parent.dataset.bpPrevPosition;
        delete parent.dataset.bpPrevPosition;
      }
      el.remove();
    });
    applyExtraHides(settings);
  }

  function findServiceRow() {
    return document.querySelector(CONSTANTS.SELECTOR.SERVICE_ROW);
  }

  /* =====================================================================
   * カード編集オーバーレイ生成
   * ===================================================================== */
  function createEditOverlay(el, settings, onUpdate) {
    const overlay = createEl("div", CONSTANTS.CLASSES.EDIT_OVERLAY);

    const id = el.id;
    const isHidden = settings.hiddenIds.includes(id);
    const customCard = el.classList.contains(CONSTANTS.CLASSES.CUSTOM_CARD) ? findCustomCard(settings, id) : null;

    const createCustomCardButtons = () => {
      const row = createEl("div", "bp-move-row");
      if (!isHidden) {
        row.appendChild(createButton("bp-btn-edit", "編集", () => {
          openCardModal(customCard, (data) => {
            Object.assign(customCard, data);
            saveSettings(settings);
            onUpdate();
          });
        }));
      }
      row.appendChild(createButton("bp-btn-delete", "削除", () => {
        deleteCustomCard(settings, id, onUpdate);
      }));
      return row;
    };

    if (isHidden) {
      overlay.appendChild(createButton("bp-btn-show", "表示する", () => {
        settings.hiddenIds = settings.hiddenIds.filter((hid) => hid !== id);
        saveSettings(settings);
        onUpdate();
      }));
      if (customCard) overlay.appendChild(createCustomCardButtons());
    } else {
      overlay.appendChild(createButton("bp-btn-hide", "非表示にする", () => {
        settings.hiddenIds.push(id);
        saveSettings(settings);
        onUpdate();
      }));

      const moveRow = createEl("div", "bp-move-row");
      for (const [cls, text, direction, title] of [
        ["bp-btn-up", "▲", -1, "上に移動"],
        ["bp-btn-down", "▼", 1, "下に移動"],
      ]) {
        const moveBtn = createButton(cls, text, () => {
          const newOrder = OrderLogic.calcMoveOrder(settings.order, settings.hiddenIds, id, direction);
          if (!newOrder) return;
          settings.order = newOrder;
          saveSettings(settings);
          onUpdate();
        });
        moveBtn.title = title;
        moveRow.appendChild(moveBtn);
      }
      overlay.appendChild(moveRow);

      if (customCard) overlay.appendChild(createCustomCardButtons());

      if (isM365Card(el)) {
        const currentUrl = settings.m365RedirectUrl?.trim() || "";
        const currentMethod = normalizeM365Method(settings.m365RedirectMethod);
        const hasCustomUrl = Boolean(currentUrl);
        const match = hasCustomUrl ? findM365PresetMatch(currentUrl, currentMethod) : null;
        const linkBtn = createButton(
          "bp-btn-link",
          hasCustomUrl ? "リンク先変更 (設定済)" : "リンク先を変更",
          () => {
            openM365UrlModal(currentUrl, currentMethod, (newUrl, newMethod) => {
              settings.m365RedirectUrl = newUrl;
              settings.m365RedirectMethod = newMethod;
              saveSettings(settings);
              onUpdate();
            });
          }
        );
        if (hasCustomUrl) {
          if (match?.variant) {
            linkBtn.title = `現在の設定: ${match.preset.label}（${match.variant.label}）`;
          } else if (match) {
            linkBtn.title = `現在の設定: ${match.preset.label}`;
          } else if (currentMethod === M365_REDIRECT_METHODS.DOMAIN_HINT) {
            linkBtn.title = `現在の設定（新方式）: ${currentUrl}`;
          } else {
            linkBtn.title = `現在の設定（旧方式）: ${currentUrl}`;
          }
        }
        overlay.appendChild(linkBtn);
      }
    }

    return overlay;
  }

  /* =====================================================================
   * ドラッグ＆ドロップコントローラ (Drag and Drop Controller)
   * ===================================================================== */
  function clearDropIndicators() {
    mainRow?.querySelectorAll("." + CONSTANTS.CLASSES.DROP_BEFORE + ", ." + CONSTANTS.CLASSES.DROP_AFTER)
      .forEach((el) => el.classList.remove(CONSTANTS.CLASSES.DROP_BEFORE, CONSTANTS.CLASSES.DROP_AFTER));
  }

  function initDragAndDrop(settings) {
    mainRow.addEventListener("dragstart", (e) => {
      const card = e.target.closest("." + CONSTANTS.CLASSES.SERVICE_CARD);
      if (!card || !document.body.classList.contains(CONSTANTS.CLASSES.EDIT_MODE)) {
        e.preventDefault();
        return;
      }
      draggedCardId = card.id;
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", card.id);
      requestAnimationFrame(() => card.classList.add(CONSTANTS.CLASSES.DRAGGING));
    });

    mainRow.addEventListener("dragend", (e) => {
      const card = e.target.closest("." + CONSTANTS.CLASSES.SERVICE_CARD);
      if (card) card.classList.remove(CONSTANTS.CLASSES.DRAGGING);
      clearDropIndicators();
      draggedCardId = null;
    });

    mainRow.addEventListener("dragover", (e) => {
      if (!draggedCardId) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";

      const card = e.target.closest("." + CONSTANTS.CLASSES.SERVICE_CARD);
      if (!card || draggedCardId === card.id) return;

      clearDropIndicators();
      const rect = card.getBoundingClientRect();
      const midX = rect.left + rect.width / 2;
      card.classList.add(e.clientX < midX ? CONSTANTS.CLASSES.DROP_BEFORE : CONSTANTS.CLASSES.DROP_AFTER);
    });

    mainRow.addEventListener("dragleave", (e) => {
      const card = e.target.closest("." + CONSTANTS.CLASSES.SERVICE_CARD);
      if (card) card.classList.remove(CONSTANTS.CLASSES.DROP_BEFORE, CONSTANTS.CLASSES.DROP_AFTER);
    });

    mainRow.addEventListener("drop", (e) => {
      if (!draggedCardId) return;
      e.preventDefault();

      const card = e.target.closest("." + CONSTANTS.CLASSES.SERVICE_CARD);
      const shouldReorder = card && draggedCardId !== card.id;

      if (shouldReorder) {
        const rect = card.getBoundingClientRect();
        const midX = rect.left + rect.width / 2;
        const insertBefore = e.clientX < midX;
        const newOrder = OrderLogic.calcDragReorder(settings.order, draggedCardId, card.id, insertBefore);
        if (newOrder) {
          settings.order = newOrder;
          saveSettings(settings);
        }
      }

      clearDropIndicators();
      draggedCardId = null;
      if (shouldReorder) applyLayout(settings);
    });
  }

  /* =====================================================================
   * 非表示セクション生成
   * ===================================================================== */
  function createHiddenSection(count) {
    const section = createEl("div", "bp-hidden-section" + (hiddenSectionOpen ? " open" : ""));

    const header = createEl("div", "bp-hidden-header");
    const label = createEl("span");
    label.append(
      createEl("span", "bp-hidden-title", "非表示の項目"),
      createEl("span", "bp-hidden-count", count)
    );
    header.append(label, createEl("span", "bp-hidden-arrow", "▼"));

    const body = createEl("div", "bp-hidden-body");
    section.append(header, body);

    header.addEventListener("click", () => {
      section.classList.toggle("open");
      hiddenSectionOpen = section.classList.contains("open");
    });

    return { section, body };
  }

  /* =====================================================================
   * お知らせ更新検知・既読折りたたみコントローラ (NoticeController)
   * ===================================================================== */
  function getNoticeParts() {
    const noticeEl = document.querySelector(CONSTANTS.SELECTOR.NOTICE_CARD);
    if (!noticeEl) return null;
    const toggleLink = noticeEl.querySelector(CONSTANTS.SELECTOR.NOTICE_TOGGLE);
    const collapseBody = noticeEl.querySelector(CONSTANTS.SELECTOR.NOTICE_BODY);
    const contentEl = noticeEl.querySelector(CONSTANTS.SELECTOR.NOTICE_CONTENT) || collapseBody;
    return { noticeEl, toggleLink, collapseBody, contentEl };
  }

  function setNoticeCollapsed(parts, collapsed, { preferBootstrapClick = false } = {}) {
    const { toggleLink, collapseBody } = parts;
    if (!collapseBody) return;

    if (preferBootstrapClick && toggleLink && collapseBody.classList.contains("show")) {
      if (!collapseBody.classList.contains("collapsing")) {
        toggleLink.click();
      }
      return;
    }

    collapseBody.classList.remove("collapsing");
    collapseBody.classList.toggle("show", !collapsed);
    collapseBody.setAttribute("aria-expanded", collapsed ? "false" : "true");
    if (toggleLink) {
      toggleLink.classList.toggle("collapsed", collapsed);
      toggleLink.setAttribute("aria-expanded", collapsed ? "false" : "true");
    }
  }

  function bindNoticeToggleFallback(parts) {
    const { toggleLink, collapseBody } = parts;
    if (!toggleLink || !collapseBody || toggleLink.dataset.bpToggleBound) return;
    toggleLink.dataset.bpToggleBound = "1";

    let preClickShown = null;
    toggleLink.addEventListener(
      "click",
      () => {
        preClickShown = collapseBody.classList.contains("show");
      },
      true
    );

    // Bootstrap (document バブリング) より後に window バブリングで未処理時のみフォールバックする
    window.addEventListener("click", (e) => {
      const target = e.target instanceof Element ? e.target : e.target?.parentElement;
      if (!target || !toggleLink.contains(target)) return;
      if (preClickShown === null) return;

      const wasShown = preClickShown;
      preClickShown = null;
      if (!collapseBody.classList.contains("collapsing") &&
          collapseBody.classList.contains("show") === wasShown) {
        e.preventDefault();
        setNoticeCollapsed(parts, wasShown);
      }
    });
  }

  function renderNoticeBadge(toggleLink, status) {
    if (!toggleLink) return;
    let badge = toggleLink.querySelector("." + CONSTANTS.CLASSES.NOTICE_BADGE);

    const badgeMeta = {
      unread: { text: "未読", mod: "bp-notice-badge--unread" },
      read: { text: "確認済み", mod: "bp-notice-badge--read" },
    }[status];

    if (!badgeMeta) {
      badge?.remove();
      return;
    }

    if (!badge) {
      badge = document.createElement("span");
      const titleSpan = toggleLink.querySelector("span");
      if (titleSpan) titleSpan.after(badge);
      else toggleLink.appendChild(badge);
    }

    badge.className = `${CONSTANTS.CLASSES.NOTICE_BADGE} ${badgeMeta.mod}`;
    badge.textContent = badgeMeta.text;
  }

  function hasVisibleContentAfter(container, el) {
    const foldedClass = CONSTANTS.CLASSES.NOTICE_BLOCK_FOLDED;
    let cur = el;
    while (cur && cur !== container) {
      const parent = cur.parentNode;
      if (!parent) break;
      const siblings = parent.childNodes;
      const idx = Array.prototype.indexOf.call(siblings, cur);
      for (let i = idx + 1; i < siblings.length; i++) {
        const sib = siblings[i];
        if (sib.nodeType === 3) {
          if (NoticeLogic.normalizeText(sib.nodeValue)) return true;
        } else if (sib.nodeType === 1 && !NoticeLogic.isExtensionNode(sib)) {
          if (!sib.classList.contains(foldedClass)) {
            if (NoticeLogic.normalizeText(sib.textContent)) return true;
            if (sib.matches("img, hr, table, iframe, svg") || sib.querySelector("img, hr, table, iframe, svg")) {
              return true;
            }
          }
        }
      }
      cur = parent;
    }
    return false;
  }

  function applyFoldGroupState(bar, group, expanded, contentEl = null) {
    bar.dataset.bpFoldKey = group.key;
    bar.setAttribute("aria-expanded", expanded ? "true" : "false");

    const label = bar.querySelector(".bp-notice-fold-label");
    if (label) {
      label.textContent = expanded ? "確認済みの内容を折りたたむ" : "確認済みの内容を表示";
    }

    const foldedClass = CONSTANTS.CLASSES.NOTICE_BLOCK_FOLDED;
    for (const el of group.elements) {
      el.classList.toggle(foldedClass, !expanded);
    }

    const isFlushBottom = bar.dataset.bpFoldAtBottom === "1" && !expanded;
    bar.classList.toggle(CONSTANTS.CLASSES.NOTICE_FOLD_BAR_FLUSH_BOTTOM, isFlushBottom);
    if (contentEl && bar.dataset.bpFoldAtBottom === "1") {
      contentEl.classList.toggle(CONSTANTS.CLASSES.NOTICE_BODY_FLUSH_BOTTOM, isFlushBottom);
    }
  }

  function createFoldBar(group, expanded, isBottomGroup, contentEl) {
    const bar = createEl("button", CONSTANTS.CLASSES.NOTICE_FOLD_BAR);
    bar.type = "button";
    bar.dataset.bpFoldAtBottom = isBottomGroup ? "1" : "0";

    const icon = createEl("span", "bp-notice-fold-icon", "▸");
    icon.setAttribute("aria-hidden", "true");

    bar.append(icon, createEl("span", "bp-notice-fold-label"));
    applyFoldGroupState(bar, group, expanded, contentEl);
    bar.addEventListener("click", () => {
      const nextExpanded = bar.getAttribute("aria-expanded") !== "true";
      applyFoldGroupState(bar, group, nextExpanded, contentEl);
    });

    return bar;
  }

  function renderNoticeBlockStates(contentEl, blockData, state, readHashes) {
    if (!contentEl) return;
    const readClass = CONSTANTS.CLASSES.NOTICE_BLOCK_READ;
    const foldedClass = CONSTANTS.CLASSES.NOTICE_BLOCK_FOLDED;
    const foldBarClass = CONSTANTS.CLASSES.NOTICE_FOLD_BAR;

    contentEl.classList.remove(CONSTANTS.CLASSES.NOTICE_BODY_FLUSH_BOTTOM);

    const expandedKeys = new Set();
    for (const oldBar of contentEl.querySelectorAll("." + foldBarClass)) {
      if (oldBar.getAttribute("aria-expanded") === "true" && oldBar.dataset.bpFoldKey) {
        expandedKeys.add(oldBar.dataset.bpFoldKey);
      }
      oldBar.remove();
    }

    for (const prev of contentEl.querySelectorAll(`.${readClass}, .${foldedClass}`)) {
      prev.classList.remove(readClass, foldedClass);
    }
    if (!state.hasMixedReadAndUnseen || blockData.collapsedToSingleHash) {
      return;
    }

    const readSet = new Set(Array.isArray(readHashes) ? readHashes : []);
    for (const entry of blockData.entries) {
      if (entry.element && readSet.has(entry.hash)) {
        entry.element.classList.add(readClass);
      }
    }

    const foldGroups = NoticeLogic.collectFoldGroups(contentEl, blockData.entries, readSet);
    for (const group of foldGroups) {
      const lastEl = group.elements[group.elements.length - 1];
      const isBottomGroup = Boolean(lastEl && !hasVisibleContentAfter(contentEl, lastEl));
      const bar = createFoldBar(group, expandedKeys.has(group.key), isBottomGroup, contentEl);
      group.anchor.before(bar);
    }
  }

  function renderNoticeFooter(parts, status, currentHashes, settings) {
    const { collapseBody } = parts;
    if (!collapseBody) return;

    const existing = collapseBody.querySelector("." + CONSTANTS.CLASSES.NOTICE_FOOTER);
    if (status === "empty") {
      existing?.remove();
      return;
    }

    const footer = existing || createEl("div", CONSTANTS.CLASSES.NOTICE_FOOTER);

    if (status === "read") {
      const statusText = createEl(
        "span",
        "bp-notice-footer-status",
        "✓ 確認済み（次回アクセス時は自動で折りたたまれます）"
      );
      const unackBtn = createEl("button", "bp-notice-unack-btn", "未読に戻す");
      unackBtn.type = "button";
      unackBtn.addEventListener("click", () => {
        settings.readNoticeBlocks = [];
        saveSettings(settings);
        syncNoticeSection(settings);
      });

      footer.replaceChildren(statusText, unackBtn);
    } else {
      const note = createEl(
        "span",
        "bp-notice-footer-note",
        "確認すると次回から折りたたまれます（新着や変更時は自動で再表示）"
      );
      const ackBtn = createEl("button", "bp-notice-ack-btn", "✓ 確認済みにする");
      ackBtn.type = "button";
      ackBtn.addEventListener("click", () => {
        settings.readNoticeBlocks = [...currentHashes];
        saveSettings(settings);
        syncNoticeSection(settings, { forceCollapse: true });
      });

      footer.replaceChildren(note, ackBtn);
    }

    if (!existing) collapseBody.appendChild(footer);
  }

  function syncNoticeSection(settings, { forceCollapse = false } = {}) {
    const parts = getNoticeParts();
    if (!parts) return;

    bindNoticeToggleFallback(parts);

    const blockData = NoticeLogic.extractBlockData(parts.contentEl);
    const currentHashes = blockData.hashes;
    const state = NoticeLogic.evaluateNoticeState(currentHashes, settings.readNoticeBlocks);

    if (state.shouldPrune) {
      settings.readNoticeBlocks = state.prunedReadHashes;
      saveSettings(settings);
    }

    const isFirstInit = !parts.noticeEl.dataset.bpNoticeInitialized;
    if (isFirstInit) {
      parts.noticeEl.dataset.bpNoticeInitialized = "1";
      setNoticeCollapsed(parts, state.status === "read" || state.status === "empty");
    } else if (forceCollapse) {
      setNoticeCollapsed(parts, true, { preferBootstrapClick: true });
    }

    renderNoticeBlockStates(parts.contentEl, blockData, state, settings.readNoticeBlocks);
    renderNoticeBadge(parts.toggleLink, state.status);
    renderNoticeFooter(parts, state.status, currentHashes, settings);
  }

  /* =====================================================================
   * レイアウト・編集モード・アプリケーション統合 (PortalApp)
   * ===================================================================== */
  function applyLayout(settings) {
    const portalCards = getAllServiceCards();
    if (mainRow && portalCards.length > 0) {
      if (!cardTemplate) cardTemplate = createCardTemplate(portalCards[0]);
      if (!Array.isArray(settings.customCards)) settings.customCards = [];
      const customCardEls = settings.customCards.map(createCustomCardElement).filter(Boolean);
      const allCards = [...portalCards, ...customCardEls];

      const knownIds = new Set(settings.order);
      for (const el of allCards) {
        if (!knownIds.has(el.id)) settings.order.push(el.id);
      }
      const allIds = new Set(allCards.map((el) => el.id));
      settings.order = settings.order.filter((id) => allIds.has(id));

      const cardById = new Map(allCards.map((el) => [el.id, el]));

      mainRow.parentElement.querySelector(".bp-hidden-section")?.remove();

      for (const el of allCards) {
        el.querySelector("." + CONSTANTS.CLASSES.EDIT_OVERLAY)?.remove();
        el.classList.remove(CONSTANTS.CLASSES.HIDDEN_ITEM);
        el.removeAttribute("draggable");
      }

      mainRow.replaceChildren();

      const hiddenSet = new Set(settings.hiddenIds);
      const onUpdate = () => applyLayout(settings);

      for (const id of settings.order) {
        const el = cardById.get(id);
        if (!el || hiddenSet.has(id)) continue;
        el.classList.add(CONSTANTS.CLASSES.SERVICE_CARD);
        el.setAttribute("draggable", "true");
        el.appendChild(createEditOverlay(el, settings, onUpdate));
        mainRow.appendChild(el);
      }

      mainRow.appendChild(createAddCardPlaceholder(settings, onUpdate));

      const hiddenCards = settings.order.filter((id) => hiddenSet.has(id) && cardById.has(id));
      if (hiddenCards.length > 0) {
        const { section, body } = createHiddenSection(hiddenCards.length);
        for (const id of hiddenCards) {
          const el = cardById.get(id);
          el.classList.add(CONSTANTS.CLASSES.SERVICE_CARD, CONSTANTS.CLASSES.HIDDEN_ITEM);
          el.appendChild(createEditOverlay(el, settings, onUpdate));
          body.appendChild(el);
        }
        mainRow.parentElement.appendChild(section);
      }

      // bp-onclick-change を window までバブリングさせるため、全カードをDOM配置した後に適用する
      for (const el of portalCards) {
        applyM365Redirect(el, settings);
      }
    }

    syncNoticeSection(settings);
    applyExtraHides(settings);
  }

  function createSettingsButton(settings) {
    const btn = createEl("button", "bp-settings-btn", "⚙");
    btn.type = "button";
    btn.title = "ポータルを編集";

    let resetBtn = null;

    const onUpdate = () => {
      applyLayout(settings);
      if (document.body.classList.contains(CONSTANTS.CLASSES.EDIT_MODE)) {
        setupTogglableElements(settings, onUpdate);
      }
    };

    function enterEditMode() {
      document.body.classList.add(CONSTANTS.CLASSES.EDIT_MODE);
      btn.classList.add("active");

      resetBtn = createEl("button", "bp-reset-btn", "設定をリセット");
      resetBtn.type = "button";
      resetBtn.addEventListener("click", () => {
        if (confirm("すべての設定をリセットしますか？\n（作成したオリジナルカードは削除されません）")) {
          const customCards = settings.customCards;
          Object.assign(settings, getDefaultSettings());
          settings.customCards = customCards;
          saveSettings(settings);
          hiddenSectionOpen = false;
          delete document.querySelector(CONSTANTS.SELECTOR.NOTICE_CARD)?.dataset.bpNoticeInitialized;
          exitEditMode();
          applyLayout(settings);
        }
      });
      document.body.appendChild(resetBtn);

      setupTogglableElements(settings, onUpdate);
    }

    function exitEditMode() {
      closeModal();
      document.body.classList.remove(CONSTANTS.CLASSES.EDIT_MODE);
      btn.classList.remove("active");
      if (resetBtn) {
        resetBtn.remove();
        resetBtn = null;
      }
      cleanupTogglableElements(settings);
    }

    btn.addEventListener("click", () => {
      if (document.body.classList.contains(CONSTANTS.CLASSES.EDIT_MODE)) {
        exitEditMode();
      } else {
        enterEditMode();
      }
    });

    document.body.appendChild(btn);
  }

  async function init() {
    // 万一の初期化エラー時にも最長2秒で必ずページを表示状態にするセーフティタイマー（FOUC対策のフェイルセーフ）
    const safetyTimer = setTimeout(() => {
      document.body?.classList.add(CONSTANTS.CLASSES.READY);
    }, 2000);

    try {
      mainRow = findServiceRow();
      const hasToggleTarget = TOGGLE_CONFIG.some((cfg) => cfg.find());
      if (!mainRow && !hasToggleTarget) {
        return;
      }

      const settings = await loadSettings();
      if (mainRow) {
        initDragAndDrop(settings);
      }
      applyLayout(settings);
      createSettingsButton(settings);
    } catch (err) {
      console.error("[Better Portal] Failed to initialize portal customizer:", err);
    } finally {
      clearTimeout(safetyTimer);
      document.body?.classList.add(CONSTANTS.CLASSES.READY);
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
