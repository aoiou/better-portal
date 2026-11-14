(() => {
  "use strict";

  const BP = (globalThis.BetterPortal = globalThis.BetterPortal || {});
  const { CONSTANTS } = BP;

  let activeModal = null;
  let uidCounter = 0;
  let flipTokenSeq = 0;
  const flipTokenMap = new WeakMap();

  function generateUid() {
    uidCounter += 1;
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}-${uidCounter.toString(36)}`;
  }

  function createEl(tag, className, text) {
    const el = document.createElement(tag);
    if (className) el.className = className;
    if (text != null) el.textContent = String(text);
    return el;
  }

  function createButton(className, text, onClick) {
    const btn = createEl("button", "bp-btn " + className, text);
    btn.type = "button";
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      onClick(e);
    });
    return btn;
  }

  function createStrokeIconSvg(paths, { className = "", strokeWidth = "1.8" } = {}) {
    const svg = document.createElementNS(CONSTANTS.SVG_NS, "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    if (className) svg.setAttribute("class", className);
    svg.setAttribute("aria-hidden", "true");
    for (const d of paths) {
      const path = document.createElementNS(CONSTANTS.SVG_NS, "path");
      path.setAttribute("d", d);
      path.setAttribute("fill", "none");
      path.setAttribute("stroke", "currentColor");
      path.setAttribute("stroke-width", strokeWidth);
      path.setAttribute("stroke-linecap", "round");
      path.setAttribute("stroke-linejoin", "round");
      svg.appendChild(path);
    }
    return svg;
  }

  function getCheckedRadioValue(radiosMap, fallback) {
    return Object.values(radiosMap).find((radio) => radio.checked)?.value || fallback;
  }

  function prefersReducedMotion() {
    return Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches);
  }

  /**
   * コンテナ直下にある可視状態のサービスカード要素一覧を返す。
   */
  function getVisibleCards(container) {
    if (!container) return [];
    const cards = [];
    for (const el of container.children) {
      if (
        el.classList.contains(CONSTANTS.CLASSES.SERVICE_CARD) &&
        !el.classList.contains(CONSTANTS.CLASSES.HIDDEN_ITEM)
      ) {
        cards.push(el);
      }
    }
    return cards;
  }

  /**
   * カード要素から編集モード・ドラッグ関連の装飾と状態クラス/属性を除去する。
   */
  function stripCardEditState(el, { stripServiceClass = false } = {}) {
    el
      .querySelectorAll("." + CONSTANTS.CLASSES.EDIT_OVERLAY + ", ." + CONSTANTS.CLASSES.DROP_SLOT)
      .forEach((n) => n.remove());
    el.classList.remove(
      CONSTANTS.CLASSES.HIDDEN_ITEM,
      CONSTANTS.CLASSES.DRAG_PLACEHOLDER,
      CONSTANTS.CLASSES.DRAG_SETTLING
    );
    if (stripServiceClass) el.classList.remove(CONSTANTS.CLASSES.SERVICE_CARD);
    delete el.dataset.bpDraggable;
  }

  /**
   * FLIP アニメーション付きで DOM 変更を実行する共通ヘルパー。
   * 連続操作による途中状態も現在矩形から滑らかに補間し、終了後にインラインスタイルを解放する。
   */
  const FLIP_DURATION_MS = 220;

  function flipAnimateElements(container, elements, mutateDom, {
    excludeEl = null,
    getNextElements = () => elements,
    onAfterMeasure = null,
  } = {}) {
    if (!container || prefersReducedMotion()) {
      mutateDom();
      onAfterMeasure?.(getNextElements(), null);
      return;
    }

    const firstRects = new Map();
    for (const el of elements) {
      if (el !== excludeEl) {
        firstRects.set(el, el.getBoundingClientRect());
      }
    }

    mutateDom();

    const nextElements = getNextElements();
    for (const el of nextElements) {
      if (el !== excludeEl) {
        el.style.transition = "none";
        el.style.transform = "";
      }
    }

    const lastRects = new Map();
    for (const el of nextElements) {
      if (el !== excludeEl) {
        lastRects.set(el, el.getBoundingClientRect());
      }
    }
    onAfterMeasure?.(nextElements, lastRects);

    const moved = [];
    for (const el of nextElements) {
      if (el === excludeEl) continue;
      const first = firstRects.get(el);
      const last = lastRects.get(el);
      if (!first || !last) continue;
      const dx = first.left - last.left;
      const dy = first.top - last.top;
      if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) {
        el.style.transform = `translate3d(${dx}px, ${dy}px, 0)`;
        moved.push(el);
      } else {
        el.style.transition = "";
      }
    }

    if (moved.length === 0) return;

    // 逆変換を確定させてから1回のリフローでトランジションを開始する
    container.offsetHeight;
    for (const el of moved) {
      const token = ++flipTokenSeq;
      flipTokenMap.set(el, token);
      el.style.transition = `transform ${FLIP_DURATION_MS}ms cubic-bezier(0.22, 1, 0.36, 1), opacity 180ms ease`;
      el.style.transform = "";

      const clearIfCurrent = () => {
        if (flipTokenMap.get(el) !== token) return;
        el.style.transition = "";
        el.style.transform = "";
        flipTokenMap.delete(el);
      };

      el.addEventListener(
        "transitionend",
        (e) => {
          if (e.target === el && e.propertyName === "transform") {
            clearIfCurrent();
          }
        },
        { once: true }
      );
      setTimeout(clearIfCurrent, FLIP_DURATION_MS + 60);
    }
  }

  function closeModal({ restoreFocus = true } = {}) {
    if (!activeModal) return;
    const { backdrop, onKeydown, previousFocus } = activeModal;
    document.removeEventListener("keydown", onKeydown, true);
    backdrop.remove();
    activeModal = null;

    if (restoreFocus && previousFocus instanceof HTMLElement && previousFocus.isConnected) {
      try {
        previousFocus.focus({ preventScroll: true });
      } catch {
        // フォーカス不能な要素は無視
      }
    }
  }

  function createModalFrame({
    title,
    ariaLabel,
    submitText,
    submitClassName = "bp-btn-save",
    onRenderBody,
    onSubmit,
  }) {
    const previousFocus = activeModal
      ? activeModal.previousFocus
      : (document.activeElement instanceof HTMLElement ? document.activeElement : null);
    closeModal({ restoreFocus: false });

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
    const saveBtn = createEl("button", `bp-btn ${submitClassName}`, submitText || "保存");
    saveBtn.type = "submit";
    actions.append(cancelBtn, saveBtn);
    form.appendChild(actions);

    const clearError = () => {
      errorEl.textContent = "";
    };
    form.addEventListener("input", clearError);
    form.addEventListener("change", clearError);

    form.addEventListener("submit", (e) => {
      e.preventDefault();
      onSubmit({ errorEl, closeModal });
    });

    cancelBtn.addEventListener("click", () => closeModal());
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
            'button:not([disabled]), input:not([disabled]):not([hidden]), select:not([disabled]):not([hidden]), textarea:not([disabled]):not([hidden]), [tabindex]:not([tabindex="-1"])'
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
    activeModal = { backdrop, onKeydown, previousFocus };

    return { dialog, form, cancelBtn, saveBtn };
  }

  function openConfirmModal({
    title,
    message,
    confirmText = "確認",
    danger = false,
    onConfirm,
  }) {
    const { cancelBtn, saveBtn } = createModalFrame({
      title,
      submitText: confirmText,
      submitClassName: danger ? "bp-btn-danger" : "bp-btn-save",
      onRenderBody({ form }) {
        for (const line of String(message).split("\n")) {
          if (line) {
            form.appendChild(createEl("p", "bp-modal-message", line));
          }
        }
      },
      onSubmit({ closeModal: closeFn }) {
        closeFn({ restoreFocus: false });
        onConfirm();
      },
    });

    // 破壊的操作は誤Enter防止のためキャンセル側を初期フォーカスにする
    (danger ? cancelBtn : saveBtn).focus();
  }

  BP.DomUtils = {
    generateUid,
    createEl,
    createButton,
    createStrokeIconSvg,
    getCheckedRadioValue,
    prefersReducedMotion,
    getVisibleCards,
    stripCardEditState,
    flipAnimateElements,
    closeModal,
    createModalFrame,
    openConfirmModal,
  };
})();
