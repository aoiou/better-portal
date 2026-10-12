(function () {
  "use strict";

  const STORAGE_KEY = "betterPortalSettings";
  let mainRow = null;
  let hiddenSectionOpen = false;
  let draggedCardId = null;

  const TOGGLE_CONFIG = [
    { key: "hideNavbar", find: () => document.querySelector("nav.navbar"), showLabel: "ナビバー を表示する", hideLabel: "ナビバー を非表示にする" },
    { key: "hideSubNav", find: () => document.querySelector(".sub-nav"), showLabel: "サブナビ を表示する", hideLabel: "サブナビ を非表示にする" },
    { key: "hidePageTitle", find: () => document.querySelector(".page-title"), showLabel: "「アカウント」帯 を表示する", hideLabel: "「アカウント」帯 を非表示にする" },
    { key: "hideSearchBar", find: () => document.getElementById("filterValue")?.closest(".row"), showLabel: "検索欄 を表示する", hideLabel: "検索欄 を非表示にする" },
  ];

  const storage = globalThis.browser?.storage?.local ?? globalThis.chrome?.storage?.local;

  function getDefaultSettings() {
    return { hiddenIds: [], order: [], hideNavbar: false, hidePageTitle: false, hideSearchBar: false, hideSubNav: false, noticeToBottom: false };
  }

  async function loadSettings() {
    if (!storage) return getDefaultSettings();
    try {
      const result = await storage.get(STORAGE_KEY);
      return result[STORAGE_KEY] || getDefaultSettings();
    } catch {
      return getDefaultSettings();
    }
  }

  function saveSettings(settings) {
    storage?.set({ [STORAGE_KEY]: settings });
  }

  function getAllServiceCards() {
    return [...document.querySelectorAll('[id^="div-"][class*="col-"]')];
  }

  function createButton(className, text, onClick) {
    const btn = document.createElement("button");
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

  function ensureNoticeAnchor(notice) {
    if (!document.getElementById("bp-notice-anchor")) {
      const anchor = document.createElement("span");
      anchor.id = "bp-notice-anchor";
      anchor.hidden = true;
      notice.before(anchor);
    }
  }

  function applyExtraHides(settings) {
    if (document.body.classList.contains("bp-edit-mode")) return;

    for (const { key, find } of TOGGLE_CONFIG) {
      const el = find();
      if (el) el.style.display = settings[key] ? "none" : "";
    }

    const notice = document.getElementById("PortalComment02");
    if (notice) {
      ensureNoticeAnchor(notice);
      if (settings.noticeToBottom) {
        document.getElementById("div-container")?.appendChild(notice);
      } else {
        document.getElementById("bp-notice-anchor")?.after(notice);
      }
    }
  }

  function createOverlay(targetEl, settingKey, settings, onUpdate, activeLabel, inactiveLabel) {
    targetEl.querySelector(".bp-toggle-overlay")?.remove();

    const wrapper = document.createElement("div");
    wrapper.className = "bp-toggle-overlay";

    const isActive = settings[settingKey];
    wrapper.appendChild(createButton(
      isActive ? "bp-btn-show" : "bp-btn-hide",
      isActive ? activeLabel : inactiveLabel,
      () => {
        settings[settingKey] = !settings[settingKey];
        saveSettings(settings);
        onUpdate();
      }
    ));

    targetEl.style.position = "relative";
    targetEl.appendChild(wrapper);
  }

  function setupTogglableElements(settings, onUpdate) {
    for (const { key, find, showLabel, hideLabel } of TOGGLE_CONFIG) {
      const el = find();
      if (!el) continue;
      if (settings[key]) el.style.display = "";
      createOverlay(el, key, settings, onUpdate, showLabel, hideLabel);
    }

    const notice = document.getElementById("PortalComment02");
    if (notice) {
      if (settings.noticeToBottom) {
        document.getElementById("bp-notice-anchor")?.after(notice);
      }
      createOverlay(notice, "noticeToBottom", settings, onUpdate, "お知らせを一番下に移動 を元に戻す", "お知らせを一番下に移動");
    }
  }

  function cleanupTogglableElements(settings) {
    document.querySelectorAll(".bp-toggle-overlay").forEach((el) => el.remove());
    applyExtraHides(settings);
  }

  function findServiceRow() {
    return document.querySelector('.row:has([id^="div-"][class*="col-"])');
  }

  function createEditOverlay(el, settings, onUpdate) {
    const overlay = document.createElement("div");
    overlay.className = "bp-edit-overlay";

    const id = el.id;
    const isHidden = settings.hiddenIds.includes(id);

    if (isHidden) {
      overlay.appendChild(createButton("bp-btn-show", "表示する", () => {
        settings.hiddenIds = settings.hiddenIds.filter((hid) => hid !== id);
        saveSettings(settings);
        onUpdate();
      }));
    } else {
      overlay.appendChild(createButton("bp-btn-hide", "非表示にする", () => {
        settings.hiddenIds.push(id);
        saveSettings(settings);
        onUpdate();
      }));

      const moveRow = document.createElement("div");
      moveRow.className = "bp-move-row";

      const upBtn = createButton("bp-btn-up", "▲", () => {
        moveCard(id, -1, settings);
        onUpdate();
      });
      upBtn.title = "上に移動";

      const downBtn = createButton("bp-btn-down", "▼", () => {
        moveCard(id, 1, settings);
        onUpdate();
      });
      downBtn.title = "下に移動";

      moveRow.appendChild(upBtn);
      moveRow.appendChild(downBtn);
      overlay.appendChild(moveRow);
    }

    return overlay;
  }

  function moveCard(cardId, direction, settings) {
    const order = settings.order;
    const idx = order.indexOf(cardId);
    if (idx < 0) return;

    const visibleOrder = order.filter((id) => !settings.hiddenIds.includes(id));
    const visibleIdx = visibleOrder.indexOf(cardId);
    if (visibleIdx < 0) return;

    const newVisibleIdx = visibleIdx + direction;
    if (newVisibleIdx < 0 || newVisibleIdx >= visibleOrder.length) return;

    const swapId = visibleOrder[newVisibleIdx];
    const swapIdx = order.indexOf(swapId);
    order[idx] = swapId;
    order[swapIdx] = cardId;

    settings.order = order;
    saveSettings(settings);
  }

  function reorderByDrag(draggedId, targetId, insertBefore, settings) {
    const order = settings.order.slice();
    const dragIdx = order.indexOf(draggedId);
    if (dragIdx < 0) return;

    order.splice(dragIdx, 1);

    let targetIdx = order.indexOf(targetId);
    if (targetIdx < 0) return;

    if (!insertBefore) targetIdx++;

    order.splice(targetIdx, 0, draggedId);

    settings.order = order;
    saveSettings(settings);
  }

  function clearDropIndicators() {
    mainRow?.querySelectorAll(".bp-drop-before, .bp-drop-after")
      .forEach((el) => el.classList.remove("bp-drop-before", "bp-drop-after"));
  }

  function initDragAndDrop(settings) {
    mainRow.addEventListener("dragstart", (e) => {
      const card = e.target.closest(".bp-service-card");
      if (!card || !document.body.classList.contains("bp-edit-mode")) {
        e.preventDefault();
        return;
      }
      draggedCardId = card.id;
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", card.id);
      requestAnimationFrame(() => card.classList.add("bp-dragging"));
    });

    mainRow.addEventListener("dragend", (e) => {
      const card = e.target.closest(".bp-service-card");
      if (card) card.classList.remove("bp-dragging");
      clearDropIndicators();
      draggedCardId = null;
    });

    mainRow.addEventListener("dragover", (e) => {
      if (!draggedCardId) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";

      const card = e.target.closest(".bp-service-card");
      if (!card || draggedCardId === card.id) return;

      clearDropIndicators();
      const rect = card.getBoundingClientRect();
      const midX = rect.left + rect.width / 2;
      card.classList.add(e.clientX < midX ? "bp-drop-before" : "bp-drop-after");
    });

    mainRow.addEventListener("dragleave", (e) => {
      const card = e.target.closest(".bp-service-card");
      if (card) card.classList.remove("bp-drop-before", "bp-drop-after");
    });

    mainRow.addEventListener("drop", (e) => {
      if (!draggedCardId) return;
      e.preventDefault();

      const card = e.target.closest(".bp-service-card");
      const shouldReorder = card && draggedCardId !== card.id;

      if (shouldReorder) {
        const rect = card.getBoundingClientRect();
        const midX = rect.left + rect.width / 2;
        reorderByDrag(draggedCardId, card.id, e.clientX < midX, settings);
      }

      clearDropIndicators();
      draggedCardId = null;
      if (shouldReorder) applyLayout(settings);
    });
  }

  function createHiddenSection() {
    const section = document.createElement("div");
    section.className = "bp-hidden-section";
    if (hiddenSectionOpen) section.classList.add("open");

    const header = document.createElement("div");
    header.className = "bp-hidden-header";

    const title = document.createElement("span");
    title.className = "bp-hidden-title";
    title.textContent = "非表示の項目";

    const countBadge = document.createElement("span");
    countBadge.className = "bp-hidden-count";
    countBadge.textContent = "0";

    const arrow = document.createElement("span");
    arrow.className = "bp-hidden-arrow";
    arrow.textContent = "▼";

    const titleWrap = document.createElement("span");
    titleWrap.appendChild(title);
    titleWrap.appendChild(countBadge);

    header.appendChild(titleWrap);
    header.appendChild(arrow);

    header.addEventListener("click", () => {
      section.classList.toggle("open");
      hiddenSectionOpen = section.classList.contains("open");
    });

    const body = document.createElement("div");
    body.className = "bp-hidden-body";

    section.appendChild(header);
    section.appendChild(body);

    return { section, body, countBadge };
  }

  function applyLayout(settings) {
    const allCards = getAllServiceCards();
    if (!mainRow || allCards.length === 0) return;

    const knownIds = new Set(settings.order);
    for (const el of allCards) {
      if (!knownIds.has(el.id)) settings.order.push(el.id);
    }
    const allIds = new Set(allCards.map((el) => el.id));
    settings.order = settings.order.filter((id) => allIds.has(id));

    const cardById = new Map(allCards.map((el) => [el.id, el]));

    mainRow.parentElement.querySelector(".bp-hidden-section")?.remove();

    for (const el of allCards) {
      el.querySelector(".bp-edit-overlay")?.remove();
      el.classList.remove("bp-hidden-item");
      el.removeAttribute("draggable");
      el.style.display = "";
    }

    mainRow.replaceChildren();

    const { section, body: hiddenBody, countBadge } = createHiddenSection();

    const hiddenSet = new Set(settings.hiddenIds);
    const visibleIds = settings.order.filter((id) => !hiddenSet.has(id));
    const hiddenIds = settings.order.filter((id) => hiddenSet.has(id));

    const onUpdate = () => applyLayout(settings);

    for (const id of visibleIds) {
      const el = cardById.get(id);
      if (!el) continue;
      el.classList.add("bp-service-card");
      el.setAttribute("draggable", "true");
      el.appendChild(createEditOverlay(el, settings, onUpdate));
      mainRow.appendChild(el);
    }

    for (const id of hiddenIds) {
      const el = cardById.get(id);
      if (!el) continue;
      el.classList.add("bp-service-card", "bp-hidden-item");
      el.appendChild(createEditOverlay(el, settings, onUpdate));
      hiddenBody.appendChild(el);
    }

    countBadge.textContent = hiddenIds.length;

    if (hiddenIds.length > 0) {
      mainRow.parentElement.appendChild(section);
    }

    applyExtraHides(settings);
  }

  function createSettingsButton(settings) {
    const btn = document.createElement("button");
    btn.className = "bp-settings-btn";
    btn.textContent = "⚙";
    btn.title = "ポータルを編集";

    let resetBtn = null;

    const onUpdate = () => {
      applyLayout(settings);
      if (document.body.classList.contains("bp-edit-mode")) {
        setupTogglableElements(settings, onUpdate);
      }
    };

    function enterEditMode() {
      document.body.classList.add("bp-edit-mode");
      btn.classList.add("active");

      resetBtn = document.createElement("button");
      resetBtn.className = "bp-reset-btn";
      resetBtn.textContent = "設定をリセット";
      resetBtn.addEventListener("click", () => {
        if (confirm("すべての設定をリセットしますか？")) {
          Object.assign(settings, getDefaultSettings());
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
      document.body.classList.remove("bp-edit-mode");
      btn.classList.remove("active");
      if (resetBtn) {
        resetBtn.remove();
        resetBtn = null;
      }
      cleanupTogglableElements(settings);
    }

    btn.addEventListener("click", () => {
      if (document.body.classList.contains("bp-edit-mode")) {
        exitEditMode();
      } else {
        enterEditMode();
      }
    });

    document.body.appendChild(btn);
  }

  async function init() {
    mainRow = findServiceRow();
    if (!mainRow) return;

    const settings = await loadSettings();
    initDragAndDrop(settings);
    applyLayout(settings);
    createSettingsButton(settings);
    document.body.classList.add("bp-ready");
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
