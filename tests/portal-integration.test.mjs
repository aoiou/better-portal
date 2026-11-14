import test from "node:test";
import assert from "node:assert/strict";
import { createPortalTestEnv } from "./helpers/test-helpers.mjs";

function buildMockPortalDom(doc) {
  const nav = doc.createElement("nav");
  nav.className = "navbar";

  const container = doc.createElement("div");
  container.id = "div-container";

  const noticeCard = doc.createElement("div");
  noticeCard.id = "PortalComment02";
  const cardHeader = doc.createElement("div");
  cardHeader.className = "card-header";
  const toggleLink = doc.createElement("a");
  toggleLink.setAttribute("data-bs-toggle", "collapse");
  const headerTitle = doc.createElement("span");
  headerTitle.textContent = "管理者からのお知らせ";
  toggleLink.appendChild(headerTitle);
  cardHeader.appendChild(toggleLink);

  const collapseBody = doc.createElement("div");
  collapseBody.id = "collapse1";
  collapseBody.className = "card-body collapse show";
  const qlEditor = doc.createElement("div");
  qlEditor.className = "ql-editor";
  const p = doc.createElement("p");
  p.textContent = "重要なお知らせ本文";
  qlEditor.appendChild(p);
  collapseBody.appendChild(qlEditor);
  noticeCard.append(cardHeader, collapseBody);

  const userAccount = doc.createElement("div");
  userAccount.className = "user-account";
  const row = doc.createElement("div");
  row.className = "row";

  for (const [id, title] of [
    ["div-1", "Manaba"],
    ["div-2", "Microsoft365"],
    ["div-3", "Library"],
  ]) {
    const col = doc.createElement("div");
    col.id = id;
    col.className = "col-md-3";
    const wrap = doc.createElement("div");
    wrap.className = "service-thumb-wrap";
    const a = doc.createElement("a");
    a.className = "service-thumb";
    if (title === "Microsoft365") {
      a.setAttribute("onclick", "return doPortal('https://login.microsoftonline.com/login.srf')");
    }
    const img = doc.createElement("div");
    img.className = "service-thumb-img";
    const span = doc.createElement("span");
    span.textContent = title;
    a.append(img, span);
    wrap.appendChild(a);
    col.appendChild(wrap);
    row.appendChild(col);
  }

  userAccount.appendChild(row);
  container.append(noticeCard, userAccount);
  doc.body.append(nav, container);
}

