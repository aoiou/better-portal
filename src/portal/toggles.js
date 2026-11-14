(() => {
  "use strict";

  const BP = (globalThis.BetterPortal = globalThis.BetterPortal || {});
  const { CONSTANTS, TOGGLE_CONFIG, DomUtils } = BP;

  function applyToggleState(cfg, el, active) {
    if (cfg.apply) cfg.apply(el, active);
    else el.style.display = active ? "none" : "";
  }

  function applyExtraHides(settings) {
    if (document.body.classList.contains(CONSTANTS.CLASSES.EDIT_MODE)) return;
    for (const cfg of TOGGLE_CONFIG) {
      const el = cfg.find();
      if (el) applyToggleState(cfg, el, Boolean(settings[cfg.key]));
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
    const btn = DomUtils.createButton("", "", () => onToggle(cfg, btn));
    updateToggleOverlayButton(btn, cfg, settings[cfg.key]);
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
      if (settings[cfg.key]) applyToggleState(cfg, el, false);
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
    applyExtraHides,
    updateToggleOverlayButton,
    setupTogglableElements,
    cleanupTogglableElements,
  };
})();
