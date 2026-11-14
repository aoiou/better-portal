(() => {
  "use strict";

  const BP = globalThis.BetterPortal;
  const {
    CONSTANTS,
    TOGGLE_CONFIG,
    DomUtils,
    Storage,
    OrderLogic,
    UrlM365,
    M365Modal,
    CustomCards,
    Toggles,
    NoticeController,
    DragDrop,
  } = BP;

  // document_start で即座にキャッシュヒント適用＆ストレージ先行取得を開始する
  Storage.Hints.applyFromCache();
  Storage.preloadSettings();

  let mainRow = null;
  let cardTemplate = null;
  let hiddenSectionOpen = false;
  let hiddenSectionRef = null;
  let addCardCol = null;
  let dragController = null;
  const cardById = new Map();

  function insertCardInOrder(container, el, orderedIds, trailingEl = null) {
    const targetIdx = orderedIds.indexOf(el.id);
    if (targetIdx >= 0) {
      for (const child of container.children) {
        if (!child.classList.contains(CONSTANTS.CLASSES.SERVICE_CARD)) continue;
        const childIdx = orderedIds.indexOf(child.id);
        if (childIdx > targetIdx) {
          child.before(el);
          return;
        }
      }
    }
    if (trailingEl && trailingEl.parentElement === container) {
      trailingEl.before(el);
    } else {
      container.appendChild(el);
    }
  }

  function ensureHiddenSection() {
    if (hiddenSectionRef && hiddenSectionRef.section.isConnected) {
      return hiddenSectionRef;
    }

    const section = DomUtils.createEl("div", "bp-hidden-section" + (hiddenSectionOpen ? " open" : ""));
    const header = DomUtils.createEl("div", "bp-hidden-header");
    const countEl = DomUtils.createEl("span", "bp-hidden-count", "0");
    const label = DomUtils.createEl("span");
    label.append(DomUtils.createEl("span", "bp-hidden-title", "非表示の項目"), countEl);
    header.append(label, DomUtils.createEl("span", "bp-hidden-arrow", "▼"));

    const body = DomUtils.createEl("div", "bp-hidden-body");
    section.append(header, body);

    header.addEventListener("click", () => {
      section.classList.toggle("open");
      hiddenSectionOpen = section.classList.contains("open");
    });

    mainRow.parentElement.appendChild(section);
    hiddenSectionRef = { section, body, countEl };
    return hiddenSectionRef;
  }

  function syncHiddenSectionEmptyState() {
    if (!hiddenSectionRef) return;
    const count = hiddenSectionRef.body.children.length;
    if (count === 0) {
      hiddenSectionRef.section.remove();
      hiddenSectionRef = null;
    } else {
      hiddenSectionRef.countEl.textContent = String(count);
    }
  }

  function refreshCardOverlay(el, settings, settingsBtn) {
    el.querySelector("." + CONSTANTS.CLASSES.EDIT_OVERLAY)?.remove();
    el.appendChild(createEditOverlay(el, settings, settingsBtn));
  }

  function moveCard(el, direction, settings) {
    const newOrder = OrderLogic.calcMoveOrder(settings.order, settings.hiddenIds, el.id, direction);
    if (!newOrder || !mainRow) return;

    const visibleCards = DomUtils.getVisibleCards(mainRow);
    const fromIdx = visibleCards.indexOf(el);
    const swapEl = visibleCards[fromIdx + direction];
    if (fromIdx < 0 || !swapEl) return;

    const focusedBtn = el.contains(document.activeElement) ? document.activeElement : null;
    settings.order = newOrder;

    DomUtils.flipAnimateElements(mainRow, visibleCards, () => {
      if (direction > 0) swapEl.after(el);
      else swapEl.before(el);
    });

    if (focusedBtn instanceof HTMLElement && focusedBtn.isConnected && document.activeElement !== focusedBtn) {
      focusedBtn.focus({ preventScroll: true });
    }
    Storage.saveSettings(settings);
  }

  function hideCard(el, settings, settingsBtn) {
    const id = el.id;
    if (settings.hiddenIds.includes(id) || !mainRow) return;

    const hadFocus = el.contains(document.activeElement);
    const visibleBefore = DomUtils.getVisibleCards(mainRow);
    const idx = visibleBefore.indexOf(el);
    const nextFocusCard = visibleBefore[idx + 1] || visibleBefore[idx - 1] || null;

    settings.hiddenIds.push(id);
    DomUtils.flipAnimateElements(
      mainRow,
      visibleBefore,
      () => {
        el.remove();
      },
      { excludeEl: el }
    );

    el.classList.add(CONSTANTS.CLASSES.HIDDEN_ITEM);
    delete el.dataset.bpDraggable;
    refreshCardOverlay(el, settings, settingsBtn);

    const { body } = ensureHiddenSection();
    insertCardInOrder(body, el, settings.order);
    syncHiddenSectionEmptyState();

    if (hadFocus) {
      const fallbackTarget =
        nextFocusCard?.querySelector("." + CONSTANTS.CLASSES.EDIT_OVERLAY + " button") ||
        addCardCol?.querySelector(".bp-add-card-btn") ||
        settingsBtn;
      fallbackTarget?.focus({ preventScroll: true });
    }

    Storage.saveSettings(settings);
  }

  function showCard(el, settings, settingsBtn) {
    const id = el.id;
    if (!mainRow) return;

    const hadFocus = el.contains(document.activeElement);
    settings.hiddenIds = settings.hiddenIds.filter((hid) => hid !== id);

    el.remove();
    syncHiddenSectionEmptyState();

    el.classList.remove(CONSTANTS.CLASSES.HIDDEN_ITEM);
    el.dataset.bpDraggable = "1";
    refreshCardOverlay(el, settings, settingsBtn);

    const visibleBefore = DomUtils.getVisibleCards(mainRow);
    DomUtils.flipAnimateElements(mainRow, visibleBefore, () => {
      insertCardInOrder(mainRow, el, settings.order, addCardCol);
    });

    if (hadFocus) {
      el.querySelector(".bp-btn-hide")?.focus({ preventScroll: true });
    }

    Storage.saveSettings(settings);
  }

  function removeCustomCard(el, customCard, settings, settingsBtn) {
    CustomCards.confirmDeleteCustomCard(customCard, () => {
      const id = el.id;
      const isHidden = el.classList.contains(CONSTANTS.CLASSES.HIDDEN_ITEM);

      settings.customCards = settings.customCards.filter((c) => c.id !== customCard.id);
      settings.order = settings.order.filter((oid) => oid !== id);
      settings.hiddenIds = settings.hiddenIds.filter((hid) => hid !== id);
      cardById.delete(id);

      if (isHidden) {
        el.remove();
        syncHiddenSectionEmptyState();
        (hiddenSectionRef?.body.querySelector("button") || settingsBtn)?.focus({
          preventScroll: true,
        });
      } else if (mainRow) {
        const visibleCards = DomUtils.getVisibleCards(mainRow);
        DomUtils.flipAnimateElements(
          mainRow,
          visibleCards,
          () => {
            el.remove();
          },
          { excludeEl: el }
        );
        (addCardCol?.querySelector(".bp-add-card-btn") || settingsBtn)?.focus({
          preventScroll: true,
        });
      }

      Storage.saveSettings(settings);
    });
  }

  function createEditOverlay(el, settings, settingsBtn) {
    const overlay = DomUtils.createEl("div", CONSTANTS.CLASSES.EDIT_OVERLAY);
    const id = el.id;
    const isHidden = settings.hiddenIds.includes(id);
    const customCard = el.classList.contains(CONSTANTS.CLASSES.CUSTOM_CARD)
      ? CustomCards.findCustomCard(settings, id)
      : null;

    const createCustomCardButtons = () => {
      const row = DomUtils.createEl("div", "bp-move-row");
      if (!isHidden) {
        row.appendChild(
          DomUtils.createButton("bp-btn-edit", "編集", () => {
            CustomCards.openCardModal(customCard, (data) => {
              Object.assign(customCard, data);
              CustomCards.updateCustomCardElement(el, customCard);
              Storage.saveSettings(settings);
            });
          })
        );
      }
      row.appendChild(
        DomUtils.createButton("bp-btn-delete", "削除", () => {
          removeCustomCard(el, customCard, settings, settingsBtn);
        })
      );
      return row;
    };

    if (isHidden) {
      overlay.appendChild(
        DomUtils.createButton("bp-btn-show", "表示する", () => {
          showCard(el, settings, settingsBtn);
        })
      );
      if (customCard) overlay.appendChild(createCustomCardButtons());
      return overlay;
    }

    overlay.appendChild(
      DomUtils.createButton("bp-btn-hide", "非表示にする", () => {
        hideCard(el, settings, settingsBtn);
      })
    );

    const moveRow = DomUtils.createEl("div", "bp-move-row");
    for (const [cls, text, direction, title] of [
      ["bp-btn-up", "▲", -1, "上に移動"],
      ["bp-btn-down", "▼", 1, "下に移動"],
    ]) {
      const moveBtn = DomUtils.createButton(cls, text, () => {
        moveCard(el, direction, settings);
      });
      moveBtn.title = title;
      moveRow.appendChild(moveBtn);
    }
    overlay.appendChild(moveRow);

    if (customCard) overlay.appendChild(createCustomCardButtons());

    if (UrlM365.isM365Card(el)) {
      const currentUrl = settings.m365RedirectUrl?.trim() || "";
      const currentMethod = UrlM365.normalizeM365Method(settings.m365RedirectMethod);
      const hasCustomUrl = Boolean(currentUrl);
      const match = hasCustomUrl ? UrlM365.findM365PresetMatch(currentUrl, currentMethod) : null;
      const linkBtn = DomUtils.createButton(
        "bp-btn-link",
        hasCustomUrl ? "リンク先変更 (設定済)" : "リンク先を変更",
        () => {
          M365Modal.openM365UrlModal(
            settings.m365RedirectUrl?.trim() || "",
            UrlM365.normalizeM365Method(settings.m365RedirectMethod),
            (newUrl, newMethod) => {
              settings.m365RedirectUrl = newUrl;
              settings.m365RedirectMethod = newMethod;
              UrlM365.applyM365Redirect(el, settings);
              refreshCardOverlay(el, settings, settingsBtn);
              el.querySelector(".bp-btn-link")?.focus({ preventScroll: true });
              Storage.saveSettings(settings);
            }
          );
        }
      );
      if (hasCustomUrl) {
        linkBtn.title = match
          ? `現在の設定: ${match.preset.label}${match.variant ? `（${match.variant.label}）` : ""}`
          : `現在の設定（${UrlM365.M365_METHOD_LABELS[currentMethod]}）: ${currentUrl}`;
      }
      overlay.appendChild(linkBtn);
    }

    return overlay;
  }

  function getOrCreateCustomCardElement(card) {
    const existing = cardById.get(CONSTANTS.CUSTOM_ID_PREFIX + card.id);
    if (existing) {
      return CustomCards.updateCustomCardElement(existing, card);
    }
    return CustomCards.createCustomCardElement(card, cardTemplate);
  }

  function renderFullLayout(settings) {
    dragController?.cancel();

    const portalCards = [...document.querySelectorAll(CONSTANTS.SELECTOR.SERVICE_CARDS)];
    if (mainRow && portalCards.length > 0) {
      if (!cardTemplate) cardTemplate = CustomCards.createCardTemplate(portalCards[0]);
      if (!Array.isArray(settings.customCards)) settings.customCards = [];

      const customCardEls = settings.customCards.map(getOrCreateCustomCardElement).filter(Boolean);
      const allCards = [...portalCards, ...customCardEls];
      settings.order = OrderLogic.reconcileOrder(
        settings.order,
        allCards.map((el) => el.id)
      );

      cardById.clear();
      for (const el of allCards) {
        DomUtils.stripCardEditState(el);
        cardById.set(el.id, el);
      }

      if (hiddenSectionRef) {
        hiddenSectionRef.section.remove();
        hiddenSectionRef = null;
      }
      addCardCol?.remove();

      const hiddenSet = new Set(settings.hiddenIds);
      const visibleFragment = document.createDocumentFragment();
      const hiddenCards = [];

      for (const id of settings.order) {
        const el = cardById.get(id);
        if (!el) continue;
        el.classList.add(CONSTANTS.CLASSES.SERVICE_CARD);
        if (hiddenSet.has(id)) {
          hiddenCards.push(el);
        } else {
          el.dataset.bpDraggable = "1";
          visibleFragment.appendChild(el);
        }
      }

      mainRow.replaceChildren(visibleFragment);

      if (hiddenCards.length > 0) {
        const { body } = ensureHiddenSection();
        const hiddenFragment = document.createDocumentFragment();
        for (const el of hiddenCards) {
          el.classList.add(CONSTANTS.CLASSES.HIDDEN_ITEM);
          hiddenFragment.appendChild(el);
        }
        body.appendChild(hiddenFragment);
        syncHiddenSectionEmptyState();
      }

      // bp-onclick-change を window までバブリングさせるため、全カードをDOM配置した後に適用する
      for (const el of portalCards) {
        UrlM365.applyM365Redirect(el, settings);
      }
    }

    NoticeController.syncNoticeSection(settings);
    Toggles.applyExtraHides(settings);
  }

  function ensureEditModeUi(settings, settingsBtn) {
    if (!mainRow) return;

    if (!dragController) {
      dragController = DragDrop.initDragAndDrop({
        mainRow,
        onOrderCommit(finalVisibleOrder) {
          const newOrder = OrderLogic.calcReorderFromVisible(
            settings.order,
            settings.hiddenIds,
            finalVisibleOrder
          );
          if (newOrder) {
            settings.order = newOrder;
            Storage.saveSettings(settings);
          }
        },
      });
    }

    for (const el of cardById.values()) {
      if (!el.querySelector("." + CONSTANTS.CLASSES.EDIT_OVERLAY)) {
        el.appendChild(createEditOverlay(el, settings, settingsBtn));
      }
    }

    if (!addCardCol) {
      addCardCol = CustomCards.createAddCardPlaceholder(cardTemplate, (data) => {
        const card = { id: DomUtils.generateUid(), ...data };
        const el = getOrCreateCustomCardElement(card);
        if (!el) return;
        settings.customCards.push(card);
        settings.order.push(el.id);
        cardById.set(el.id, el);
        el.classList.add(CONSTANTS.CLASSES.SERVICE_CARD);
        el.dataset.bpDraggable = "1";
        el.appendChild(createEditOverlay(el, settings, settingsBtn));
        insertCardInOrder(mainRow, el, settings.order, addCardCol);
        Storage.saveSettings(settings);
      });
    }

    if (!addCardCol.isConnected) {
      mainRow.appendChild(addCardCol);
    }
  }

  function createSettingsButton(settings) {
    const btn = DomUtils.createEl("button", "bp-settings-btn", "⚙");
    btn.type = "button";
    btn.title = "ポータルを編集";

    let resetBtn = null;

    const onToggleElement = (cfg, toggleBtn) => {
      settings[cfg.key] = !settings[cfg.key];
      Toggles.updateToggleOverlayButton(toggleBtn, cfg, settings[cfg.key]);
      Storage.saveSettings(settings);
    };

    function enterEditMode() {
      document.body.classList.add(CONSTANTS.CLASSES.EDIT_MODE);
      btn.classList.add("active");

      ensureEditModeUi(settings, btn);

      resetBtn = DomUtils.createEl("button", "bp-reset-btn", "設定をリセット");
      resetBtn.type = "button";
      resetBtn.addEventListener("click", () => {
        DomUtils.openConfirmModal({
          title: "設定をリセット",
          message: "すべての設定をリセットしますか？\n（作成したオリジナルカードは削除されません）",
          confirmText: "リセット",
          danger: true,
          onConfirm() {
            const customCards = settings.customCards;
            Object.assign(settings, Storage.getDefaultSettings(), { customCards });
            hiddenSectionOpen = false;
            delete document.querySelector(CONSTANTS.SELECTOR.NOTICE_CARD)?.dataset.bpNoticeInitialized;
            exitEditMode();
            renderFullLayout(settings);
            Storage.saveSettings(settings);
            btn.focus({ preventScroll: true });
          },
        });
      });
      document.body.appendChild(resetBtn);

      Toggles.setupTogglableElements(settings, onToggleElement);
    }

    function exitEditMode() {
      dragController?.cancel();
      DomUtils.closeModal({ restoreFocus: false });
      document.body.classList.remove(CONSTANTS.CLASSES.EDIT_MODE);
      btn.classList.remove("active");
      if (resetBtn) {
        resetBtn.remove();
        resetBtn = null;
      }
      Toggles.cleanupTogglableElements(settings);
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
      Storage.Hints.clearTempAttrs();
      document.body?.classList.add(CONSTANTS.CLASSES.READY);
    }, 2000);

    try {
      mainRow = document.querySelector(CONSTANTS.SELECTOR.SERVICE_ROW);
      const hasToggleTarget = TOGGLE_CONFIG.some((cfg) => cfg.find());
      if (!mainRow && !hasToggleTarget) {
        return;
      }

      const settings = await Storage.loadSettings();
      Storage.Hints.sync(settings);
      renderFullLayout(settings);
      createSettingsButton(settings);
    } catch (err) {
      console.error("[Better Portal] Failed to initialize portal customizer:", err);
    } finally {
      clearTimeout(safetyTimer);
      Storage.Hints.clearTempAttrs();
      document.body?.classList.add(CONSTANTS.CLASSES.READY);
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
