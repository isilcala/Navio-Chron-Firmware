// 运行：node tools/probe/webflash_rules_test.js
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const R = require("./webflash_rules.js");

let passed = 0;
function ok(name) { passed++; console.log("PASS", name); }
function assert(cond, msg) { if (!cond) throw new Error("assert: " + msg); }
function equal(actual, expected, name) {
  assert(Object.is(actual, expected), `${name}: expected ${expected}, got ${actual}`);
  ok(name);
}
function throws(fn, name) {
  try { fn(); } catch (_) { ok(name); return; }
  throw new Error(`${name}: expected error`);
}
function manifest() {
  return {
    schema: 1, product: "navio-chron", version: "0.4.0-dev", channel: "dev", chip: "esp32s3",
    hid: { vendorId: "0xCAFE", productId: "0xBEEF", usagePage: "0xFF00", usage: 1 },
    flash: { size: "4MB", mode: "dio", freq: "80m" },
    images: [
      { file: "bootloader.bin", address: 0, sha256: "0".repeat(64) },
      { file: "partitions.bin", address: 0x8000, sha256: "1".repeat(64) },
      { file: "boot_app0.bin", address: 0xE000, sha256: "2".repeat(64) },
      { file: "firmware.bin", address: 0x10000, sha256: "3".repeat(64) },
    ],
  };
}

equal(R.compareSemver("0.4.0-dev", "0.4.0"), -1, "pre-release sorts before stable");
equal(R.compareSemver("0.4.0", "0.4.0-dev"), 1, "stable sorts after pre-release");
equal(R.compareSemver("0.4.0-alpha.2", "0.4.0-alpha.10"), -1, "numeric pre-release identifiers");
equal(R.compareSemver("0.4.0-alpha", "0.4.0-alpha.1"), -1, "shorter pre-release set sorts first");
equal(R.compareSemver("0.4.0-alpha.9", "0.4.0-beta"), -1, "numeric identifiers sort before text");
equal(R.compareSemver("0.4.0+build.1", "0.4.0+build.2"), 0, "build metadata is ignored");
equal(R.compareSemver("0.4.10", "0.4.2"), 1, "numeric patch comparison");
equal(R.compareSemver("0.4.0-dev", "0.4.0-dev"), 0, "same dev version");
throws(() => R.parseSemver("0.4.0-01"), "numeric pre-release leading zero rejected");
throws(() => R.parseSemver("0.4"), "incomplete version rejected");

equal(R.versionPermission("0.3.9", "0.4.0", "stable").kind, "upgrade", "stable upgrade allowed");
equal(R.versionPermission("0.4.0", "0.4.0", "stable").kind, "latest", "stable same version is latest");
equal(R.versionPermission("0.4.0", "0.4.0", "stable").allowed, false, "stable latest blocks writes");
equal(R.versionPermission("0.4.0", "0.3.9", "stable").allowed, false, "stable downgrade rejected");
equal(R.versionPermission("0.4.0-dev", "0.4.0-dev", "dev").kind, "reinstall", "dev same version reinstall");
equal(R.versionPermission("0.4.0-dev", "0.4.0-dev", "dev").requiresReinstallConfirm, true,
  "dev reinstall requires explicit confirmation");
equal(R.versionPermission("0.4.0", "0.4.0-dev", "dev").kind, "downgrade", "stable to dev is downgrade");
equal(R.versionPermission("0.4.0", "0.4.0-dev", "dev").requiresDowngradeConfirm, true,
  "dev downgrade requires explicit confirmation");
equal(R.versionPermission("0.4.0-dev", "0.4.0", "stable").kind, "upgrade", "dev to stable is upgrade");

const ota = R.decide({ hidVisible: true, helloOk: true, hasOtaCmds: true,
  currentVersion: "0.3.0", targetVersion: "0.4.0-dev", channel: "dev" });
equal(ota.path, "ota", "capable Navio selects OTA");
equal(ota.eraseAll, false, "OTA never requests flash erase");
const latest = R.decide({ hidVisible: true, helloOk: true, hasOtaCmds: true,
  currentVersion: "0.4.0", targetVersion: "0.4.0", channel: "stable" });
equal(latest.path, "latest", "stable latest is a terminal path");
equal(R.decide({ hidVisible: true, helloOk: false, hasOtaCmds: false }).path, "rescue",
  "HID identity with failed HELLO enters rescue");
