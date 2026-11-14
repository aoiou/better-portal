import test from "node:test";
import assert from "node:assert/strict";
import { createPortalTestEnv } from "./helpers/test-helpers.mjs";

test("OrderLogic moves visible cards while skipping hidden items and reconciles order", () => {
  const { BP } = createPortalTestEnv();
  const { OrderLogic } = BP;

  const order = ["a", "hidden1", "b", "c"];
  const hidden = ["hidden1"];

  assert.deepEqual(Array.from(OrderLogic.calcMoveOrder(order, hidden, "a", 1)), ["b", "hidden1", "a", "c"]);
  assert.equal(OrderLogic.calcMoveOrder(order, hidden, "a", -1), null);
  assert.equal(OrderLogic.calcMoveOrder(order, hidden, "c", 1), null);

  assert.deepEqual(
    Array.from(OrderLogic.calcReorderFromVisible(order, hidden, ["c", "a", "b"])),
    ["c", "hidden1", "a", "b"]
  );

  assert.deepEqual(
    Array.from(OrderLogic.reconcileOrder(["c", "removed", "a"], ["a", "b", "c"])),
    ["c", "a", "b"]
  );
});

test("UrlM365 validates URLs, builds domain_hint/login_srf onclicks, and dispatches onclick change event", () => {
  const { BP, document, window } = createPortalTestEnv();
  const { UrlM365, CONSTANTS } = BP;

  assert.equal(UrlM365.normalizeUrl("teams.microsoft.com"), "https://teams.microsoft.com/");
  assert.equal(UrlM365.normalizeUrl("javascript:alert(1)"), null);
  assert.equal(UrlM365.normalizeUrl("data:text/html,hi"), null);
  assert.equal(UrlM365.normalizeUrl("ftp://example.com"), null);

  assert.equal(
    UrlM365.buildM365DomainHintUrl("https://outlook.cloud.microsoft/mail/"),
    "https://outlook.cloud.microsoft/mail/?domain_hint=mail.doshisha.ac.jp"
  );
  assert.equal(
    UrlM365.buildM365DomainHintUrl("https://example.com/?domain_hint=custom.ac.jp"),
    "https://example.com/?domain_hint=custom.ac.jp"
  );

  const origOnclick =
    "return doPortal('https://login.microsoftonline.com/login.srf?wa=wsignin1.0&wreply=https%3A%2F%2Fwww.office.com%2F')";
  assert.equal(
    UrlM365.buildM365Onclick(origOnclick, "https://outlook.cloud.microsoft/mail/", "domain_hint"),
    "return doPortal('https://outlook.cloud.microsoft/mail/?domain_hint=mail.doshisha.ac.jp')"
  );
  assert.equal(
    UrlM365.buildM365Onclick(origOnclick, "https://outlook.office.com/mail/", "login_srf"),
    "return doPortal('https://login.microsoftonline.com/login.srf?wa=wsignin1.0&wreply=https%3A%2F%2Foutlook.office.com%2Fmail%2F')"
  );

  const card = document.createElement("div");
  const link = document.createElement("a");
  link.className = "service-thumb";
  link.setAttribute("onclick", origOnclick);
  const label = document.createElement("span");
  label.textContent = "Microsoft365";
  link.appendChild(label);
  card.appendChild(link);
  document.body.appendChild(card);

  let eventReceived = null;
  window.addEventListener(
    CONSTANTS.EVENTS.ONCLICK_CHANGE,
    (e) => {
      eventReceived = e.target;
    },
    true
  );

  UrlM365.applyM365Redirect(card, {
    m365RedirectUrl: "https://outlook.cloud.microsoft/mail/",
    m365RedirectMethod: "domain_hint",
  });
  assert.equal(eventReceived, link);
  assert.equal(
    link.dataset.bpOnclick,
    "return doPortal('https://outlook.cloud.microsoft/mail/?domain_hint=mail.doshisha.ac.jp')"
  );
});

test("NoticeLogic single-pass extraction, read/unread state, and O(N) fold group collection", () => {
  const { BP, document } = createPortalTestEnv();
  const { NoticeLogic, CONSTANTS } = BP;

  const root = document.createElement("div");
  const wrap = document.createElement("div");
  const p1 = document.createElement("p");
  p1.textContent = "Old notice 1";
  const hr = document.createElement("hr");
  const p2 = document.createElement("p");
  p2.textContent = "Old notice 2";
  const p3 = document.createElement("p");
  p3.textContent = "New unseen notice";
  const extWidget = document.createElement("div");
  extWidget.className = CONSTANTS.CLASSES.NOTICE_FOOTER;
  const extP = document.createElement("p");
  extP.textContent = "Extension widget text";
  extWidget.appendChild(extP);

  wrap.append(p1, hr, p2, p3, extWidget);
  root.appendChild(wrap);

  const data = NoticeLogic.extractBlockData(root);
  assert.equal(data.collapsedToSingleHash, false);
  // p1, p2, p3 -> 3 hashes; hr is empty; extWidget is ignored
  assert.equal(data.hashes.length, 3);

  const readHashes = [data.entries[0].hash, data.entries[1].hash];
  const mixedState = NoticeLogic.evaluateNoticeState(data.hashes, readHashes);
  assert.equal(mixedState.status, "unread");
  assert.equal(mixedState.hasMixedReadAndUnseen, true);

  const groups = NoticeLogic.collectFoldGroups(root, data.entries, new Set(readHashes));
  assert.equal(groups.length, 1);
  // p1, hr spacer, p2 should be grouped together before p3
  assert.deepEqual(Array.from(groups[0].elements), [p1, hr, p2]);

  const fullReadState = NoticeLogic.evaluateNoticeState(data.hashes, [...data.hashes, "stale-hash"]);
  assert.equal(fullReadState.status, "read");
  assert.equal(fullReadState.shouldPrune, true);
  assert.deepEqual(Array.from(fullReadState.prunedReadHashes), Array.from(data.hashes));
});