test("portal/content.js applies pre-paint hints, initializes lazily without edit overlays, and handles incremental edit actions", async () => {
  const env = createPortalTestEnv({
    localStorageInitial: {
      "bp-portal-hints": JSON.stringify({ hn: true, nb: true, nc: false }),
    },
    syncInitial: {
      betterPortalSettings: {
        hiddenIds: [],
        order: ["div-1", "div-2", "div-3"],
        hideNavbar: true,
        noticeToBottom: true,
      },
    },
    includeMain: true,
    setupDom: buildMockPortalDom,
  });

  const { document, syncStore, BP } = env;
  const { CONSTANTS } = BP;

  // Allow init() microtasks / preload promise to resolve
  await new Promise((r) => setTimeout(r, 15));

  // 1. Initial render completed cleanly: bp-ready added, temp hint attributes cleared
  assert.ok(document.body.classList.contains(CONSTANTS.CLASSES.READY));
  assert.equal(document.documentElement.getAttribute(CONSTANTS.HINT_ATTRS.HIDE_NAVBAR), null);

  // Navbar hidden, notice moved to bottom
  assert.equal(document.querySelector("nav.navbar").style.display, "none");
  const containerChildren = document.getElementById("div-container").children;
  assert.equal(containerChildren[containerChildren.length - 1].id, "PortalComment02");

  // Lazy edit UI: NO edit overlays or add-card column generated before entering Edit Mode
  assert.equal(document.querySelectorAll("." + CONSTANTS.CLASSES.EDIT_OVERLAY).length, 0);
  assert.equal(document.querySelector(".bp-add-card-col"), null);

  // 2. Enter edit mode -> overlays and add-card placeholder lazily created
  const settingsBtn = document.querySelector(".bp-settings-btn");
  assert.ok(settingsBtn);
  settingsBtn.click();

  assert.ok(document.body.classList.contains(CONSTANTS.CLASSES.EDIT_MODE));
  assert.equal(document.querySelectorAll("." + CONSTANTS.CLASSES.EDIT_OVERLAY).length, 3);
  assert.ok(document.querySelector(".bp-add-card-col"));

  // 3. Move div-1 down via ▼ button and verify focus stays on the same button!
  const card1 = document.getElementById("div-1");
  const downBtn = card1.querySelector(".bp-btn-down");
  downBtn.focus();
  downBtn.click();

  const rowCardsAfterMove = document
    .querySelector(CONSTANTS.SELECTOR.SERVICE_ROW)
    .children.filter((el) => el.classList.contains(CONSTANTS.CLASSES.SERVICE_CARD))
    .map((el) => el.id);
  assert.deepEqual(rowCardsAfterMove, ["div-2", "div-1", "div-3"]);
  // Button was NOT destroyed -> focus stayed on downBtn!
  assert.equal(document.activeElement, downBtn);

  await new Promise((r) => setTimeout(r, 10));
  assert.deepEqual(
    Array.from(syncStore.get(CONSTANTS.STORAGE_KEY).order),
    ["div-2", "div-1", "div-3"]
  );

  // 4. Hide div-3 -> moved to .bp-hidden-body with badge count 1
  const card3 = document.getElementById("div-3");
  card3.querySelector(".bp-btn-hide").click();
  assert.ok(card3.classList.contains(CONSTANTS.CLASSES.HIDDEN_ITEM));
  assert.equal(document.querySelector(".bp-hidden-count").textContent, "1");

  // Restore div-3 -> hidden section disappears
  card3.querySelector(".bp-btn-show").click();
  assert.ok(!card3.classList.contains(CONSTANTS.CLASSES.HIDDEN_ITEM));
  assert.equal(document.querySelector(".bp-hidden-section"), null);

  // 5. Reset via themed confirm modal (NOT native confirm())
  document.querySelector(".bp-reset-btn").click();
  const confirmModal = document.querySelector(".bp-modal-dialog");
  assert.ok(confirmModal);
  confirmModal.querySelector(".bp-modal-form").dispatchEvent({
    type: "submit",
    preventDefault() {},
  });

  await new Promise((r) => setTimeout(r, 10));
  assert.ok(!document.body.classList.contains(CONSTANTS.CLASSES.EDIT_MODE));
  assert.equal(syncStore.get(CONSTANTS.STORAGE_KEY).hideNavbar, false);
  assert.equal(document.querySelector("nav.navbar").style.display, "");
});

