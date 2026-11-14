(() => {
  "use strict";

  const BP = (globalThis.BetterPortal = globalThis.BetterPortal || {});
  const { CONSTANTS, DomUtils, UrlM365 } = BP;

  function findCustomCard(settings, elementId) {
    if (!elementId.startsWith(CONSTANTS.CUSTOM_ID_PREFIX)) return null;
    const id = elementId.slice(CONSTANTS.CUSTOM_ID_PREFIX.length);
    return settings.customCards.find((c) => c.id === id) || null;
  }

  function createDefaultIconSvg() {
    return DomUtils.createStrokeIconSvg(
      [
        "M12 2a10 10 0 1 0 0 20a10 10 0 1 0 0-20z",
        "M2 12h20",
        "M12 2a15 15 0 0 1 4 10a15 15 0 0 1-4 10a15 15 0 0 1-4-10a15 15 0 0 1 4-10z",
      ],
      { className: "bp-card-default-icon", strokeWidth: "1.6" }
    );
  }

  function createIconElement(iconType, iconValue, forPreview = false) {
    const wrap = DomUtils.createEl("div", forPreview ? "bp-custom-icon" : "service-thumb-img bp-custom-icon");

    const imageUrl = iconType === "url" ? UrlM365.normalizeUrl(iconValue) : null;
    if (iconType === "emoji" && iconValue?.trim()) {
      wrap.appendChild(DomUtils.createEl("span", "bp-card-emoji", iconValue.trim()));
    } else if (imageUrl) {
      const img = DomUtils.createEl("img", "bp-card-image");
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

  function createCardTemplate(sourceCard) {
    const tpl = sourceCard.cloneNode(true);
    stripCardEditState(tpl, { stripServiceClass: true });
    tpl.removeAttribute("style");
    return tpl;
  }

  function getIconKey(card) {
    return `${card.iconType || "default"}:${card.iconValue || ""}`;
  }

  function updateCustomCardElement(el, card) {
    if (!el || !card) return el;
    const link = el.querySelector("a.service-thumb");
    if (!link) return el;

    const safeUrl = UrlM365.normalizeUrl(card.url) || "#";
    link.href = safeUrl;
    link.title = safeUrl;

    const nextIconKey = getIconKey(card);
    if (el.dataset.bpIconKey !== nextIconKey) {
      el.dataset.bpIconKey = nextIconKey;
      const icon = createIconElement(card.iconType, card.iconValue);
      const oldIcon = link.querySelector(".bp-custom-icon, .service-thumb-img");
      if (oldIcon) oldIcon.replaceWith(icon);
      else link.prepend(icon);
    }

    const currentIcon = link.querySelector(".bp-custom-icon, .service-thumb-img");
    let label = [...link.querySelectorAll("span")].find((s) => !currentIcon || !currentIcon.contains(s));
    if (!label) {
      label = document.createElement("span");
      link.appendChild(label);
    }
    label.textContent = card.title;
    return el;
  }

  function createCustomCardElement(card, cardTemplate) {
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
    link.target = "_blank";
    link.rel = "noopener noreferrer";

    return updateCustomCardElement(el, card);
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

  function openCardModal(card, onSave) {
    const { createEl, getCheckedRadioValue, createModalFrame, generateUid } = DomUtils;
    let titleInput, urlInput, emojiInput, iconUrlInput, previewCard;
    const radios = {};
    const radioName = "bp-icon-type-" + generateUid();

    const getIconType = () => getCheckedRadioValue(radios, "default");
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

    const { form } = createModalFrame({
      title: card ? "オリジナルカードを編集" : "オリジナルカードを追加",
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
        const url = UrlM365.normalizeUrl(urlInput.value);
        const iconType = getIconType();
        const iconValue = getIconValue(iconType);
        const normalizedIconUrl = iconType === "url" ? UrlM365.normalizeUrl(iconValue) : null;

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

    form.addEventListener("input", updatePreview);
    form.addEventListener("change", updatePreview);

    updatePreview();
    titleInput.focus();
  }

  function createAddCardPlaceholder(cardTemplate, onAdd) {
    const col = DomUtils.createEl("div", cardTemplate?.className || "");
    col.classList.add("bp-add-card-col");

    const btn = DomUtils.createEl("button", "bp-add-card-btn");
    btn.type = "button";
    btn.append(
      DomUtils.createEl("span", "bp-add-card-plus", "＋"),
      DomUtils.createEl("span", "bp-add-card-label", "新規カードを追加")
    );

    btn.addEventListener("click", (e) => {
      e.preventDefault();
      openCardModal(null, onAdd);
    });

    col.appendChild(btn);
    return col;
  }

  function confirmDeleteCustomCard(card, onConfirm) {
    if (!card) return;
    DomUtils.openConfirmModal({
      title: "オリジナルカードを削除",
      message: `「${card.title}」を削除しますか？\nこの操作は元に戻せません。`,
      confirmText: "削除",
      danger: true,
      onConfirm,
    });
  }

  BP.CustomCards = {
    findCustomCard,
    createIconElement,
    stripCardEditState,
    createCardTemplate,
    createCustomCardElement,
    updateCustomCardElement,
    openCardModal,
    createAddCardPlaceholder,
    confirmDeleteCustomCard,
  };
})();