test("Storage coalesces concurrent writes, prevents stale sync overwrite after local fallback, and manages pre-paint hints", async () => {
  const {
    BP,
    document,
    syncStore,
    localStore,
    lsStore,
    setFailSyncSet,
    setSyncSetGate,
    getSyncSetCount,
  } = createPortalTestEnv({
    syncInitial: {
      betterPortalSettings: {
        hiddenIds: ["div-1"],
        order: ["div-2", "div-1"],
        hideNavbar: true,
        m365RedirectUrl: "outlook.cloud.microsoft/mail/",
      },
    },
  });

  const { Storage, CONSTANTS } = BP;

  // 1. Preload & normalization
  const settings = await Storage.preloadSettings();
  assert.equal(settings.hideNavbar, true);
  assert.equal(settings.m365RedirectUrl, "https://outlook.cloud.microsoft/mail/");

  // 2. Coalesced write queue while first sync.set is in flight
  let releaseGate;
  setSyncSetGate(() => new Promise((resolve) => {
    releaseGate = resolve;
  }));

  settings.hideSubNav = true;
  const p1 = Storage.saveSettings(settings);
  settings.hidePageTitle = true;
  Storage.saveSettings(settings);
  settings.hideSearchBar = true;
  Storage.saveSettings(settings);

  // Hints should update synchronously right away
  const hintsRaw = JSON.parse(lsStore.get(CONSTANTS.HINTS_CACHE_KEY));
  assert.equal(hintsRaw.hs, true);
  assert.equal(hintsRaw.ht, true);
  assert.equal(hintsRaw.hq, true);

  // Release first gate and clear gate for trailing coalesced write
  setSyncSetGate(null);
  releaseGate();
  await p1;

  // 3 calls collapsed into 2 actual sync.set IPC calls (leading + coalesced trailing)
  assert.equal(getSyncSetCount(), 2);
  assert.equal(syncStore.get(CONSTANTS.STORAGE_KEY).hideSearchBar, true);

  // 3. Fallback safety when sync.set fails later: newer local data must win over stale sync data
  setFailSyncSet(true);
  settings.noticeToBottom = true;
  await Storage.saveSettings(settings);
  assert.equal(localStore.get(CONSTANTS.LOCAL_FALLBACK_KEY), true);
  assert.equal(localStore.get(CONSTANTS.STORAGE_KEY).noticeToBottom, true);
  assert.equal(syncStore.get(CONSTANTS.STORAGE_KEY).noticeToBottom, false);

  Storage.resetPreloadForTest();
  setFailSyncSet(false);
  const reloaded = await Storage.loadSettings();
  assert.equal(reloaded.noticeToBottom, true);

  // 4. Hints applyFromCache + clearTempAttrs
  Storage.Hints.applyFromCache();
  assert.equal(document.documentElement.getAttribute(CONSTANTS.HINT_ATTRS.HIDE_NAVBAR), "1");
  assert.equal(document.documentElement.getAttribute(CONSTANTS.HINT_ATTRS.NOTICE_BOTTOM), "1");
  Storage.Hints.clearTempAttrs();
  assert.equal(document.documentElement.getAttribute(CONSTANTS.HINT_ATTRS.HIDE_NAVBAR), null);
});

test("CustomCards.updateCustomCardElement avoids recreating image node when icon is unchanged", () => {
  const { BP, document } = createPortalTestEnv();
  const { CustomCards } = BP;

  const tpl = document.createElement("div");
  tpl.className = "col-md-3";
  const a = document.createElement("a");
  a.className = "service-thumb";
  const imgWrap = document.createElement("div");
  imgWrap.className = "service-thumb-img";
  const label = document.createElement("span");
  label.textContent = "Template";
  a.append(imgWrap, label);
  tpl.appendChild(a);

  const card = {
    id: "abc",
    title: "Initial Title",
    url: "https://example.com/",
    iconType: "url",
    iconValue: "https://example.com/icon.png",
  };

  const el = CustomCards.createCustomCardElement(card, tpl);
  const firstImg = el.querySelector("img.bp-card-image");
  assert.ok(firstImg);

  // Update only title & URL -> img element instance must remain identical
  CustomCards.updateCustomCardElement(el, {
    ...card,
    title: "Updated Title",
    url: "https://example.org/app",
  });
  assert.equal(el.querySelector("img.bp-card-image"), firstImg);
  assert.equal(el.querySelector("a.service-thumb span").textContent, "Updated Title");
  assert.equal(el.querySelector("a.service-thumb").href, "https://example.org/app");

  // Update icon -> img element should be replaced with emoji
  CustomCards.updateCustomCardElement(el, {
    ...card,
    title: "Updated Title",
    iconType: "emoji",
    iconValue: "📚",
  });
  assert.equal(el.querySelector("img.bp-card-image"), null);
  assert.equal(el.querySelector(".bp-card-emoji").textContent, "📚");
});

