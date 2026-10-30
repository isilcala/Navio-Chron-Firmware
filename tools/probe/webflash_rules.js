// Navio Web 统一刷写的纯决策规则；浏览器挂到 NavioWebflashRules，Node 用 require。
(function (root, factory) {
  const api = factory();
  root.NavioWebflashRules = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof self !== "undefined" ? self : globalThis, function () {
  "use strict";

  const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

  function parseSemver(version) {
    if (typeof version !== "string") throw new Error("Invalid SemVer");
    const match = SEMVER.exec(version);
    if (!match) throw new Error(`Invalid SemVer: ${version}`);
    const prerelease = match[4] ? match[4].split(".").map(part =>
      /^\d+$/.test(part) ? { numeric: true, value: Number(part), text: part } :
        { numeric: false, value: part, text: part }) : [];
    if (prerelease.some(part => part.numeric && part.text.length > 1 && part.text[0] === "0"))
      throw new Error(`Invalid SemVer: ${version}`);
    return {
      major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]),
      prerelease,
    };
  }

  function compareSemver(current, target) {
    const a = parseSemver(current), b = parseSemver(target);
    for (const key of ["major", "minor", "patch"]) {
      if (a[key] !== b[key]) return a[key] < b[key] ? -1 : 1;
    }
    if (!a.prerelease.length || !b.prerelease.length) {
      if (a.prerelease.length === b.prerelease.length) return 0;
      return a.prerelease.length ? -1 : 1;
    }
    const length = Math.max(a.prerelease.length, b.prerelease.length);
    for (let i = 0; i < length; ++i) {
      const left = a.prerelease[i], right = b.prerelease[i];
      if (!left) return -1;
      if (!right) return 1;
      if (left.text === right.text) continue;
      if (left.numeric && right.numeric) return left.value < right.value ? -1 : 1;
      if (left.numeric !== right.numeric) return left.numeric ? -1 : 1;
      return left.value < right.value ? -1 : 1;
    }
    return 0;
  }

  function versionPermission(currentVersion, targetVersion, channel) {
    if (channel !== "stable" && channel !== "dev") throw new Error(`Invalid channel: ${channel}`);
    const comparison = compareSemver(currentVersion, targetVersion);
    if (comparison > 0) {
      if (channel === "stable") return { kind: "downgrade", allowed: false, isLatest: false };
      return { kind: "downgrade", allowed: true, isLatest: false, requiresDowngradeConfirm: true };
    }
    if (comparison === 0) {
      if (channel === "stable") return { kind: "latest", allowed: false, isLatest: true };
      return { kind: "reinstall", allowed: true, isLatest: true, requiresReinstallConfirm: true };
    }
    return { kind: "upgrade", allowed: true, isLatest: false };
  }

  function decide(observation) {
    const knownNavio = Boolean(observation.navioConfirmed || observation.hidVisible);
    let path, reason;
    if (observation.serialOnly) {
      path = observation.romSyncOk ? "rom" : "rescue";
      reason = observation.romSyncOk ? "rom-ready" : "rom-sync-failed";
    } else if (knownNavio) {
      if (observation.helloOk && observation.hasOtaCmds) {
        const permission = versionPermission(
          observation.currentVersion, observation.targetVersion, observation.channel);
        path = permission.kind === "latest" ? "latest" : "ota";
        return {
          path, eraseAll: false, versionPermission: permission,
          showEraseWarning: false, showPreserveNotice: false, needsBoot: false,
          reason: permission.kind,
        };
      }
      path = "rescue";
      reason = "navio-needs-boot";
    } else {
      path = "rescue";
      reason = "device-unidentified";
    }
    const eraseAll = path === "rom" && !knownNavio;
    return {
      path, eraseAll, versionPermission: null,
      showEraseWarning: path === "rom" && !knownNavio,
      showPreserveNotice: path === "rom" && knownNavio,
      needsBoot: path === "rescue", reason,
    };
  }

  function hidNumber(value, name) {
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < 0 || parsed > 0xFFFF)
      throw new Error(`Invalid manifest HID ${name}`);
    return parsed;
  }

  function validateManifest(manifest) {
    if (!manifest || manifest.schema !== 1 || manifest.product !== "navio-chron" ||
        manifest.chip !== "esp32s3")
      throw new Error("Unsupported manifest");
    parseSemver(manifest.version);
    if (manifest.channel !== "stable" && manifest.channel !== "dev")
      throw new Error("Invalid manifest channel");
    if (!manifest.hid) throw new Error("Missing manifest HID filter");
    hidNumber(manifest.hid.vendorId, "vendorId");
    hidNumber(manifest.hid.productId, "productId");
    hidNumber(manifest.hid.usagePage, "usagePage");
    hidNumber(manifest.hid.usage, "usage");
    if (!manifest.flash || !["qio", "qout", "dio", "dout"].includes(manifest.flash.mode) ||
        !["40m", "26m", "20m", "80m"].includes(manifest.flash.freq) ||
        !/^\d+(?:KB|MB)$/.test(manifest.flash.size))
      throw new Error("Invalid manifest flash parameters");
    const expected = [
      ["bootloader.bin", 0], ["partitions.bin", 0x8000],
      ["boot_app0.bin", 0xE000], ["firmware.bin", 0x10000],
    ];
    if (!Array.isArray(manifest.images) || manifest.images.length !== expected.length)
      throw new Error("Expected four images");
    expected.forEach(([file, address], index) => {
      const image = manifest.images[index];
      if (!image || image.file !== file || image.address !== address ||
          typeof image.sha256 !== "string" || !/^[0-9a-f]{64}$/.test(image.sha256))
        throw new Error(`Invalid manifest image: ${file}`);
    });
    return manifest;
  }

  return { parseSemver, compareSemver, versionPermission, decide, validateManifest, hidNumber };
});
