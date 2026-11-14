(function () {
  "use strict";

  function applyOnclick(link) {
    if (!(link instanceof Element)) return;
    const onclick = link.dataset.bpOnclick;
    if (typeof onclick !== "string") return;
    delete link.dataset.bpOnclick;

    if (!onclick) return;

    link.setAttribute("onclick", onclick);

    const match = onclick.match(/doPortal\(\s*(['"])((?:\\.|(?!\1).)*)\1\s*\)/);
    if (match) {
      const rawUrl = match[2];
      const url = rawUrl.replace(/\\(.)/g, "$1");
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

  document.querySelectorAll("a[data-bp-onclick]").forEach(applyOnclick);
})();