test("DomUtils.openConfirmModal opens themed modal, traps confirm, and restores focus on cancel", () => {
  const { BP, document } = createPortalTestEnv();
  const { DomUtils } = BP;

  const triggerBtn = document.createElement("button");
  document.body.appendChild(triggerBtn);
  triggerBtn.focus();

  let confirmed = false;
  DomUtils.openConfirmModal({
    title: "確認テスト",
    message: "1行目\n2行目",
    confirmText: "削除",
    danger: true,
    onConfirm: () => {
      confirmed = true;
    },
  });

  const dialog = document.querySelector(".bp-modal-dialog");
  assert.ok(dialog);
  assert.equal(dialog.querySelectorAll(".bp-modal-message").length, 2);
  const cancelBtn = dialog.querySelector(".bp-btn-cancel");
  const confirmBtn = dialog.querySelector(".bp-btn-danger");
  assert.ok(confirmBtn);
  // Danger modal focuses cancel button initially
  assert.equal(document.activeElement, cancelBtn);

  // Cancel restores focus to triggerBtn
  cancelBtn.click();
  assert.equal(document.querySelector(".bp-modal-dialog"), null);
  assert.equal(confirmed, false);
  assert.equal(document.activeElement, triggerBtn);

  // Re-open and submit confirms
  DomUtils.openConfirmModal({
    title: "確認テスト2",
    message: "実行しますか",
    confirmText: "実行",
    onConfirm: () => {
      confirmed = true;
    },
  });
  document.querySelector(".bp-modal-form").dispatchEvent({
    type: "submit",
    preventDefault() {},
  });
  assert.equal(confirmed, true);
  assert.equal(document.querySelector(".bp-modal-dialog"), null);
});

test("DomUtils.getVisibleCards and DomUtils.stripCardEditState handle card filtering and edit-state cleanup", () => {
  const { BP, document } = createPortalTestEnv();
  const { DomUtils, CONSTANTS } = BP;

  assert.deepEqual(Array.from(DomUtils.getVisibleCards(null)), []);

  const row = document.createElement("div");
  const visibleCard = document.createElement("div");
  visibleCard.id = "div-1";
  visibleCard.className = CONSTANTS.CLASSES.SERVICE_CARD;

  const hiddenCard = document.createElement("div");
  hiddenCard.id = "div-2";
  hiddenCard.className = `${CONSTANTS.CLASSES.SERVICE_CARD} ${CONSTANTS.CLASSES.HIDDEN_ITEM}`;

  const addCol = document.createElement("div");
  addCol.className = "bp-add-card-col";

  row.append(visibleCard, hiddenCard, addCol);
  assert.deepEqual(Array.from(DomUtils.getVisibleCards(row)), [visibleCard]);

  visibleCard.classList.add(
    CONSTANTS.CLASSES.HIDDEN_ITEM,
    CONSTANTS.CLASSES.DRAG_PLACEHOLDER,
    CONSTANTS.CLASSES.DRAG_SETTLING
  );
  visibleCard.dataset.bpDraggable = "1";
  visibleCard.append(
    DomUtils.createEl("div", CONSTANTS.CLASSES.EDIT_OVERLAY),
    DomUtils.createEl("div", CONSTANTS.CLASSES.DROP_SLOT)
  );

  DomUtils.stripCardEditState(visibleCard);
  assert.equal(visibleCard.querySelector("." + CONSTANTS.CLASSES.EDIT_OVERLAY), null);
  assert.equal(visibleCard.querySelector("." + CONSTANTS.CLASSES.DROP_SLOT), null);
  assert.equal(visibleCard.classList.contains(CONSTANTS.CLASSES.HIDDEN_ITEM), false);
  assert.equal(visibleCard.classList.contains(CONSTANTS.CLASSES.DRAG_PLACEHOLDER), false);
  assert.equal(visibleCard.classList.contains(CONSTANTS.CLASSES.DRAG_SETTLING), false);
  assert.equal("bpDraggable" in visibleCard.dataset, false);
  assert.equal(visibleCard.classList.contains(CONSTANTS.CLASSES.SERVICE_CARD), true);

  DomUtils.stripCardEditState(visibleCard, { stripServiceClass: true });
  assert.equal(visibleCard.classList.contains(CONSTANTS.CLASSES.SERVICE_CARD), false);
});
