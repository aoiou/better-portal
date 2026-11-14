(() => {
  "use strict";

  const BP = (globalThis.BetterPortal = globalThis.BetterPortal || {});
  const { CONSTANTS, DomUtils } = BP;

  function createDropSlotElement() {
    const slot = DomUtils.createEl("div", CONSTANTS.CLASSES.DROP_SLOT);
    slot.setAttribute("aria-hidden", "true");

    const iconWrap = DomUtils.createEl("div", CONSTANTS.CLASSES.DROP_SLOT_ICON);
    iconWrap.appendChild(
      DomUtils.createStrokeIconSvg(["M12 5v10", "M8.5 11.5L12 15l3.5-3.5", "M5 19h14"], {
        strokeWidth: "1.8",
      })
    );
    slot.appendChild(iconWrap);
    return slot;
  }

  function createDragGhostElement(cardEl, rect) {
    const ghost = cardEl.cloneNode(true);
    ghost.removeAttribute("id");
    ghost.querySelectorAll("[id]").forEach((n) => n.removeAttribute("id"));
    DomUtils.stripCardEditState(ghost, { stripServiceClass: true });
    ghost.classList.add(CONSTANTS.CLASSES.DRAG_GHOST);
    ghost.style.left = rect.left + "px";
    ghost.style.top = rect.top + "px";
    ghost.style.width = rect.width + "px";
    ghost.style.height = rect.height + "px";
    ghost.style.transform = "translate3d(0px, 0px, 0px)";
    return ghost;
  }

  function initDragAndDrop({ mainRow, onOrderCommit }) {
    if (!mainRow) {
      return {
        cancel() {},
        isDragging: () => false,
      };
    }

    const MOVE_THRESHOLD_PX = 5;
    const TOUCH_HOLD_MS = 240;
    const TOUCH_CANCEL_MOVE_PX = 8;
    const SWAP_COOLDOWN_MS = 180;
    const SCROLL_EDGE_TOP_OFFSET = 56;
    const SCROLL_ZONE_PX = 80;
    const MAX_SCROLL_SPEED = 14;

    let state = null;
    let suppressNextClick = false;
    let suppressClickTimer = null;

    function queryVisibleCards() {
      return DomUtils.getVisibleCards(mainRow);
    }

    function refreshVisibleCards(activeState) {
      const cards = queryVisibleCards();
      if (activeState) activeState.visibleCards = cards;
      return cards;
    }

    function toRowRelativeRect(rect, rowRect) {
      return {
        left: rect.left - rowRect.left,
        top: rect.top - rowRect.top,
        right: rect.right - rowRect.left,
        bottom: rect.bottom - rowRect.top,
        width: rect.width,
        height: rect.height,
      };
    }

    function measureAddColRect(rowRect) {
      const addCol = mainRow.querySelector(".bp-add-card-col");
      return addCol && addCol.offsetParent !== null
        ? toRowRelativeRect(addCol.getBoundingClientRect(), rowRect)
        : null;
    }

    function isSameOrder(a, b) {
      return a.length === b.length && a.every((id, idx) => id === b[idx]);
    }

    function cacheLayoutRects(
      activeState,
      cards = activeState?.visibleCards || queryVisibleCards(),
      premeasuredRects = null
    ) {
      if (!activeState) return;
      const rowRect = mainRow.getBoundingClientRect();
      activeState.rowRect = rowRect;
      activeState.layoutRects.clear();
      for (const card of cards) {
        const rect = premeasuredRects?.get(card) || card.getBoundingClientRect();
        activeState.layoutRects.set(card, toRowRelativeRect(rect, rowRect));
      }
      activeState.addColRect = measureAddColRect(rowRect);
    }

    function isInRect(px, py, rect) {
      return Boolean(rect && px >= rect.left && px <= rect.right && py >= rect.top && py <= rect.bottom);
    }

    function findTargetIndex(activeState, clientX, clientY) {
      const cards = activeState.visibleCards;
      const fromIndex = cards.indexOf(activeState.cardEl);
      if (fromIndex < 0) return null;

      const rowRect = activeState.rowRect || mainRow.getBoundingClientRect();
      const px = clientX - rowRect.left;
      const py = clientY - rowRect.top;

      const draggedRect = activeState.layoutRects.get(activeState.cardEl);
      if (!draggedRect) return null;

      // ポインターが自身の着地プレースホルダー上にある場合は位置を確定維持する
      if (isInRect(px, py, draggedRect)) return null;

      const now = performance.now();

      for (let i = 0; i < cards.length; i++) {
        const card = cards[i];
        if (card === activeState.cardEl) continue;
        const rect = activeState.layoutRects.get(card);
        if (!isInRect(px, py, rect)) continue;

        if (card === activeState.lastSwapPartner && now - activeState.lastSwapAt < SWAP_COOLDOWN_MS) {
          return null;
        }

        const verticalOverlap =
          Math.min(rect.bottom, draggedRect.bottom) - Math.max(rect.top, draggedRect.top);
        const sameRow = verticalOverlap > Math.min(rect.height, draggedRect.height) * 0.4;

        let crossedThreshold = false;
        if (sameRow) {
          crossedThreshold =
            i > fromIndex
              ? px >= rect.left + rect.width * 0.22
              : px <= rect.right - rect.width * 0.22;
        } else {
          crossedThreshold =
            i > fromIndex
              ? py >= rect.top + rect.height * 0.18
              : py <= rect.bottom - rect.height * 0.18;
        }

        return crossedThreshold ? { index: i, partner: card } : null;
      }

      if (isInRect(px, py, activeState.addColRect) && fromIndex !== cards.length - 1) {
        return { index: cards.length - 1, partner: cards[cards.length - 1] };
      }

      const lastCard = cards[cards.length - 1];
      const lastRect = activeState.layoutRects.get(lastCard);
      if (lastRect && fromIndex !== cards.length - 1) {
        const inLastRowTail = py >= lastRect.top && py <= lastRect.bottom && px > lastRect.right;
        const belowLastRow = py > lastRect.bottom && py <= rowRect.height + 32;
        if (inLastRowTail || belowLastRow) {
          return { index: cards.length - 1, partner: lastCard };
        }
      }

      const firstCard = cards[0];
      const firstRect = activeState.layoutRects.get(firstCard);
      if (firstRect && fromIndex !== 0 && py < firstRect.top && py >= -40 && px >= 0 && px <= rowRect.width) {
        return { index: 0, partner: firstCard };
      }

      return null;
    }

    function applyFlipReorder(activeState, applyDomChange) {
      DomUtils.flipAnimateElements(mainRow, activeState.visibleCards, applyDomChange, {
        excludeEl: activeState.cardEl,
        durationMs: 220,
        getNextElements: () => refreshVisibleCards(activeState),
        onAfterMeasure: (nextCards, lastRects) => {
          cacheLayoutRects(activeState, nextCards, lastRects);
        },
      });
    }

    function moveCardWithFlip(activeState, targetIndex, partner) {
      const cards = activeState.visibleCards;
      const fromIndex = cards.indexOf(activeState.cardEl);
      if (fromIndex < 0 || targetIndex < 0 || targetIndex >= cards.length || fromIndex === targetIndex) {
        return false;
      }

      activeState.slotEl?.classList.remove(CONSTANTS.CLASSES.DROP_SLOT_ENTER);

      const refNode = cards[targetIndex];
      applyFlipReorder(activeState, () => {
        if (targetIndex > fromIndex) refNode.after(activeState.cardEl);
        else refNode.before(activeState.cardEl);
      });

      activeState.lastSwapPartner = partner || refNode;
      activeState.lastSwapAt = performance.now();
      return true;
    }

    /**
     * 最新ポインター位置に応じた移動先が見つかった場合にカードをFLIP付きで入れ替える。
     */
    function tryReorderAtPointer(activeState) {
      const target = findTargetIndex(activeState, activeState.lastClientX, activeState.lastClientY);
      if (target) moveCardWithFlip(activeState, target.index, target.partner);
    }

    function restoreInitialOrderWithFlip(activeState) {
      const currentCards = refreshVisibleCards(activeState);
      const currentIds = currentCards.map((el) => el.id);
      if (isSameOrder(currentIds, activeState.initialVisibleOrder)) {
        return;
      }

      const cardById = new Map(currentCards.map((el) => [el.id, el]));
      const addCol = mainRow.querySelector(".bp-add-card-col");
      applyFlipReorder(activeState, () => {
        for (const id of activeState.initialVisibleOrder) {
          const el = cardById.get(id);
          if (!el) continue;
          if (addCol) addCol.before(el);
          else mainRow.appendChild(el);
        }
      });
    }

    function stopAutoScroll(activeState) {
      if (activeState?.scrollRaf) {
        cancelAnimationFrame(activeState.scrollRaf);
        activeState.scrollRaf = 0;
      }
    }

    function stopMoveRaf(activeState) {
      if (activeState?.moveRaf) {
        cancelAnimationFrame(activeState.moveRaf);
        activeState.moveRaf = 0;
      }
    }

    function updateAutoScroll(activeState) {
      if (!activeState || !activeState.dragging || activeState.settling) {
        stopAutoScroll(activeState);
        return;
      }

      const topBoundary = SCROLL_EDGE_TOP_OFFSET + SCROLL_ZONE_PX;
      const bottomBoundary = window.innerHeight - SCROLL_ZONE_PX;

      const calcScrollDelta = (y) => {
        if (y < topBoundary) {
          return -Math.ceil(Math.min(1, (topBoundary - y) / SCROLL_ZONE_PX) * MAX_SCROLL_SPEED);
        }
        if (y > bottomBoundary) {
          return Math.ceil(Math.min(1, (y - bottomBoundary) / SCROLL_ZONE_PX) * MAX_SCROLL_SPEED);
        }
        return 0;
      };

      if (calcScrollDelta(activeState.lastClientY) === 0) {
        stopAutoScroll(activeState);
        return;
      }

      if (activeState.scrollRaf) return;

      const step = () => {
        if (!state || state !== activeState || !activeState.dragging || activeState.settling) {
          activeState.scrollRaf = 0;
          return;
        }
        const dy = calcScrollDelta(activeState.lastClientY);
        if (dy === 0) {
          activeState.scrollRaf = 0;
          return;
        }
        const prevScrollY = window.scrollY;
        window.scrollBy(0, dy);
        if (window.scrollY !== prevScrollY) {
          activeState.rowRect = mainRow.getBoundingClientRect();
          tryReorderAtPointer(activeState);
        }
        activeState.scrollRaf = requestAnimationFrame(step);
      };

      activeState.scrollRaf = requestAnimationFrame(step);
    }

    function updateGhostPosition(activeState, clientX, clientY) {
      if (!activeState.ghostEl) return;
      const dx = clientX - activeState.startClientX;
      const dy = clientY - activeState.startClientY;
      activeState.ghostEl.style.transform = `translate3d(${dx}px, ${dy}px, 0)`;
    }

    function applyDragPointerFrame(activeState) {
      if (!state || state !== activeState || !activeState.dragging || activeState.settling) return;
      updateGhostPosition(activeState, activeState.lastClientX, activeState.lastClientY);
      tryReorderAtPointer(activeState);
      updateAutoScroll(activeState);
    }

    const GLOBAL_LISTENERS = [
      ["pointermove", onPointerMove],
      ["pointerup", onPointerUp],
      ["pointercancel", onPointerCancel],
      ["keydown", onKeydown, true],
      ["blur", onWindowBlur],
      ["resize", onWindowResize],
    ];

    function setGlobalListeners(attach) {
      const method = attach ? "addEventListener" : "removeEventListener";
      for (const [type, handler, capture] of GLOBAL_LISTENERS) {
        window[method](type, handler, capture);
      }
    }

    function cleanupVisualState(activeState) {
      stopAutoScroll(activeState);
      stopMoveRaf(activeState);
      if (activeState.holdTimer) {
        clearTimeout(activeState.holdTimer);
        activeState.holdTimer = 0;
      }
      if (activeState.settleTimer) {
        clearTimeout(activeState.settleTimer);
        activeState.settleTimer = 0;
      }
      if (activeState.ghostEl) {
        activeState.ghostEl.remove();
        activeState.ghostEl = null;
      }
      if (activeState.slotEl) {
        activeState.slotEl.remove();
        activeState.slotEl = null;
      }
      activeState.cardEl.classList.remove(CONSTANTS.CLASSES.DRAG_PLACEHOLDER, CONSTANTS.CLASSES.DRAG_SETTLING);
      mainRow.classList.remove(CONSTANTS.CLASSES.IS_DRAGGING);
      document.body.classList.remove(CONSTANTS.CLASSES.DRAG_ACTIVE);

      try {
        if (mainRow.hasPointerCapture?.(activeState.pointerId)) {
          mainRow.releasePointerCapture(activeState.pointerId);
        }
      } catch {
        // 既に解放済みの場合は無視
      }

      for (const card of queryVisibleCards()) {
        card.style.transition = "";
        card.style.transform = "";
      }
    }

    function beginDrag(activeState) {
      if (!activeState || activeState.dragging) return;
      if (!document.body.classList.contains(CONSTANTS.CLASSES.EDIT_MODE)) {
        abortState();
        return;
      }

      activeState.dragging = true;
      if (activeState.holdTimer) {
        clearTimeout(activeState.holdTimer);
        activeState.holdTimer = 0;
      }

      const rect = activeState.cardEl.getBoundingClientRect();
      activeState.startCardRect = rect;
      const cards = refreshVisibleCards(activeState);
      activeState.initialVisibleOrder = cards.map((el) => el.id);
      cacheLayoutRects(activeState, cards);

      const ghost = createDragGhostElement(activeState.cardEl, rect);
      const ghostMount = activeState.cardEl.closest(".user-account") || document.body;
      ghostMount.appendChild(ghost);
      activeState.ghostEl = ghost;

      const slot = createDropSlotElement();
      if (!DomUtils.prefersReducedMotion()) {
        slot.classList.add(CONSTANTS.CLASSES.DROP_SLOT_ENTER);
        slot.addEventListener(
          "animationend",
          () => slot.classList.remove(CONSTANTS.CLASSES.DROP_SLOT_ENTER),
          { once: true }
        );
      }
      activeState.cardEl.appendChild(slot);
      activeState.slotEl = slot;

      activeState.cardEl.classList.add(CONSTANTS.CLASSES.DRAG_PLACEHOLDER);
      mainRow.classList.add(CONSTANTS.CLASSES.IS_DRAGGING);
      document.body.classList.add(CONSTANTS.CLASSES.DRAG_ACTIVE);

      // 強制リフロー後に浮き上がり状態クラスを付与して滑らかに浮かせる
      ghost.offsetHeight;
      ghost.classList.add(CONSTANTS.CLASSES.DRAG_GHOST_LIFTED);
      updateGhostPosition(activeState, activeState.lastClientX, activeState.lastClientY);

      try {
        mainRow.setPointerCapture?.(activeState.pointerId);
      } catch {
        // ポインターが既に解放されている場合は無視
      }

      suppressNextClick = true;
      if (suppressClickTimer) clearTimeout(suppressClickTimer);
    }

    function finishDrag(cancelled) {
      const activeState = state;
      if (!activeState) return;

      if (!activeState.dragging) {
        abortState();
        return;
      }
      if (activeState.settling) return;
      activeState.settling = true;

      stopAutoScroll(activeState);
      stopMoveRaf(activeState);
      setGlobalListeners(false);

      if (cancelled) {
        restoreInitialOrderWithFlip(activeState);
      } else {
        tryReorderAtPointer(activeState);
      }

      // 着地直前に周辺カードのディミングを戻し、着地枠への収束を強調する
      mainRow.classList.remove(CONSTANTS.CLASSES.IS_DRAGGING);
      document.body.classList.remove(CONSTANTS.CLASSES.DRAG_ACTIVE);

      const finalVisibleOrder = refreshVisibleCards(activeState).map((el) => el.id);
      const orderChanged = !cancelled && !isSameOrder(finalVisibleOrder, activeState.initialVisibleOrder);

      let settled = false;
      const completeSettle = () => {
        if (settled) return;
        settled = true;
        if (state === activeState) state = null;
        cleanupVisualState(activeState);

        suppressClickTimer = setTimeout(() => {
          suppressNextClick = false;
        }, 50);

        if (orderChanged) {
          onOrderCommit(finalVisibleOrder);
        }
      };

      if (DomUtils.prefersReducedMotion() || !activeState.ghostEl) {
        completeSettle();
        return;
      }

      const targetRect = activeState.cardEl.getBoundingClientRect();
      const settleDx = targetRect.left - activeState.startCardRect.left;
      const settleDy = targetRect.top - activeState.startCardRect.top;

      activeState.cardEl.classList.add(CONSTANTS.CLASSES.DRAG_SETTLING);
      activeState.ghostEl.classList.remove(CONSTANTS.CLASSES.DRAG_GHOST_LIFTED);
      activeState.ghostEl.classList.add(CONSTANTS.CLASSES.DRAG_SETTLING);
      activeState.ghostEl.offsetHeight;
      activeState.ghostEl.style.transform = `translate3d(${settleDx}px, ${settleDy}px, 0)`;

      activeState.ghostEl.addEventListener("transitionend", (e) => {
        if (e.target === activeState.ghostEl && e.propertyName === "transform") {
          completeSettle();
        }
      });
      activeState.settleTimer = setTimeout(completeSettle, 200);
    }

    function abortState() {
      const activeState = state;
      if (!activeState) return;
      state = null;
      setGlobalListeners(false);
      if (activeState.dragging && !activeState.settling) {
        restoreInitialOrderWithFlip(activeState);
      }
      cleanupVisualState(activeState);
      suppressNextClick = false;
    }

    function onPointerMove(e) {
      const activeState = state;
      if (!activeState || e.pointerId !== activeState.pointerId || activeState.settling) return;

      activeState.lastClientX = e.clientX;
      activeState.lastClientY = e.clientY;

      if (!activeState.dragging) {
        const dist = Math.hypot(e.clientX - activeState.startClientX, e.clientY - activeState.startClientY);
        if (activeState.pointerType === "touch") {
          if (dist >= TOUCH_CANCEL_MOVE_PX) {
            abortState();
          }
          return;
        }
        if (dist >= MOVE_THRESHOLD_PX) {
          beginDrag(activeState);
        } else {
          return;
        }
      }

      if (!activeState.moveRaf) {
        activeState.moveRaf = requestAnimationFrame(() => {
          activeState.moveRaf = 0;
          applyDragPointerFrame(activeState);
        });
      }
    }

    function onPointerUp(e) {
      if (!state || e.pointerId !== state.pointerId) return;
      finishDrag(false);
    }

    function onPointerCancel(e) {
      if (!state || e.pointerId !== state.pointerId) return;
      finishDrag(true);
    }

    function onKeydown(e) {
      if (e.key === "Escape" && state?.dragging) {
        e.preventDefault();
        e.stopPropagation();
        finishDrag(true);
      }
    }

    function onWindowBlur() {
      if (state?.dragging) finishDrag(true);
      else abortState();
    }

    function onWindowResize() {
      if (state?.dragging && !state.settling) {
        cacheLayoutRects(state);
      }
    }

    mainRow.addEventListener("pointerdown", (e) => {
      if (state) return;
      if (e.pointerType !== "touch" && e.button !== 0) return;
      if (!document.body.classList.contains(CONSTANTS.CLASSES.EDIT_MODE)) return;

      const targetEl = e.target instanceof Element ? e.target : e.target?.parentElement;
      if (!targetEl) return;
      if (targetEl.closest("button, a, input, select, .bp-btn")) return;

      const cardEl = targetEl.closest("." + CONSTANTS.CLASSES.SERVICE_CARD);
      if (!cardEl || cardEl.parentElement !== mainRow) return;
      if (cardEl.classList.contains(CONSTANTS.CLASSES.HIDDEN_ITEM)) return;
      if (cardEl.dataset.bpDraggable !== "1") return;

      if (e.pointerType !== "touch") {
        e.preventDefault();
      }

      const nextState = {
        cardEl,
        pointerId: e.pointerId,
        pointerType: e.pointerType,
        startClientX: e.clientX,
        startClientY: e.clientY,
        lastClientX: e.clientX,
        lastClientY: e.clientY,
        startCardRect: null,
        rowRect: null,
        visibleCards: [],
        initialVisibleOrder: [],
        layoutRects: new Map(),
        addColRect: null,
        dragging: false,
        settling: false,
        ghostEl: null,
        slotEl: null,
        holdTimer: 0,
        settleTimer: 0,
        moveRaf: 0,
        scrollRaf: 0,
        lastSwapPartner: null,
        lastSwapAt: 0,
      };
      state = nextState;

      if (e.pointerType === "touch") {
        nextState.holdTimer = setTimeout(() => {
          if (state === nextState && !nextState.dragging) {
            beginDrag(nextState);
          }
        }, TOUCH_HOLD_MS);
      }

      setGlobalListeners(true);
    });

    mainRow.addEventListener(
      "click",
      (e) => {
        if (!suppressNextClick) return;
        e.preventDefault();
        e.stopPropagation();
        suppressNextClick = false;
      },
      true
    );

    return {
      cancel() {
        abortState();
      },
      isDragging() {
        return Boolean(state?.dragging);
      },
    };
  }

  BP.DragDrop = {
    initDragAndDrop,
  };
})();
