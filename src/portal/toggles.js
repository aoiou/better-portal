(() => {
  "use strict";

  const BP = (globalThis.BetterPortal = globalThis.BetterPortal || {});
  const { CONSTANTS, TOGGLE_CONFIG, DomUtils } = BP;

  function findServiceRow() {
    return document.querySelector(CONSTANTS.SELECTOR.SERVICE_ROW);
  }

  function applyToggleElement(cfg, settings) {
    const el = cfg.find();
    if (!el) return;
    if (cfg.apply) cfg.apply(el, settings[cfg.key]);
    else el.style.display = settings[cfg.key] ? "none" : "";
  }

  function applyExtraHides(settings) {
    if (document.body.classList.contains(CONSTANTS.CLASSES.EDIT_MODE)) return;
    for (const cfg of TOGGLE_CONFIG) {
      applyToggleElement(cfg, settings);
    }
  }

  function updateToggleOverlayButton(btn, cfg, active) {
    if (!btn) return;
    btn.className = "bp-btn " + (active ? "bp-btn-show" : "bp-btn-hide");
    btn.textContent = active ? cfg.showLabel : cfg.hideLabel;
  }

  function createToggleOverlay(targetEl, cfg, settings, onToggle) {
    targetEl.querySelector("." + CONSTANTS.CLASSES.TOGGLE_OVERLAY)?.remove();

    const wrapper = DomUtils.createEl("div", CONSTANTS.CLASSES.TOGGLE_OVERLAY);
    const active = Boolean(settings[cfg.key]);
    const btn = DomUtils.createButton(
      active ? "bp-btn-show" : "bp-btn-hide",
      active ? cfg.showLabel : cfg.hideLabel,
      () => onToggle(cfg, btn)
    );
    wrapper.appendChild(btn);

    if (!("bpPrevPosition" in targetEl.dataset)) {
      targetEl.dataset.bpPrevPosition = targetEl.style.position || "";
    }
    targetEl.style.position = "relative";
    targetEl.appendChild(wrapper);
  }

  function setupTogglableElements(settings, onToggle) {
    for (const cfg of TOGGLE_CONFIG) {
      const el = cfg.find();
      if (!el) continue;
      if (cfg.revert) cfg.revert(el, settings[cfg.key]);
      else if (settings[cfg.key]) el.style.display = "";
      createToggleOverlay(el, cfg, settings, onToggle);
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

  BP.Toggles = {
    findServiceRow,
    applyToggleElement,
    applyExtraHides,
    updateToggleOverlayButton,
    setupTogglableElements,
    cleanupTogglableElements,
  };
})();
