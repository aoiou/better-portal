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
    },
    EVENTS: {
      ONCLICK_CHANGE: "bp-onclick-change",
    },
    SELECTOR: {
      SERVICE_ROW: '.row:has([id^="div-"][class*="col-"] .service-thumb-wrap)',
      SERVICE_CARDS: '[id^="div-"][class*="col-"]:has(.service-thumb-wrap)',
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
      find: () => document.getElementById("PortalComment02"),
      showLabel: "お知らせを一番下に移動 を元に戻す",
      hideLabel: "お知らせを一番下に移動",
      apply(el, active) {
        if (!document.getElementById("bp-notice-anchor")) {
          const anchor = document.createElement("span");
          anchor.id = "bp-notice-anchor";
          anchor.hidden = true;
          el.before(anchor);
        }
        if (active) document.getElementById("div-container")?.appendChild(el);
        else document.getElementById("bp-notice-anchor")?.after(el);
      },
      revert(el, active) {
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
      m365RedirectUrl: "",
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
      m365RedirectUrl: typeof raw.m365RedirectUrl === "string" ? raw.m365RedirectUrl.trim() : defaults.m365RedirectUrl,
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
   * URLユーティリティ & M365サービス (UrlUtils & M365Service)
   * ===================================================================== */
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

  function buildM365Onclick(originalOnclick, inputUrl) {
    let trimmed = inputUrl.trim();
    if (!trimmed || !originalOnclick) return originalOnclick;
    if (!/^https?:\/\//i.test(trimmed)) {
      trimmed = "https://" + trimmed;
    }
    if (/^https?:\/\/login\.microsoftonline\.com\//i.test(trimmed) || !/[?&]wreply=/i.test(originalOnclick)) {
      const escaped = trimmed.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
      return originalOnclick.replace(/https?:\/\/[^'"]+/i, () => escaped);
    }
    return originalOnclick.replace(/([?&]wreply=)[^'&"]+/i, (_match, p1) => p1 + encodeURIComponent(trimmed));
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
    const targetOnclick = customUrl
      ? buildM365Onclick(originalOnclick, customUrl)
      : originalOnclick;

    if (link.getAttribute("onclick") !== targetOnclick) {
      link.dataset.bpOnclick = targetOnclick;
      link.dispatchEvent(new CustomEvent(CONSTANTS.EVENTS.ONCLICK_CHANGE, { bubbles: true }));
    }
  }

  /* =====================================================================
   * モーダルダイアログ基盤 (Modal Dialog Framework - DRY & A11y)
   * ===================================================================== */
  function closeModal() {
    if (!activeModal) return;
    document.removeEventListener("keydown", activeModal.onKeydown, true);
    activeModal.backdrop.remove();
    activeModal = null;
  }

  function createModalFrame({ title, ariaLabel, submitText, onRenderBody, onSubmit }) {
    closeModal();

    const make = (tag, className, text) => {
      const el = document.createElement(tag);
      if (className) el.className = className;
      if (text != null) el.textContent = text;
      return el;
    };

    const backdrop = make("div", "bp-modal-backdrop");
    const dialog = make("div", "bp-modal-dialog");
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-modal", "true");
    dialog.setAttribute("aria-label", ariaLabel || title);

    const form = make("form", "bp-modal-form");
    form.noValidate = true;
    form.appendChild(make("h3", "bp-modal-title", title));

    const errorEl = make("p", "bp-modal-error");

    const makeField = (labelText, input, hint) => {
      const field = make("label", "bp-modal-field");
      field.appendChild(make("span", "bp-modal-label", labelText));
      field.appendChild(input);
      if (hint) field.appendChild(make("span", "bp-modal-hint", hint));
      return field;
    };

    onRenderBody({ form, make, makeField, errorEl });
    form.appendChild(errorEl);

    const actions = make("div", "bp-modal-actions");
    const cancelBtn = make("button", "bp-btn bp-btn-cancel", "キャンセル");
    cancelBtn.type = "button";
    const saveBtn = make("button", "bp-btn bp-btn-save", submitText || "保存");
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
            'button:not([disabled]), input:not([disabled]):not([hidden]), [tabindex]:not([tabindex="-1"])'
          )
        ).filter((el) => el.offsetParent !== null);
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

  function openM365UrlModal(currentUrl, onSave) {
    let urlInput = null;
    createModalFrame({
      title: "Microsoft365の遷移先設定",
      ariaLabel: "Microsoft365の遷移先URLを設定",
      submitText: "保存",
      onRenderBody({ form, make, makeField }) {
        urlInput = make("input", "bp-modal-input");
        urlInput.type = "text";
        urlInput.inputMode = "url";
        urlInput.maxLength = 2000;
        urlInput.placeholder = "例: https://doshishaacjp-my.sharepoint.com/my";
        urlInput.value = currentUrl || "";

        form.appendChild(
          makeField(
            "遷移先URL",
            urlInput,
            "「https://」は省略できます。空欄で保存するとデフォルトに戻ります。"
          )
        );
      },
      onSubmit({ errorEl, closeModal: closeFn }) {
        const raw = urlInput.value.trim();
        if (!raw) {
          closeFn();
          onSave("");
          return;
        }
        const validated = normalizeUrl(raw);
        if (!validated) {
          errorEl.textContent = "有効なURL（http:// または https://）を入力してください。";
          urlInput.focus();
          return;
        }
        closeFn();
        onSave(validated);
      },
    });

    urlInput?.focus();
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
    const wrap = document.createElement("div");
    wrap.className = forPreview ? "bp-custom-icon" : "service-thumb-img bp-custom-icon";

    const imageUrl = iconType === "url" ? normalizeUrl(iconValue) : null;
    if (iconType === "emoji" && iconValue?.trim()) {
      const emoji = document.createElement("span");
      emoji.className = "bp-card-emoji";
      emoji.textContent = iconValue.trim();
      wrap.appendChild(emoji);
    } else if (imageUrl) {
      const img = document.createElement("img");
      img.className = "bp-card-image";
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
      const previewTitle = document.createElement("span");
      previewTitle.className = "bp-preview-title";
      previewTitle.textContent = title;
      previewCard.replaceChildren(createIconElement(type, value, true), previewTitle);
    }

    const { form, errorEl } = createModalFrame({
      title: card ? "オリジナルカードを編集" : "オリジナルカードを追加",
      ariaLabel: card ? "オリジナルカードを編集" : "オリジナルカードを追加",
      submitText: card ? "保存" : "追加",
      onRenderBody({ form: modalForm, make, makeField }) {
        titleInput = make("input", "bp-modal-input");
        titleInput.type = "text";
        titleInput.maxLength = 40;
        titleInput.placeholder = "例: Google Classroom";
        titleInput.value = card?.title || "";

        urlInput = make("input", "bp-modal-input");
        urlInput.type = "text";
        urlInput.inputMode = "url";
        urlInput.maxLength = 2000;
        urlInput.placeholder = "例: https://classroom.google.com/";
        urlInput.value = card?.url || "";

        modalForm.appendChild(makeField("タイトル", titleInput));
        modalForm.appendChild(makeField("URL", urlInput, "「https://」は省略できます"));

        const iconField = make("div", "bp-modal-field");
        iconField.appendChild(make("span", "bp-modal-label", "アイコン"));
        const radioRow = make("div", "bp-modal-radio-row");
        for (const [value, text] of [["default", "デフォルト"], ["emoji", "絵文字"], ["url", "画像URL"]]) {
          const label = make("label", "bp-modal-radio");
          const radio = make("input");
          radio.type = "radio";
          radio.name = radioName;
          radio.value = value;
          radios[value] = radio;
          label.append(radio, make("span", null, text));
          radioRow.appendChild(label);
        }
        iconField.appendChild(radioRow);

        emojiInput = make("input", "bp-modal-input bp-modal-emoji-input");
        emojiInput.type = "text";
        emojiInput.maxLength = 16;
        emojiInput.placeholder = "例: 📚";

        iconUrlInput = make("input", "bp-modal-input");
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

        const previewField = make("div", "bp-modal-field");
        previewField.appendChild(make("span", "bp-modal-label", "プレビュー"));
        previewCard = make("div", "bp-preview-card");
        previewField.appendChild(previewCard);
        modalForm.appendChild(previewField);
      },
      onSubmit({ errorEl: errEl, closeModal: closeFn }) {
        const title = titleInput.value.trim();
        const url = normalizeUrl(urlInput.value);
        const iconType = getIconType();
        const iconValue = getIconValue(iconType);

        let error = "";
        let focusTarget = null;
        if (!title) [error, focusTarget] = ["タイトルを入力してください。", titleInput];
        else if (!url) [error, focusTarget] = ["有効なURL（http:// または https://）を入力してください。", urlInput];
        else if (iconType === "emoji" && !iconValue) [error, focusTarget] = ["絵文字を入力してください。", emojiInput];
        else if (iconType === "url" && !normalizeUrl(iconValue)) [error, focusTarget] = ["有効な画像URL（http:// または https://）を入力してください。", iconUrlInput];
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
          iconValue: iconType === "url" ? normalizeUrl(iconValue) : iconValue,
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
    const col = document.createElement("div");
    col.className = cardTemplate?.className || "";
    col.classList.add("bp-add-card-col");

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "bp-add-card-btn";
    btn.draggable = false;
    const plus = document.createElement("span");
    plus.className = "bp-add-card-plus";
    plus.textContent = "＋";
    const label = document.createElement("span");
    label.className = "bp-add-card-label";
    label.textContent = "新規カードを追加";
    btn.append(plus, label);

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
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "bp-btn " + className;
    btn.draggable = false;
    btn.textContent = text;
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

    const wrapper = document.createElement("div");
    wrapper.className = CONSTANTS.CLASSES.TOGGLE_OVERLAY;

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
    const overlay = document.createElement("div");
    overlay.className = CONSTANTS.CLASSES.EDIT_OVERLAY;

    const id = el.id;
    const isHidden = settings.hiddenIds.includes(id);
    const customCard = el.classList.contains(CONSTANTS.CLASSES.CUSTOM_CARD) ? findCustomCard(settings, id) : null;

    const createCustomCardButtons = () => {
      const row = document.createElement("div");
      row.className = "bp-move-row";
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

      const moveRow = document.createElement("div");
      moveRow.className = "bp-move-row";

      const upBtn = createButton("bp-btn-up", "▲", () => {
        const newOrder = OrderLogic.calcMoveOrder(settings.order, settings.hiddenIds, id, -1);
        if (newOrder) {
          settings.order = newOrder;
          saveSettings(settings);
          onUpdate();
        }
      });
      upBtn.title = "上に移動";

      const downBtn = createButton("bp-btn-down", "▼", () => {
        const newOrder = OrderLogic.calcMoveOrder(settings.order, settings.hiddenIds, id, 1);
        if (newOrder) {
          settings.order = newOrder;
          saveSettings(settings);
          onUpdate();
        }
      });
      downBtn.title = "下に移動";

      moveRow.appendChild(upBtn);
      moveRow.appendChild(downBtn);
      overlay.appendChild(moveRow);

      if (customCard) overlay.appendChild(createCustomCardButtons());

      if (isM365Card(el)) {
        const hasCustomUrl = Boolean(settings.m365RedirectUrl?.trim());
        const linkBtn = createButton(
          "bp-btn-link",
          hasCustomUrl ? "リンク先変更 (設定済)" : "リンク先を変更",
          () => {
            openM365UrlModal(settings.m365RedirectUrl || "", (newUrl) => {
              settings.m365RedirectUrl = newUrl;
              saveSettings(settings);
              onUpdate();
            });
          }
        );
        if (hasCustomUrl) {
          linkBtn.title = "現在の設定: " + settings.m365RedirectUrl;
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
    const section = document.createElement("div");
    section.className = "bp-hidden-section" + (hiddenSectionOpen ? " open" : "");
    const makeEl = (tag, className, text) => {
      const el = document.createElement(tag);
      if (className) el.className = className;
      if (text != null) el.textContent = String(text);
      return el;
    };

    const header = makeEl("div", "bp-hidden-header");
    const label = makeEl("span");
    label.append(
      makeEl("span", "bp-hidden-title", "非表示の項目"),
      makeEl("span", "bp-hidden-count", count)
    );
    header.append(label, makeEl("span", "bp-hidden-arrow", "▼"));

    const body = makeEl("div", "bp-hidden-body");
    section.append(header, body);

    header.addEventListener("click", () => {
      section.classList.toggle("open");
      hiddenSectionOpen = section.classList.contains("open");
    });

    return { section, body };
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
        applyM365Redirect(el, settings);
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
    }

    applyExtraHides(settings);
  }

  function createSettingsButton(settings) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "bp-settings-btn";
    btn.textContent = "⚙";
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

      resetBtn = document.createElement("button");
      resetBtn.type = "button";
      resetBtn.className = "bp-reset-btn";
      resetBtn.textContent = "設定をリセット";
      resetBtn.addEventListener("click", () => {
        if (confirm("すべての設定をリセットしますか？\n（作成したオリジナルカードは削除されません）")) {
          const customCards = settings.customCards;
          Object.assign(settings, getDefaultSettings());
          settings.customCards = customCards;
          saveSettings(settings);
          hiddenSectionOpen = false;
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
