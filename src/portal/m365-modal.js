(() => {
  "use strict";

  const BP = (globalThis.BetterPortal = globalThis.BetterPortal || {});
  const { DomUtils, UrlM365 } = BP;

  function openM365UrlModal(currentUrl, currentMethod, onSave) {
    const { createEl, getCheckedRadioValue, createModalFrame, generateUid } = DomUtils;
    const {
      M365_REDIRECT_METHODS,
      M365_CUSTOM_OPTION_ID,
      M365_REDIRECT_PRESETS,
      M365_METHOD_OPTIONS,
      normalizeUrl,
      normalizeM365Method,
      findM365PresetMatch,
    } = UrlM365;

    const initialMethod = normalizeM365Method(currentMethod);
    const match = findM365PresetMatch(currentUrl, initialMethod);
    const initialOptionId = match ? match.preset.id : M365_CUSTOM_OPTION_ID;
    const initialCustomMethod = (!match && currentUrl)
      ? initialMethod
      : M365_REDIRECT_METHODS.DOMAIN_HINT;
    const modalToken = generateUid();
    const destRadioName = "bp-m365-redirect-" + modalToken;
    const methodRadioName = "bp-m365-method-" + modalToken;
    const destRadios = {};
    const methodRadios = {};
    const presetSelects = {};
    let customSection = null;
    let customDescEl = null;
    let urlInput = null;

    const getSelectedOptionId = () => getCheckedRadioValue(destRadios, "default");
    const getSelectedMethod = () => getCheckedRadioValue(methodRadios, M365_REDIRECT_METHODS.DOMAIN_HINT);

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
      body.appendChild(createEl("span", "bp-modal-option-title", title));

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

    const { form } = createModalFrame({
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

    form.addEventListener("change", syncCustomSection);

    if (initialOptionId === M365_CUSTOM_OPTION_ID) {
      urlInput?.focus();
    } else {
      destRadios[initialOptionId]?.focus();
    }
  }

  BP.M365Modal = { openM365UrlModal };
})();