test("portal/content.js handles custom card add/edit/delete, M365 modal, notice ack/unack, and toggle updates incrementally", async () => {
  const env = createPortalTestEnv({
    syncInitial: {
      betterPortalSettings: {
        hiddenIds: [],
        order: ["div-1", "div-2", "div-3"],
      },
    },
    includeMain: true,
    setupDom: buildMockPortalDom,
  });

  const { document, window, syncStore, lsStore, BP } = env;
  const { CONSTANTS } = BP;

  let lastOnclickTarget = null;
  window.addEventListener(
    CONSTANTS.EVENTS.ONCLICK_CHANGE,
    (e) => {
      lastOnclickTarget = e.target;
    },
    true
  );

  await new Promise((r) => setTimeout(r, 15));

  // Notice ack -> collapses and sets hint nc: true
  const ackBtn = document.querySelector(".bp-notice-ack-btn");
  assert.ok(ackBtn);
  ackBtn.click();
  assert.equal(JSON.parse(lsStore.get(CONSTANTS.HINTS_CACHE_KEY)).nc, true);
  assert.ok(document.querySelector(".bp-notice-unack-btn"));

  // Notice unack -> clears readNoticeBlocks and sets hint nc: false
  document.querySelector(".bp-notice-unack-btn").click();
  assert.equal(JSON.parse(lsStore.get(CONSTANTS.HINTS_CACHE_KEY)).nc, false);
  assert.ok(document.querySelector(".bp-notice-ack-btn"));

  // Enter Edit Mode
  document.querySelector(".bp-settings-btn").click();

  // Toggle navbar in Edit Mode -> keeps focus on toggle button and updates text without rebuilding cards
  const navOverlayBtn = document.querySelector("nav.navbar .bp-toggle-overlay button");
  assert.ok(navOverlayBtn);
  navOverlayBtn.focus();
  navOverlayBtn.click();
  assert.equal(document.activeElement, navOverlayBtn);
  assert.equal(navOverlayBtn.textContent, "ナビバー を表示する");

  // M365 modal update -> updates only M365 card & overlay button
  const m365Card = document.getElementById("div-2");
  m365Card.querySelector(".bp-btn-link").click();
  const m365Form = document.querySelector(".bp-modal-form");
  const outlookRadio = m365Form.querySelector('input[type="radio"][value="outlook"]');
  outlookRadio.checked = true;
  m365Form.dispatchEvent({ type: "submit", preventDefault() {} });
  assert.equal(lastOnclickTarget, m365Card.querySelector("a.service-thumb"));
  assert.equal(m365Card.querySelector(".bp-btn-link").textContent, "リンク先変更 (設定済)");

  // Add custom card -> edit title -> delete via confirm modal
  document.querySelector(".bp-add-card-btn").click();
  const addForm = document.querySelector(".bp-modal-form");
  const [titleInput, urlInput] = addForm.querySelectorAll("input.bp-modal-input");
  titleInput.value = "My Link";
  urlInput.value = "example.com/portal";
  addForm.dispatchEvent({ type: "submit", preventDefault() {} });

  const customCard = document.querySelector("." + CONSTANTS.CLASSES.CUSTOM_CARD);
  assert.ok(customCard);
  assert.equal(customCard.querySelector("a.service-thumb span").textContent, "My Link");

  customCard.querySelector(".bp-btn-edit").click();
  const editForm = document.querySelector(".bp-modal-form");
  editForm.querySelector("input.bp-modal-input").value = "Updated Link";
  editForm.dispatchEvent({ type: "submit", preventDefault() {} });
  assert.equal(customCard.querySelector("a.service-thumb span").textContent, "Updated Link");

  customCard.querySelector(".bp-btn-delete").click();
  const delConfirmForm = document.querySelector(".bp-modal-form");
  assert.ok(delConfirmForm);
  delConfirmForm.dispatchEvent({ type: "submit", preventDefault() {} });
  assert.equal(document.querySelector("." + CONSTANTS.CLASSES.CUSTOM_CARD), null);

  await new Promise((r) => setTimeout(r, 15));
  assert.equal(syncStore.get(CONSTANTS.STORAGE_KEY).customCards.length, 0);
  assert.equal(syncStore.get(CONSTANTS.STORAGE_KEY).hideNavbar, true);
});

test("portal/content.js works cleanly on non-portal /idm/user/* subpages and when loaded during document_start", async () => {
  const env = createPortalTestEnv({
    localStorageInitial: {
      "bp-portal-hints": JSON.stringify({ hn: true }),
    },
    syncInitial: {
      betterPortalSettings: { hideNavbar: true },
    },
    includeMain: true,
    setupDom(doc) {
      doc.readyState = "loading";
      const nav = doc.createElement("nav");
      nav.className = "navbar";
      doc.body.appendChild(nav);
    },
  });

  const { document, BP } = env;
  const { CONSTANTS } = BP;

  // At document_start before DOMContentLoaded: hint attribute applied synchronously
  assert.equal(document.documentElement.getAttribute(CONSTANTS.HINT_ATTRS.HIDE_NAVBAR), "1");
  assert.equal(document.body.classList.contains(CONSTANTS.CLASSES.READY), false);

  // Fire DOMContentLoaded
  document.readyState = "interactive";
  document.dispatchEvent({ type: "DOMContentLoaded" });
  await new Promise((r) => setTimeout(r, 15));

  assert.equal(document.documentElement.getAttribute(CONSTANTS.HINT_ATTRS.HIDE_NAVBAR), null);
  assert.ok(document.body.classList.contains(CONSTANTS.CLASSES.READY));
  assert.equal(document.querySelector("nav.navbar").style.display, "none");
  assert.ok(document.querySelector(".bp-settings-btn"));
});

