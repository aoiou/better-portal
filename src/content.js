(function () {
  "use strict";

  const STORAGE_KEY = "betterPortalSettings";
  let mainRow = null;
  let hiddenSectionOpen = false;
  let dragState = null;
  let noticeOriginalParent = null;
  let noticeOriginalNext = null;

  const TOGGLE_CONFIG = [
    { key: "hideNavbar", find: () => document.querySelector("nav.navbar"), showLabel: "ナビバー を表示する", hideLabel: "ナビバー を非表示にする" },
    { key: "hideSubNav", find: () => document.querySelector(".sub-nav"), showLabel: "サブナビ を表示する", hideLabel: "サブナビ を非表示にする" },
    { key: "hidePageTitle", find: () => document.querySelector(".page-title"), showLabel: "「アカウント」帯 を表示する", hideLabel: "「アカウント」帯 を非表示にする" },
    { key: "hideSearchBar", find: () => { const input = document.getElementById("filterValue"); return input ? input.closest(".row") : null; }, showLabel: "検索欄 を表示する", hideLabel: "検索欄 を非表示にする" },
  ];

  function getDefaultSettings() {
    return { hiddenIds: [], order: [], hideNavbar: false, hidePageTitle: false, hideSearchBar: false, hideSubNav: false, noticeToBottom: false };
  }

  function loadSettings() {
    return new Promise((resolve) => {
      if (typeof browser !== "undefined" && browser.storage && browser.storage.local) {
        browser.storage.local.get(STORAGE_KEY, (result) => {
          resolve(result[STORAGE_KEY] || getDefaultSettings());
        });
      } else {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) {
          try { resolve(JSON.parse(raw)); } catch (_) { resolve(getDefaultSettings()); }
        } else {
          resolve(getDefaultSettings());
        }
      }
    });
  }

  function saveSettings(settings) {
    if (typeof browser !== "undefined" && browser.storage && browser.storage.local) {
      browser.storage.local.set({ [STORAGE_KEY]: settings });
    } else {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    }
  }

  function getAllServiceCards() {
    const cards = [];
    let i = 1;
    while (true) {
      const el = document.getElementById("div-" + i);
      if (!el) break;
      const spanEl = document.getElementById("span-" + i);
      const name = spanEl ? spanEl.textContent.trim() : "Service " + i;
      cards.push({ id: "div-" + i, index: i, name: name, element: el });
      i++;
    }
    return cards;
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

  function applyExtraHides(settings) {
    if (document.body.classList.contains("bp-edit-mode")) return;

    for (const { key, find } of TOGGLE_CONFIG) {
      const el = find();
      if (el) el.style.display = settings[key] ? "none" : "";
    }

    const notice = document.getElementById("PortalComment02");
    if (notice) {
      if (!noticeOriginalParent) {
        noticeOriginalParent = notice.parentElement;
        noticeOriginalNext = notice.nextElementSibling;
      }
      if (settings.noticeToBottom) {
        const container = document.getElementById("div-container");
        if (container) container.appendChild(notice);
      } else if (noticeOriginalParent) {
        noticeOriginalParent.insertBefore(notice, noticeOriginalNext);
      }
    }
  }

  function createOverlay(targetEl, settingKey, settings, onUpdate, activeLabel, inactiveLabel) {
    let wrapper = targetEl.querySelector(".bp-toggle-overlay");
    if (wrapper) wrapper.remove();

    wrapper = document.createElement("div");
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
      if (settings.noticeToBottom && noticeOriginalNext) {
        noticeOriginalParent.insertBefore(notice, noticeOriginalNext);
      }
      createOverlay(notice, "noticeToBottom", settings, onUpdate, "お知らせを一番下に移動 を元に戻す", "お知らせを一番下に移動");
    }
  }

  function cleanupTogglableElements(settings) {
    document.querySelectorAll(".bp-toggle-overlay").forEach((el) => el.remove());
    applyExtraHides(settings);
  }

  function findServiceRow() {
    const rows = document.querySelectorAll(".row");
    for (const row of rows) {
      if (row.querySelector('[id^="div-"][class*="col-"]')) {
        return row;
      }
    }
    return null;
  }

  function createEditOverlay(card, settings, onUpdate) {
    const overlay = document.createElement("div");
    overlay.className = "bp-edit-overlay";

    const isHidden = settings.hiddenIds.includes(card.id);

    if (isHidden) {
      overlay.appendChild(createButton("bp-btn-show", "表示する", () => {
        settings.hiddenIds = settings.hiddenIds.filter((id) => id !== card.id);
        saveSettings(settings);
        onUpdate();
      }));
    } else {
      overlay.appendChild(createButton("bp-btn-hide", "非表示にする", () => {
        settings.hiddenIds.push(card.id);
        saveSettings(settings);
        onUpdate();
      }));

      const moveRow = document.createElement("div");
      moveRow.className = "bp-move-row";

      const upBtn = createButton("bp-btn-up", "▲", () => {
        moveCard(card.id, -1, settings);
        onUpdate();
      });
      upBtn.title = "上に移動";

      const downBtn = createButton("bp-btn-down", "▼", () => {
        moveCard(card.id, 1, settings);
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

    const visibleOrder = order.filter(
      (id) => !settings.hiddenIds.includes(id)
    );
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

    if (!insertBefore) {
      targetIdx++;
    }

    order.splice(targetIdx, 0, draggedId);

    settings.order = order;
    saveSettings(settings);
  }

  function clearDropIndicators() {
    if (!mainRow) return;
    mainRow
      .querySelectorAll(".bp-drop-before, .bp-drop-after")
      .forEach((el) => {
        el.classList.remove("bp-drop-before", "bp-drop-after");
      });
  }

  function setupDragAndDrop(settings) {
    if (!mainRow) return;

    const visibleCards = Array.from(
      mainRow.querySelectorAll(".bp-service-card")
    );

    for (const card of visibleCards) {
      card.setAttribute("draggable", "true");

      card.addEventListener("dragstart", (e) => {
        if (!document.body.classList.contains("bp-edit-mode")) {
          e.preventDefault();
          return;
        }
        dragState = { cardId: card.id };
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", card.id);
        requestAnimationFrame(() => {
          card.classList.add("bp-dragging");
        });
      });

      card.addEventListener("dragend", () => {
        card.classList.remove("bp-dragging");
        clearDropIndicators();
        dragState = null;
      });

      card.addEventListener("dragover", (e) => {
        if (!dragState || dragState.cardId === card.id) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";

        clearDropIndicators();

        const rect = card.getBoundingClientRect();
        const midX = rect.left + rect.width / 2;
        if (e.clientX < midX) {
          card.classList.add("bp-drop-before");
        } else {
          card.classList.add("bp-drop-after");
        }
      });

      card.addEventListener("dragleave", () => {
        card.classList.remove("bp-drop-before", "bp-drop-after");
      });

      card.addEventListener("drop", (e) => {
        e.preventDefault();
        if (!dragState || dragState.cardId === card.id) return;

        const rect = card.getBoundingClientRect();
        const midX = rect.left + rect.width / 2;
        const insertBefore = e.clientX < midX;

        reorderByDrag(dragState.cardId, card.id, insertBefore, settings);
        clearDropIndicators();
        dragState = null;
        applyLayout(settings);
      });
    }

    mainRow.addEventListener("dragover", (e) => {
      if (!dragState) return;
      e.preventDefault();
    });

    mainRow.addEventListener("drop", (e) => {
      if (!dragState) return;
      e.preventDefault();
      clearDropIndicators();
    });
  }

  function createHiddenSection() {
    const section = document.createElement("div");
    section.className = "bp-hidden-section";
    if (hiddenSectionOpen) {
      section.classList.add("open");
    }

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

    if (settings.order.length === 0) {
      settings.order = allCards.map((c) => c.id);
      saveSettings(settings);
    }

    const knownIds = new Set(settings.order);
    for (const card of allCards) {
      if (!knownIds.has(card.id)) {
        settings.order.push(card.id);
      }
    }
    settings.order = settings.order.filter((id) =>
      allCards.some((c) => c.id === id)
    );

    const cardMap = {};
    for (const card of allCards) {
      cardMap[card.id] = card;
    }

    const existingHiddenSection = mainRow.parentElement.querySelector(
      ".bp-hidden-section"
    );
    if (existingHiddenSection) {
      existingHiddenSection.remove();
    }

    for (const card of allCards) {
      const existingOverlay = card.element.querySelector(".bp-edit-overlay");
      if (existingOverlay) existingOverlay.remove();
      card.element.classList.remove("bp-hidden-item");
      card.element.removeAttribute("draggable");
      card.element.style.display = "";
    }

    mainRow.replaceChildren();

    const { section, body: hiddenBody, countBadge } = createHiddenSection();

    const visibleIds = settings.order.filter(
      (id) => !settings.hiddenIds.includes(id)
    );
    const hiddenIds = settings.order.filter((id) =>
      settings.hiddenIds.includes(id)
    );

    const onUpdate = () => applyLayout(settings);

    for (const id of visibleIds) {
      const card = cardMap[id];
      if (!card) continue;
      card.element.classList.add("bp-service-card");
      const overlay = createEditOverlay(card, settings, onUpdate);
      card.element.appendChild(overlay);
      mainRow.appendChild(card.element);
    }

    for (const id of hiddenIds) {
      const card = cardMap[id];
      if (!card) continue;
      card.element.classList.add("bp-service-card", "bp-hidden-item");
      const overlay = createEditOverlay(card, settings, onUpdate);
      card.element.appendChild(overlay);
      hiddenBody.appendChild(card.element);
    }

    countBadge.textContent = hiddenIds.length;

    if (hiddenIds.length > 0) {
      mainRow.parentElement.appendChild(section);
    }

    setupDragAndDrop(settings);
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
          const defaults = getDefaultSettings();
          Object.assign(settings, defaults);
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
