(() => {
  "use strict";

  const BP = (globalThis.BetterPortal = globalThis.BetterPortal || {});

  const CONSTANTS = {
    STORAGE_KEY: "betterPortalSettings",
    LOCAL_FALLBACK_KEY: "betterPortalLocalFallback",
    HINTS_CACHE_KEY: "bp-portal-hints",
    CUSTOM_ID_PREFIX: "bp-custom-",
    SVG_NS: "http://www.w3.org/2000/svg",
    CLASSES: {
      EDIT_MODE: "bp-edit-mode",
      READY: "bp-ready",
      SERVICE_CARD: "bp-service-card",
      CUSTOM_CARD: "bp-custom-card",
      HIDDEN_ITEM: "bp-hidden-item",
      IS_DRAGGING: "bp-is-dragging",
      DRAG_ACTIVE: "bp-drag-active",
      DRAG_PLACEHOLDER: "bp-drag-placeholder",
      DRAG_GHOST: "bp-drag-ghost",
      DRAG_GHOST_LIFTED: "bp-drag-ghost-lifted",
      DRAG_SETTLING: "bp-drag-settling",
      DROP_SLOT: "bp-drop-slot",
      DROP_SLOT_ENTER: "bp-drop-slot--entering",
      DROP_SLOT_ICON: "bp-drop-slot-icon",
      EDIT_OVERLAY: "bp-edit-overlay",
      TOGGLE_OVERLAY: "bp-toggle-overlay",
      NOTICE_BADGE: "bp-notice-badge",
      NOTICE_FOOTER: "bp-notice-footer",
      NOTICE_BOTTOM: "bp-notice-bottom",
      NOTICE_BLOCK_READ: "bp-notice-block--read",
      NOTICE_BLOCK_FOLDED: "bp-notice-block--folded",
      NOTICE_FOLD_BAR: "bp-notice-fold-bar",
      NOTICE_FOLD_BAR_FLUSH_BOTTOM: "bp-notice-fold-bar--flush-bottom",
      NOTICE_BODY_FLUSH_BOTTOM: "bp-notice-body--flush-bottom",
    },
    HINT_ATTRS: {
      HIDE_NAVBAR: "data-bp-hide-navbar",
      HIDE_SUB_NAV: "data-bp-hide-subnav",
      HIDE_PAGE_TITLE: "data-bp-hide-title",
      HIDE_SEARCH_BAR: "data-bp-hide-search",
      NOTICE_BOTTOM: "data-bp-notice-bottom",
      NOTICE_COLLAPSED: "data-bp-notice-collapsed",
    },
    EVENTS: {
      ONCLICK_CHANGE: "bp-onclick-change",
    },
    SELECTOR: {
      SERVICE_ROW: '.row:has([id^="div-"][class*="col-"] .service-thumb-wrap)',
      SERVICE_CARDS: '[id^="div-"][class*="col-"]:has(.service-thumb-wrap)',
      NOTICE_CARD: "#PortalComment02",
      NOTICE_TOGGLE: '.card-header a[data-bs-toggle="collapse"], .card-header a',
      NOTICE_BODY: "#collapse1, .card-body.collapse",
      NOTICE_CONTENT: ".ql-editor",
    },
  };

  const TOGGLE_CONFIG = [
    {
      key: "hideNavbar",
      hintKey: "hn",
      hintAttr: CONSTANTS.HINT_ATTRS.HIDE_NAVBAR,
      find: () => document.querySelector("nav.navbar"),
      showLabel: "ナビバー を表示する",
      hideLabel: "ナビバー を非表示にする",
    },
    {
      key: "hideSubNav",
      hintKey: "hs",
      hintAttr: CONSTANTS.HINT_ATTRS.HIDE_SUB_NAV,
      find: () => document.querySelector(".sub-nav"),
      showLabel: "サブナビ を表示する",
      hideLabel: "サブナビ を非表示にする",
    },
    {
      key: "hidePageTitle",
      hintKey: "ht",
      hintAttr: CONSTANTS.HINT_ATTRS.HIDE_PAGE_TITLE,
      find: () => document.querySelector(".page-title"),
      showLabel: "「アカウント」帯 を表示する",
      hideLabel: "「アカウント」帯 を非表示にする",
    },
    {
      key: "hideSearchBar",
      hintKey: "hq",
      hintAttr: CONSTANTS.HINT_ATTRS.HIDE_SEARCH_BAR,
      find: () => document.getElementById("filterValue")?.closest(".row"),
      showLabel: "検索欄 を表示する",
      hideLabel: "検索欄 を非表示にする",
    },
    {
      key: "noticeToBottom",
      hintKey: "nb",
      hintAttr: CONSTANTS.HINT_ATTRS.NOTICE_BOTTOM,
      find: () => document.querySelector(CONSTANTS.SELECTOR.NOTICE_CARD),
      showLabel: "お知らせを一番下に移動 を元に戻す",
      hideLabel: "お知らせを一番下に移動",
      apply(el, active) {
        el.classList.toggle(CONSTANTS.CLASSES.NOTICE_BOTTOM, Boolean(active));
        if (active) {
          if (!document.getElementById("bp-notice-anchor")) {
            const anchor = document.createElement("span");
            anchor.id = "bp-notice-anchor";
            anchor.hidden = true;
            el.before(anchor);
          }
          document.getElementById("div-container")?.appendChild(el);
        } else {
          document.getElementById("bp-notice-anchor")?.after(el);
        }
      },
    },
  ];

  BP.CONSTANTS = CONSTANTS;
  BP.TOGGLE_CONFIG = TOGGLE_CONFIG;
})();