test("custom card DOM element and image are reused across Reset", async () => {
  const env = createPortalTestEnv({
    syncInitial: {
      betterPortalSettings: {
        customCards: [
          {
            id: "c1",
            title: "Docs",
            url: "https://example.com/docs",
            iconType: "url",
            iconValue: "https://example.com/icon.png",
          },
        ],
        order: ["bp-custom-c1", "div-1", "div-2", "div-3"],
      },
    },
    includeMain: true,
    setupDom: buildMockPortalDom,
  });

  await new Promise((r) => setTimeout(r, 15));

  const { document, syncStore, BP } = env;
  const { CONSTANTS } = BP;
  const mainRow = document.querySelector(CONSTANTS.SELECTOR.SERVICE_ROW);
  const customCardBefore = document.querySelector("#bp-custom-c1");
  const imgBefore = customCardBefore?.querySelector("img.bp-card-image");

  assert.ok(customCardBefore);
  assert.ok(imgBefore);
  assert.deepEqual(
    mainRow.children
      .filter((el) => el.classList.contains(CONSTANTS.CLASSES.SERVICE_CARD))
      .map((el) => el.id),
    ["bp-custom-c1", "div-1", "div-2", "div-3"]
  );

  document.querySelector(".bp-settings-btn").click();
  document.querySelector(".bp-reset-btn").click();

  const modalForm = document.querySelector(".bp-modal-form");
  assert.ok(modalForm);
  modalForm.dispatchEvent({ type: "submit", preventDefault() {} });

  await new Promise((r) => setTimeout(r, 15));

  const customCardAfter = document.querySelector("#bp-custom-c1");
  const imgAfter = customCardAfter?.querySelector("img.bp-card-image");

  assert.equal(customCardAfter, customCardBefore);
  assert.equal(imgAfter, imgBefore);
  assert.deepEqual(
    mainRow.children
      .filter((el) => el.classList.contains(CONSTANTS.CLASSES.SERVICE_CARD))
      .map((el) => el.id),
    ["div-1", "div-2", "div-3", "bp-custom-c1"]
  );
  assert.deepEqual(Array.from(syncStore.get(CONSTANTS.STORAGE_KEY).order), [
    "div-1",
    "div-2",
    "div-3",
    "bp-custom-c1",
  ]);
});

test("drag-and-drop commits reordered cards immediately even when exiting edit mode during settle", async () => {
  const env = createPortalTestEnv({
    includeMain: true,
    setupDom: buildMockPortalDom,
  });

  await new Promise((r) => setTimeout(r, 15));

  const { document, window, syncStore, BP } = env;
  const { CONSTANTS } = BP;
  const mainRow = document.querySelector(CONSTANTS.SELECTOR.SERVICE_ROW);

  mainRow.getBoundingClientRect = () => ({
    left: 0,
    top: 0,
    right: 300,
    bottom: 100,
    width: 300,
    height: 100,
  });
  for (const card of mainRow.children) {
    card.getBoundingClientRect = () => {
      const idx = mainRow.children.indexOf(card);
      const left = idx * 100;
      return { left, top: 0, right: left + 100, bottom: 100, width: 100, height: 100 };
    };
  }

  document.querySelector(".bp-settings-btn").click();

  const overlay1 = document.querySelector("#div-1 .bp-edit-overlay");
  assert.ok(overlay1);

  overlay1.dispatchEvent({
    type: "pointerdown",
    bubbles: true,
    button: 0,
    pointerId: 1,
    pointerType: "mouse",
    clientX: 50,
    clientY: 50,
    preventDefault() {},
  });

  window.dispatchEvent({
    type: "pointermove",
    pointerId: 1,
    pointerType: "mouse",
    clientX: 170,
    clientY: 50,
  });

  await new Promise((r) => setTimeout(r, 5));

  window.dispatchEvent({
    type: "pointerup",
    pointerId: 1,
    pointerType: "mouse",
    clientX: 170,
    clientY: 50,
  });

  // Exit edit mode immediately during the settle window
  document.querySelector(".bp-settings-btn").click();

  assert.equal(document.body.classList.contains(CONSTANTS.CLASSES.EDIT_MODE), false);
  assert.equal(document.querySelector(".bp-drag-ghost"), null);
  assert.equal(document.querySelector(".bp-drop-slot"), null);
  assert.deepEqual(
    mainRow.children
      .filter((el) => el.classList.contains(CONSTANTS.CLASSES.SERVICE_CARD))
      .map((el) => el.id),
    ["div-2", "div-1", "div-3"]
  );

  await new Promise((r) => setTimeout(r, 15));
  assert.deepEqual(Array.from(syncStore.get(CONSTANTS.STORAGE_KEY)?.order || []), [
    "div-2",
    "div-1",
    "div-3",
  ]);
});