equal(R.decide({ navioConfirmed: true, helloOk: true, hasOtaCmds: false }).path, "rescue",
  "Navio without OTA commands enters rescue");
const preserved = R.decide({ navioConfirmed: true, serialOnly: true, romSyncOk: true });
equal(preserved.path, "rom", "confirmed Navio continues to ROM after BOOT");
equal(preserved.eraseAll, false, "session identity survives BOOT and serial re-enumeration");
equal(preserved.showPreserveNotice, true, "confirmed Navio shows preset preservation notice");
const unknown = R.decide({ serialOnly: true, romSyncOk: true });
equal(unknown.eraseAll, true, "unknown serial-only ROM defaults to clean flash");
equal(unknown.showEraseWarning, true, "unknown serial-only ROM shows erase warning");
equal(R.decide({ serialOnly: true, romSyncOk: false }).path, "rescue",
  "failed no_reset sync enters rescue");
equal(R.decide({ serialOnly: true, romSyncOk: false }).eraseAll, false,
  "failed ROM sync cannot request an erase");
equal(R.decide({}).path, "rescue", "no observable device enters rescue");
equal(R.decide({ navioConfirmed: true, serialOnly: true, romSyncOk: false }).path, "rescue",
  "confirmed identity does not bypass failed ROM sync");

const valid = manifest();
equal(R.validateManifest(valid), valid, "valid manifest accepted");
const wrongChip = manifest(); wrongChip.chip = "esp32";
throws(() => R.validateManifest(wrongChip), "wrong chip manifest rejected");
const wrongSha = manifest(); wrongSha.images[0].sha256 = "xyz";
throws(() => R.validateManifest(wrongSha), "bad SHA-256 rejected");
const wrongAddress = manifest(); wrongAddress.images[3].address = 0;
throws(() => R.validateManifest(wrongAddress), "wrong image address rejected");
const wrongVersion = manifest(); wrongVersion.version = "0.4";
throws(() => R.validateManifest(wrongVersion), "bad manifest SemVer rejected");
const wrongChannel = manifest(); wrongChannel.channel = "beta";
throws(() => R.validateManifest(wrongChannel), "bad manifest channel rejected");

const flasherSource = fs.readFileSync(path.join(__dirname, "webunified_probe.html"), "utf8");
const editorSource = fs.readFileSync(path.join(__dirname, "../../editor/app.js"), "utf8");
equal(flasherSource.includes('value="/release/latest/manifest.json"'), true,
  "local flasher uses the generated latest manifest");
equal(editorSource.includes("LOCAL_SERVER ? '/release/latest/manifest.json'"), true,
  "local editor update check uses the generated latest manifest");
assert(!/release\/navio_chron_\d/.test(flasherSource + editorSource));
ok("local Web entry points contain no versioned release path");
equal(flasherSource.includes('id="connectSerial" class="button secondary">串口模式刷写</button>'), true,
  "serial flashing has a separate secondary action");
equal(flasherSource.includes('id="rescueConnect" class="button primary">我已完成，选择设备</button>'), true,
  "BOOT rescue has its own connection action");
assert(!flasherSource.includes("$('connect').textContent = '选择设备串口'"));
ok("application connection never mutates into the serial action");
equal((flasherSource.match(/正在写入固件，请保持 USB 连接，不要关闭页面。/g) || []).length, 2,
  "OTA and ROM writes replace the confirmation prompt with progress guidance");
equal(flasherSource.includes("if (!writeCompleted) throw error;"), true,
  "ROM write failures still propagate before the write completes");
equal(flasherSource.includes("自动重启未完成，请按 RST 或重新插拔。"), true,
  "post-write reset failures request manual restart instead of reporting an incomplete write");
equal((flasherSource.match(/点击“去配置预设”后，请在新页面再次点击“连接设备”。/g) || []).length, 2,
  "OTA and ROM success messages direct users to reconnect in the preset editor");
equal(flasherSource.includes('id="backToConnect" class="button secondary">返回上一步</button>'), true,
  "latest and success states offer a secondary return action");
equal(flasherSource.includes("$('backToConnect').onclick"), true,
  "return action is connected to the connection-stage state");

console.log(`\nAll ${passed} checks passed.`);
