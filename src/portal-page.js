(function () {
  "use strict";

  function applyOnclick(link) {
    if (!(link instanceof Element)) return;
    const onclick = link.dataset.bpOnclick;
    if (typeof onclick !== "string") return;
    delete link.dataset.bpOnclick;

    link.setAttribute("onclick", onclick);

    const match = onclick.match(/doPortal\(\s*(['"])((?:\\\1|(?!\1).)*)\1\s*\)/);
    if (match) {
      const quote = match[1];
      const rawUrl = match[2];
      const unescapedQuote = new RegExp(`\\\\${quote}`, "g");
      const url = rawUrl.replace(unescapedQuote, quote).replace(/\\\\/g, "\\");
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
