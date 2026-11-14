(() => {
  "use strict";

  const BP = (globalThis.BetterPortal = globalThis.BetterPortal || {});
  const { CONSTANTS } = BP;

  const M365_REDIRECT_METHODS = {
    LOGIN_SRF: "login_srf",
    DOMAIN_HINT: "domain_hint",
  };
  const M365_METHOD_LABELS = {
    [M365_REDIRECT_METHODS.DOMAIN_HINT]: "新方式",
    [M365_REDIRECT_METHODS.LOGIN_SRF]: "旧方式",
  };
  const M365_DOMAIN_HINT = "mail.doshisha.ac.jp";
  const M365_CUSTOM_OPTION_ID = "custom";
  const M365_REDIRECT_PRESETS = [
    {
      id: "default",
      label: "デフォルト",
      description: "ポータル標準のリンク先を使用",
      url: "",
      method: M365_REDIRECT_METHODS.DOMAIN_HINT,
    },
    {
      id: "onedrive",
      label: "OneDrive (SharePoint)",
      description: "大学のOneDriveを開く",
      url: "https://doshishaacjp-my.sharepoint.com/my",
      method: M365_REDIRECT_METHODS.LOGIN_SRF,
      badge: M365_METHOD_LABELS[M365_REDIRECT_METHODS.LOGIN_SRF],
    },
    {
      id: "outlook",
      label: "Outlook",
      variants: [
        {
          id: M365_REDIRECT_METHODS.DOMAIN_HINT,
          label: M365_METHOD_LABELS[M365_REDIRECT_METHODS.DOMAIN_HINT],
          description: "ヒントをつけてOutlookを開く",
          url: "https://outlook.cloud.microsoft/mail/",
          method: M365_REDIRECT_METHODS.DOMAIN_HINT,
        },
        {
          id: M365_REDIRECT_METHODS.LOGIN_SRF,
          label: M365_METHOD_LABELS[M365_REDIRECT_METHODS.LOGIN_SRF],
          description: "ポータル経由でOutlookを開く",
          url: "https://outlook.office.com/mail/",
          method: M365_REDIRECT_METHODS.LOGIN_SRF,
        },
      ],
    },
  ];
  const M365_METHOD_OPTIONS = [
    {
      id: M365_REDIRECT_METHODS.DOMAIN_HINT,
      label: M365_METHOD_LABELS[M365_REDIRECT_METHODS.DOMAIN_HINT],
      description: "ヒントをつけて開く",
    },
    {
      id: M365_REDIRECT_METHODS.LOGIN_SRF,
      label: M365_METHOD_LABELS[M365_REDIRECT_METHODS.LOGIN_SRF],
      description: "ポータル経由で開く",
    },
  ];

  function normalizeUrl(input) {
    let value = (input || "").trim();
    if (!value) return null;
    if (!/^https?:\/\//i.test(value)) {
      if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) return null;
      if (/^[a-z][a-z0-9+.-]*:/i.test(value) && !/^[^/]+:\d+(\/|$)/.test(value)) return null;
      value = "https://" + value;
    }
    try {
      const url = new URL(value);
      if (url.protocol !== "http:" && url.protocol !== "https:") return null;
      return url.href;
    } catch {
      return null;
    }
  }

  function normalizeM365Method(method, fallback = M365_REDIRECT_METHODS.DOMAIN_HINT) {
    if (method === M365_REDIRECT_METHODS.LOGIN_SRF || method === M365_REDIRECT_METHODS.DOMAIN_HINT) {
      return method;
    }
    return fallback;
  }

  function findM365PresetMatch(url, method = M365_REDIRECT_METHODS.DOMAIN_HINT) {
    const trimmed = (url || "").trim();
    if (!trimmed) {
      return { preset: M365_REDIRECT_PRESETS[0], variant: null };
    }
    const normalized = normalizeUrl(trimmed);
    if (!normalized) return null;
    const normalizedMethod = normalizeM365Method(method);

    for (const preset of M365_REDIRECT_PRESETS) {
      if (Array.isArray(preset.variants)) {
        const variant = preset.variants.find(
          (v) => v.url === normalized && v.method === normalizedMethod
        );
        if (variant) return { preset, variant };
      } else if (preset.url === normalized && preset.method === normalizedMethod) {
        return { preset, variant: null };
      }
    }
    return null;
  }

  function buildM365DomainHintUrl(inputUrl, domainHint = M365_DOMAIN_HINT) {
    const targetUrl = normalizeUrl(inputUrl);
    if (!targetUrl) return null;
    const url = new URL(targetUrl);
    const hasDomainHint = [...url.searchParams.keys()].some(
      (key) => key.toLowerCase() === "domain_hint"
    );
    if (!hasDomainHint) {
      url.searchParams.set("domain_hint", domainHint);
    }
    return url.href;
  }

  function isM365Card(el) {
    if (el.classList.contains(CONSTANTS.CLASSES.CUSTOM_CARD)) return false;
    const spanText = el.querySelector("span")?.textContent?.trim();
    if (spanText === "Microsoft365") return true;

    const link = el.querySelector("a.service-thumb");
    const currentOnclick = link?.getAttribute("onclick") || "";
    const originalOnclick = link?.dataset.bpOriginalOnclick || "";
    return currentOnclick.includes("login.microsoftonline.com") ||
      originalOnclick.includes("login.microsoftonline.com");
  }

  function replaceOnclickUrl(originalOnclick, targetUrl) {
    const quotedUrlPattern = /(['"])https?:\/\/(?:\\.|(?!\1).)*\1/i;
    const quotedMatch = originalOnclick.match(quotedUrlPattern);
    if (quotedMatch) {
      const quote = quotedMatch[1];
      const escaped = targetUrl.replace(/\\/g, "\\\\").replaceAll(quote, `\\${quote}`);
      return originalOnclick.replace(quotedUrlPattern, () => `${quote}${escaped}${quote}`);
    }
    const escaped = targetUrl.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
    return originalOnclick.replace(/https?:\/\/[^'"]+/i, () => escaped);
  }

  function buildM365Onclick(originalOnclick, inputUrl, method = M365_REDIRECT_METHODS.DOMAIN_HINT) {
    if (!originalOnclick) return originalOnclick;
    const normalizedMethod = normalizeM365Method(method);
    const targetUrl = normalizedMethod === M365_REDIRECT_METHODS.DOMAIN_HINT
      ? buildM365DomainHintUrl(inputUrl)
      : normalizeUrl(inputUrl);
    if (!targetUrl) return originalOnclick;

    if (
      normalizedMethod === M365_REDIRECT_METHODS.DOMAIN_HINT ||
      /^https?:\/\/login\.microsoftonline\.com\//i.test(targetUrl) ||
      !/[?&]wreply=/i.test(originalOnclick)
    ) {
      return replaceOnclickUrl(originalOnclick, targetUrl);
    }
    return originalOnclick.replace(
      /([?&]wreply=)[^'&"]+/i,
      (_match, p1) => p1 + encodeURIComponent(targetUrl)
    );
  }

  function applyM365Redirect(el, settings) {
    if (!isM365Card(el)) return;
    const link = el.querySelector("a.service-thumb");
    if (!link) return;

    if (!("bpOriginalOnclick" in link.dataset)) {
      link.dataset.bpOriginalOnclick = link.getAttribute("onclick") || "";
    }

    const originalOnclick = link.dataset.bpOriginalOnclick;
    if (!originalOnclick) return;

    const customUrl = settings.m365RedirectUrl?.trim();
    const method = normalizeM365Method(settings.m365RedirectMethod);
    const targetOnclick = customUrl
      ? buildM365Onclick(originalOnclick, customUrl, method)
      : originalOnclick;

    if (link.getAttribute("onclick") !== targetOnclick) {
      link.dataset.bpOnclick = targetOnclick;
      link.dispatchEvent(new CustomEvent(CONSTANTS.EVENTS.ONCLICK_CHANGE, { bubbles: true }));
    }
  }

  BP.UrlM365 = {
    M365_REDIRECT_METHODS,
    M365_METHOD_LABELS,
    M365_DOMAIN_HINT,
    M365_CUSTOM_OPTION_ID,
    M365_REDIRECT_PRESETS,
    M365_METHOD_OPTIONS,
    normalizeUrl,
    normalizeM365Method,
    findM365PresetMatch,
    buildM365DomainHintUrl,
    isM365Card,
    replaceOnclickUrl,
    buildM365Onclick,
    applyM365Redirect,
  };
})();
