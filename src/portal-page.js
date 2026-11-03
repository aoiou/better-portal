(function () {
  "use strict";

  function applyOnclick(link) {
    if (!(link instanceof Element)) return;
    const onclick = link.dataset.bpOnclick;
    if (typeof onclick !== "string") return;
    delete link.dataset.bpOnclick;

    link.setAttribute("onclick", onclick);

    const match = onclick.match(/doPortal\(\s*'((?:\\'|[^'])*)'\s*\)/);
    if (match) {
      const url = match[1].replace(/\\'/g, "'").replace(/\\\\/g, "\\");
      link.onclick = function () {
        if (typeof window.doPortal === "function") {
          return window.doPortal(url);
        }
        return false;
      };
    }
  }

  window.addEventListener(
    "bp-onclick-change",
    (e) => {
      applyOnclick(e.target);
    },
    true
  );

  // オリジナルカードのクリック時、ポータル標準の doPortal(url) で遷移する
  window.addEventListener(
    "bp-open-card",
    (e) => {
      const link = e.target;
      if (!(link instanceof Element)) return;
      const url = link.dataset.bpOpenUrl;
      delete link.dataset.bpOpenUrl;
      if (typeof url !== "string" || !/^https?:\/\//i.test(url)) return;
      if (typeof window.doPortal === "function") {
        window.doPortal(url);
      } else {
        window.open(url, "_blank", "noopener");
      }
    },
    true
  );

  document.querySelectorAll("a[data-bp-onclick]").forEach(applyOnclick);
})();
