(() => {
  "use strict";

  const BP = (globalThis.BetterPortal = globalThis.BetterPortal || {});
  const { CONSTANTS } = BP;

  const NoticeLogic = {
    MAX_BLOCKS_FOR_DIFF: 200,
    BLOCK_SELECTOR: "p, li, h1, h2, h3, h4, h5, h6, blockquote, pre, tr",
    LAYOUT_WRAPPER_TAGS: new Set(["DIV", "SECTION", "ARTICLE", "MAIN", "HEADER", "FOOTER", "ASIDE"]),
    EXTENSION_WIDGET_CLASSES: new Set([
      CONSTANTS.CLASSES.NOTICE_BADGE,
      CONSTANTS.CLASSES.NOTICE_FOOTER,
      CONSTANTS.CLASSES.TOGGLE_OVERLAY,
      CONSTANTS.CLASSES.EDIT_OVERLAY,
      CONSTANTS.CLASSES.NOTICE_FOLD_BAR,
      "bp-notice-fold-icon",
      "bp-notice-fold-label",
      "bp-notice-footer-note",
      "bp-notice-footer-status",
      "bp-notice-ack-btn",
      "bp-notice-unack-btn",
    ]),

    normalizeText(text) {
      return String(text || "").replace(/[\s\u00A0\u3000]+/g, " ").trim();
    },

    hashText(str) {
      let h1 = 0x811c9dc5;
      let h2 = 0x9e3779b1;
      for (let i = 0; i < str.length; i++) {
        const ch = str.charCodeAt(i);
        h1 ^= ch;
        h1 = Math.imul(h1, 0x01000193);
        h2 ^= ch + (i & 0xff);
        h2 = Math.imul(h2, 0x85ebca6b);
      }
      return (h1 >>> 0).toString(36) + "-" + (h2 >>> 0).toString(36);
    },

    isExtensionNode(node) {
      if (!node || node.nodeType !== 1 || !node.classList) return false;
      for (const cls of node.classList) {
        if (this.EXTENSION_WIDGET_CLASSES.has(cls)) return true;
      }
      return false;
    },

    extractRawText(node) {
      if (!node || this.isExtensionNode(node)) return "";
      if (node.nodeType === 3) return node.nodeValue || "";
      if (node.nodeType !== 1) return "";
      if (node.tagName === "BR") return " ";
      let out = "";
      for (const child of node.childNodes) {
        out += this.extractRawText(child);
      }
      return out;
    },

    serializeBlock(el) {
      if (!el || this.isExtensionNode(el)) return "";
      if (el.nodeType === 3) return this.normalizeText(el.nodeValue);
      if (el.nodeType !== 1) return "";

      const text = this.normalizeText(this.extractRawText(el));
      const linkEls = el.matches?.("a[href]") ? [el] : [...el.querySelectorAll("a[href]")];
      const links = linkEls
        .filter((a) => !this.isExtensionNode(a))
        .map((a) => (a.getAttribute("href") || "").trim())
        .filter(Boolean);
      const imgEls = el.matches?.("img[src]") ? [el] : [...el.querySelectorAll("img[src]")];
      const imgs = imgEls
        .filter((img) => !this.isExtensionNode(img))
        .map((img) => `${(img.getAttribute("src") || "").trim()}|${(img.getAttribute("alt") || "").trim()}`)
        .filter((s) => s !== "|");

      if (!text && links.length === 0 && imgs.length === 0) return "";
      return [text, links.join("\t"), imgs.join("\t")].filter(Boolean).join("\n");
    },

    buildAncestorsWithNestedBlock(root) {
      const ancestors = new Set();
      if (!root?.querySelectorAll) return ancestors;

      const blocks = root.querySelectorAll(this.BLOCK_SELECTOR);
      for (const blockEl of blocks) {
        let cur = blockEl.parentElement;
        let insideExtension = this.isExtensionNode(blockEl);
        const chain = [];
        while (cur && cur !== root) {
          if (this.isExtensionNode(cur)) {
            insideExtension = true;
            break;
          }
          chain.push(cur);
          cur = cur.parentElement;
        }
        if (insideExtension) continue;
        for (const ancestor of chain) {
          if (ancestors.has(ancestor)) break;
          ancestors.add(ancestor);
        }
      }
      return ancestors;
    },

    collectBlockEntries(root) {
      if (!root) return [];
      const entries = [];
      const ancestorsWithNestedBlock = this.buildAncestorsWithNestedBlock(root);

      const walk = (container) => {
        for (const node of container.childNodes) {
          if (this.isExtensionNode(node)) continue;
          if (node.nodeType === 3) {
            const text = this.normalizeText(node.nodeValue);
            if (text) {
              entries.push({ element: null, fingerprint: text, hash: this.hashText(text) });
            }
          } else if (node.nodeType === 1) {
            if (ancestorsWithNestedBlock.has(node)) {
              walk(node);
            } else {
              const fp = this.serializeBlock(node);
              if (fp) {
                entries.push({ element: node, fingerprint: fp, hash: this.hashText(fp) });
              }
            }
          }
        }
      };

      walk(root);
      return entries;
    },

    extractBlockData(root) {
      const entries = this.collectBlockEntries(root);
      if (entries.length === 0) {
        return { hashes: [], entries: [], collapsedToSingleHash: false };
      }
      if (entries.length > this.MAX_BLOCKS_FOR_DIFF) {
        return {
          hashes: [this.hashText(entries.map((e) => e.fingerprint).join("\n"))],
          entries,
          collapsedToSingleHash: true,
        };
      }
      return {
        hashes: [...new Set(entries.map((e) => e.hash))],
        entries,
        collapsedToSingleHash: false,
      };
    },

    evaluateNoticeState(currentHashes, readHashes) {
      const current = Array.isArray(currentHashes) ? currentHashes : [];
      const read = Array.isArray(readHashes) ? readHashes : [];
      if (current.length === 0) {
        return {
          status: "empty",
          hasMixedReadAndUnseen: false,
          shouldPrune: read.length > 0,
          prunedReadHashes: [],
        };
      }
      const readSet = new Set(read);
      if (current.some((h) => !readSet.has(h))) {
        return {
          status: "unread",
          hasMixedReadAndUnseen: read.length > 0 && current.some((h) => readSet.has(h)),
          shouldPrune: false,
          prunedReadHashes: read,
        };
      }
      const currentSet = new Set(current);
      const uniqueRead = [...new Set(read)];
      const pruned = uniqueRead.filter((h) => currentSet.has(h));
      return {
        status: "read",
        hasMixedReadAndUnseen: false,
        shouldPrune: pruned.length !== read.length,
        prunedReadHashes: pruned,
      };
    },

    collectFoldGroups(root, entries, readSet) {
      if (!root || !Array.isArray(entries) || entries.length === 0) return [];
      const groups = [];
      const ancestorsWithNestedBlock = this.buildAncestorsWithNestedBlock(root);

      // 各要素からルートまでの祖先マップを事前構築し、classifyUnit を O(1) 化する
      const entriesByAncestor = new Map();
      for (const entry of entries) {
        if (!entry.element) continue;
        let cur = entry.element;
        while (cur && cur !== root) {
          let list = entriesByAncestor.get(cur);
          if (!list) {
            list = [];
            entriesByAncestor.set(cur, list);
          }
          list.push(entry);
          cur = cur.parentElement;
        }
      }

      const classifyUnit = (el) => {
        const matched = entriesByAncestor.get(el);
        if (!matched || matched.length === 0) {
          return { kind: "spacer", hashes: [] };
        }
        if (matched.every((e) => readSet.has(e.hash))) {
          return {
            kind: "read",
            hashes: matched.map((e) => e.hash),
          };
        }
        return { kind: "unseen", hashes: [] };
      };

      const walkContainer = (container) => {
        let currentUnits = [];
        let trailingSpacers = [];
        let currentHashes = [];

        const flush = () => {
          if (currentUnits.length > 0) {
            groups.push({
              elements: currentUnits,
              anchor: currentUnits[0],
              key: `${groups.length}:${currentHashes.join("|")}`,
            });
          }
          currentUnits = [];
          trailingSpacers = [];
          currentHashes = [];
        };

        for (const node of container.childNodes) {
          if (this.isExtensionNode(node)) continue;
          if (node.nodeType === 3) {
            if (this.normalizeText(node.nodeValue)) flush();
            continue;
          }
          if (node.nodeType !== 1) continue;

          if (this.LAYOUT_WRAPPER_TAGS.has(node.tagName) && ancestorsWithNestedBlock.has(node)) {
            flush();
            walkContainer(node);
            continue;
          }

          const info = classifyUnit(node);
          if (info.kind === "read") {
            if (currentUnits.length > 0 && trailingSpacers.length > 0) {
              currentUnits.push(...trailingSpacers);
            }
            trailingSpacers = [];
            currentUnits.push(node);
            currentHashes.push(...info.hashes);
          } else if (info.kind === "spacer") {
            if (currentUnits.length > 0) {
              trailingSpacers.push(node);
            }
          } else {
            flush();
          }
        }

        flush();
      };

      walkContainer(root);
      return groups;
    },
  };

  BP.NoticeLogic = NoticeLogic;
})();
