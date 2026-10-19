#!/usr/bin/env node
/*
 * Builds per-browser extension folders from src/ into dist/<target>/ and
 * (with --zip) packages Firefox and Chrome as zip files.
 *
 *   node scripts/build.mjs            # all targets
 *   node scripts/build.mjs firefox    # one target
 *   node scripts/build.mjs --zip      # also create dist/*.zip
 */
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));

// Keep in sync with IDP_ORIGIN / LOGIN_PATH in src/background.js and src/content.js.
// TU Wien uses a single form (username + password + #totp) on this page; the
// extension runs nowhere else.
const SITE = {
  matches: ["https://idp.zid.tuwien.ac.at/simplesaml/module.php/core/loginuserpass*"]
};

const COMMON_FILES = ["totp.js", "background.js", "content.js", "options.html", "options.js", "options.css", "icons"];

function baseManifest() {
  return {
    manifest_version: 3,
    name: "TOTP Autofill für TU Wien",
    short_name: "TU TOTP",
    version: pkg.version,
    description: "Erzeugt den TOTP-Code für den TU Wien Login lokal und füllt ihn automatisch ein.",
    icons: { 16: "icons/icon-16.png", 32: "icons/icon-32.png", 48: "icons/icon-48.png", 96: "icons/icon-96.png", 128: "icons/icon-128.png" },
    permissions: ["storage"],
    content_scripts: [
      {
        matches: SITE.matches,
        js: ["content.js"],
        run_at: "document_idle",
        all_frames: false
      }
    ],
    options_ui: { page: "options.html", open_in_tab: true },
    commands: {
      "fill-totp": {
        suggested_key: { default: "Alt+Shift+O" },
        description: "TOTP-Code jetzt einfüllen"
      }
    }
  };
}

const TARGETS = {
  firefox: {
    files: COMMON_FILES,
    manifest() {
      return {
        ...baseManifest(),
        background: { scripts: ["totp.js", "background.js"] },
        browser_specific_settings: {
          gecko: {
            id: "tuwien-totp-autofill@candlelightner.github.io",
            strict_min_version: "140.0",
            data_collection_permissions: { required: ["none"] }
          },
          gecko_android: { strict_min_version: "142.0" }
        }
      };
    }
  },
  chrome: {
    files: [...COMMON_FILES, "service-worker.js"],
    manifest() {
      return {
        ...baseManifest(),
        minimum_chrome_version: "120",
        background: { service_worker: "service-worker.js" }
      };
    }
  },
  safari: {
    files: [...COMMON_FILES, "service-worker.js"],
    manifest() {
      const manifest = {
        ...baseManifest(),
        background: { service_worker: "service-worker.js" },
        // iOS Safari has no options-page entry point, so expose the settings as popup.
        action: { default_popup: "options.html", default_title: "TOTP Autofill", default_icon: { 16: "icons/icon-16.png", 32: "icons/icon-32.png", 48: "icons/icon-48.png" } },
        browser_specific_settings: { safari: { strict_min_version: "16.4" } }
      };
      return manifest;
    }
  }
};

function build(target) {
  const out = join(root, "dist", target);
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  for (const file of TARGETS[target].files) {
    cpSync(join(root, "src", file), join(out, file), { recursive: true });
  }
  writeFileSync(join(out, "manifest.json"), JSON.stringify(TARGETS[target].manifest(), null, 2) + "\n");
  return out;
}

function zip(target, dir) {
  const file = join(root, "dist", `tuwien-totp-autofill-${target}-${pkg.version}.zip`);
  rmSync(file, { force: true });
  execFileSync("zip", ["-q", "-r", "-X", file, "."], { cwd: dir, stdio: "inherit" });
  return file;
}

const args = process.argv.slice(2);
const wantZip = args.includes("--zip");
const selected = args.filter((a) => !a.startsWith("--"));
const targets = selected.length ? selected : Object.keys(TARGETS);

for (const target of targets) {
  if (!TARGETS[target]) {
    console.error(`Unknown target "${target}". Valid: ${Object.keys(TARGETS).join(", ")}`);
    process.exit(1);
  }
  const dir = build(target);
  console.log(`built  ${target.padEnd(8)} -> ${dir}`);
  if (wantZip && target !== "safari") console.log(`zipped ${target.padEnd(8)} -> ${zip(target, dir)}`);
}
