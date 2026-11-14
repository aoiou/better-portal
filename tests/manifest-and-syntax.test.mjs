import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { SRC_DIR, getPortalScriptList } from "./helpers/test-helpers.mjs";

test("manifest.json is valid and all referenced assets exist in src/", () => {
  const manifestPath = path.join(SRC_DIR, "manifest.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));

  assert.equal(manifest.manifest_version, 3);
  assert.ok(manifest.action?.default_popup);
  assert.ok(fs.existsSync(path.join(SRC_DIR, manifest.action.default_popup)));
  assert.ok(fs.existsSync(path.join(SRC_DIR, manifest.background.service_worker)));

  for (const iconPath of Object.values(manifest.icons)) {
    assert.ok(fs.existsSync(path.join(SRC_DIR, iconPath)), `Missing icon: ${iconPath}`);
  }

  for (const cs of manifest.content_scripts) {
    for (const jsFile of cs.js || []) {
      assert.ok(fs.existsSync(path.join(SRC_DIR, jsFile)), `Missing content script: ${jsFile}`);
    }
    for (const cssFile of cs.css || []) {
      assert.ok(fs.existsSync(path.join(SRC_DIR, cssFile)), `Missing content CSS: ${cssFile}`);
    }
  }

  const portalScripts = getPortalScriptList(true);
  assert.ok(portalScripts.length >= 2);
  assert.equal(portalScripts[portalScripts.length - 1], "portal/content.js");
});

test("all JavaScript files under src/ pass Node syntax check", () => {
  const jsFiles = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith(".js")) jsFiles.push(full);
    }
  };
  walk(SRC_DIR);

  assert.ok(jsFiles.length >= 12);
  for (const file of jsFiles) {
    execFileSync(process.execPath, ["--check", file]);
  }
});
