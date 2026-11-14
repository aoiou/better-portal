(() => {
  "use strict";

  const BP = (globalThis.BetterPortal = globalThis.BetterPortal || {});
  const { CONSTANTS, DomUtils, NoticeLogic, Storage } = BP;

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
      if (
        !collapseBody.classList.contains("collapsing") &&
        collapseBody.classList.contains("show") === wasShown
      ) {
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
    const bar = DomUtils.createEl("button", CONSTANTS.CLASSES.NOTICE_FOLD_BAR);
    bar.type = "button";
    bar.dataset.bpFoldAtBottom = isBottomGroup ? "1" : "0";

    const icon = DomUtils.createEl("span", "bp-notice-fold-icon", "▸");
    icon.setAttribute("aria-hidden", "true");

    bar.append(icon, DomUtils.createEl("span", "bp-notice-fold-label"));
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
    for (let i = 0; i < foldGroups.length; i++) {
      const group = foldGroups[i];
      const lastEl = group.elements[group.elements.length - 1];
      // 後続グループが存在する場合はその折りたたみバーが下に続くため最下部判定は最終グループのみで十分
      const isBottomGroup =
        i === foldGroups.length - 1 && Boolean(lastEl && !hasVisibleContentAfter(contentEl, lastEl));
      const bar = createFoldBar(group, expandedKeys.has(group.key), isBottomGroup, contentEl);
      group.anchor.before(bar);
    }
  }

  function renderNoticeFooter(parts, status, currentHashes, settings) {
    const { collapseBody, toggleLink } = parts;
    if (!collapseBody) return;

    const existing = collapseBody.querySelector("." + CONSTANTS.CLASSES.NOTICE_FOOTER);
    if (status === "empty") {
      existing?.remove();
      return;
    }

    const footer = existing || DomUtils.createEl("div", CONSTANTS.CLASSES.NOTICE_FOOTER);

    if (status === "read") {
      const statusText = DomUtils.createEl(
        "span",
        "bp-notice-footer-status",
        "✓ 確認済み（次回アクセス時は自動で折りたたまれます）"
      );
      const unackBtn = DomUtils.createEl("button", "bp-notice-unack-btn", "未読に戻す");
      unackBtn.type = "button";
      unackBtn.addEventListener("click", (e) => {
        const keyboardActivated = e.detail === 0;
        settings.readNoticeBlocks = [];
        Storage.saveSettings(settings, { noticeCollapsed: false });
        syncNoticeSection(settings);
        if (keyboardActivated) {
          collapseBody.querySelector(".bp-notice-ack-btn")?.focus({ preventScroll: true });
        }
      });

      footer.replaceChildren(statusText, unackBtn);
    } else {
      const note = DomUtils.createEl(
        "span",
        "bp-notice-footer-note",
        "確認すると次回から折りたたまれます（新着や変更時は自動で再表示）"
      );
      const ackBtn = DomUtils.createEl("button", "bp-notice-ack-btn", "✓ 確認済みにする");
      ackBtn.type = "button";
      ackBtn.addEventListener("click", (e) => {
        const keyboardActivated = e.detail === 0;
        settings.readNoticeBlocks = [...currentHashes];
        Storage.saveSettings(settings, { noticeCollapsed: true });
        syncNoticeSection(settings, { forceCollapse: true });
        if (keyboardActivated) {
          toggleLink?.focus({ preventScroll: true });
        }
      });

      footer.replaceChildren(note, ackBtn);
    }

    if (!existing) collapseBody.appendChild(footer);
  }

  function syncNoticeSection(settings, { forceCollapse = false } = {}) {
    const parts = getNoticeParts();
    if (!parts) {
      Storage.Hints.clearAttr(CONSTANTS.HINT_ATTRS.NOTICE_COLLAPSED);
      return;
    }

    bindNoticeToggleFallback(parts);

    const blockData = NoticeLogic.extractBlockData(parts.contentEl);
    const currentHashes = blockData.hashes;
    const state = NoticeLogic.evaluateNoticeState(currentHashes, settings.readNoticeBlocks);

    if (state.shouldPrune) {
      settings.readNoticeBlocks = state.prunedReadHashes;
      Storage.saveSettings(settings);
    }

    const shouldCollapse = state.status === "read" || state.status === "empty";
    Storage.Hints.setNoticeCollapsed(shouldCollapse);

    const isFirstInit = !parts.noticeEl.dataset.bpNoticeInitialized;
    if (isFirstInit) {
      parts.noticeEl.dataset.bpNoticeInitialized = "1";
      setNoticeCollapsed(parts, shouldCollapse);
      Storage.Hints.clearAttr(CONSTANTS.HINT_ATTRS.NOTICE_COLLAPSED);
    } else if (forceCollapse) {
      setNoticeCollapsed(parts, true, { preferBootstrapClick: true });
    }

    renderNoticeBlockStates(parts.contentEl, blockData, state, settings.readNoticeBlocks);
    renderNoticeBadge(parts.toggleLink, state.status);
    renderNoticeFooter(parts, state.status, currentHashes, settings);
  }

  BP.NoticeController = {
    syncNoticeSection,
  };
})();
