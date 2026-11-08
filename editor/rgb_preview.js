// 与 LedController 对齐的纯网页灯效计算；不接触设备或 DOM。
(function (root, factory) {
  const api = factory();
  root.NavioRgbPreview = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof self !== "undefined" ? self : globalThis, function () {
  "use strict";

  const KEY_COUNT = 12;
  const KEY_ORDER = [0, 1, 2, 3, 4, 5, 6, 11, 10, 9, 7, 8];
  const FADE_MS = 500, BREATH_CYCLE_MS = 9000, COLOR_CYCLE_MS = 16000, MARQUEE_STEP_MS = 1200;
  const MODE_COLORS = { 0: "无", 1: "主题色", 2: "随机色", 3: "主题色", 4: "主题色", 5: "随机色", 6: "随机色", 7: "随机色", 8: "主题色", 9: "随机色" };
  const MODE_GROUPS = [
    { label: "基础", modes: [0, 3] },
    { label: "按键触发", modes: [1, 2] },
    { label: "整体变化", modes: [4, 5, 6, 7] },
    { label: "流动拖尾", modes: [8, 9] },
  ];
  const mod = (value, divisor) => ((value % divisor) + divisor) % divisor;
  const uint8 = value => mod(value, 256);
  const colorLevel = (accent, level, smooth = false) => accent.map(channel => smooth ? channel * level / 255 : Math.floor(channel * level / 255));

  function hsvToRgb(hue, smooth = false) {
    const value = smooth ? mod(hue, 256) : uint8(Math.floor(hue)), region = Math.floor(value / 43), offset = (value - region * 43) * 6;
    switch (region) {
      case 0: return [255, offset, 0];
      case 1: return [255 - offset, 255, 0];
      case 2: return [0, 255, offset];
      case 3: return [0, 255 - offset, 255];
      case 4: return [offset, 0, 255];
      default: return [255, 0, 255 - offset];
    }
  }
  function hueLevel(hue, level, smooth = false) { return colorLevel(hsvToRgb(hue, smooth), level, smooth); }
  function createRandom(seed) {
    let state = (seed >>> 0) || 0x6D2B79F5;
    return previous => {
      let hue = previous;
      for (let attempt = 0; attempt < 4 && hue === previous; ++attempt) {
        state ^= state << 13; state ^= state >>> 17; state ^= state << 5;
        hue = state & 0xFF;
      }
      return hue === previous ? uint8(previous + 1) : hue;
    };
  }
  function representativeTime(mode) {
    if (mode === 4 || mode === 5) return 4250;
    if (mode === 6 || mode === 7) return 6000;
    return 0;
  }
  function createPreview({ mode = 1, accent = [255, 120, 40], seed = 0x6D2B79F5, smooth = false } = {}) {
    let rgbMode = mode, currentAccent = [...accent], startedAt = 0, breathCycle = null, breathHue = 0;
    let random = createRandom(seed);
    const accentLevel = level => colorLevel(currentAccent, level, smooth), hueAt = (hue, level) => hueLevel(hue, level, smooth);
    const held = Array(KEY_COUNT).fill(false), fadeStartedAt = Array(KEY_COUNT).fill(null), keyHues = Array(KEY_COUNT).fill(0);
    const blank = () => Array.from({ length: KEY_COUNT }, () => [0, 0, 0]);

    function restart(now = 0) {
      startedAt = now; breathCycle = null;
      held.fill(false); fadeStartedAt.fill(null);
    }
    function setMode(mode, now = 0) { rgbMode = mode; restart(now); }
    function setAccent(accent) { currentAccent = [...accent]; }
    function press(key, now = 0) {
      if (![1, 2].includes(rgbMode) || key < 0 || key >= KEY_COUNT) return;
      held[key] = true; fadeStartedAt[key] = null;
      if (rgbMode === 2) keyHues[key] = random(keyHues[key]);
    }
    function release(key, now = 0) {
      if (!held[key]) return;
      held[key] = false; fadeStartedAt[key] = now;
    }
    function releaseAll(now = 0) {
      for (let key = 0; key < KEY_COUNT; ++key) if (held[key]) release(key, now);
    }
    function sample(now) {
      const elapsed = Math.max(0, now - startedAt), colors = blank();
      if (rgbMode === 1 || rgbMode === 2) {
        for (let key = 0; key < KEY_COUNT; ++key) {
          let level = 0;
          if (held[key]) level = 255;
          else if (fadeStartedAt[key] !== null) {
            const fadeElapsed = now - fadeStartedAt[key];
            level = fadeElapsed >= FADE_MS ? 0 : 255 - Math.floor(fadeElapsed * 255 / FADE_MS);
            if (fadeElapsed >= FADE_MS) fadeStartedAt[key] = null;
          }
          colors[key] = rgbMode === 2 ? hueAt(keyHues[key], level) : accentLevel(level);
        }
      } else if (rgbMode === 3) {
        for (let key = 0; key < KEY_COUNT; ++key) colors[key] = accentLevel(255);
      } else if (rgbMode === 4 || rgbMode === 5) {
        const phase = elapsed % BREATH_CYCLE_MS;
        if (rgbMode === 5 && Math.floor(elapsed / BREATH_CYCLE_MS) !== breathCycle) {
          breathCycle = Math.floor(elapsed / BREATH_CYCLE_MS); breathHue = random(breathHue);
        }
        let level = 0;
        if (phase < 8500) {
          const linear = phase < 4000 ? Math.floor(phase * 255 / 4000) : phase < 4500 ? 255 : Math.floor((8500 - phase) * 255 / 4000);
          level = Math.floor(linear * linear * (3 * 255 - 2 * linear) / (255 * 255));
        }
        for (let key = 0; key < KEY_COUNT; ++key)
          colors[key] = rgbMode === 5 ? hueAt(breathHue, level) : accentLevel(level);
      } else if (rgbMode === 6 || rgbMode === 7) {
        const baseHue = smooth ? (elapsed % COLOR_CYCLE_MS) * 256 / COLOR_CYCLE_MS : Math.floor((elapsed % COLOR_CYCLE_MS) * 256 / COLOR_CYCLE_MS);
        if (rgbMode === 6) {
          const color = hsvToRgb(baseHue, smooth);
          for (let key = 0; key < KEY_COUNT; ++key) colors[key] = color;
        } else {
          for (let position = 0; position < KEY_COUNT; ++position)
            colors[KEY_ORDER[position]] = hsvToRgb(baseHue - Math.floor(position * 256 / KEY_COUNT), smooth);
        }
      } else if (rgbMode === 8 || rgbMode === 9) {
        const phase = elapsed % (MARQUEE_STEP_MS * KEY_COUNT), baseHue = smooth ? (elapsed % COLOR_CYCLE_MS) * 256 / COLOR_CYCLE_MS : Math.floor((elapsed % COLOR_CYCLE_MS) * 256 / COLOR_CYCLE_MS);
        const head = Math.floor(phase * 256 / MARQUEE_STEP_MS);
        for (let position = 0; position < KEY_COUNT; ++position) {
          const ahead = mod(position * 256 + KEY_COUNT * 256 - head, KEY_COUNT * 256);
          let level = 0;
          if (ahead < 256) {
            const rise = 256 - ahead;
            level = rise === 256 ? 255 : Math.floor(rise * rise / 256);
          }
          const distance = (head + KEY_COUNT * 256 - position * 256) % (KEY_COUNT * 256);
          if (distance < 4 * 256) {
            const remaining = 4 * 256 - distance;
            const tail = Math.floor(255 * remaining * remaining / (16 * 65536));
            if (tail > level) level = tail;
          }
          const key = KEY_ORDER[position];
          colors[key] = rgbMode === 9 ? hueAt(baseHue, level) : accentLevel(level);
        }
      }
      return colors;
    }
    return { setMode, setAccent, restart, press, release, releaseAll, sample, representativeTime: () => representativeTime(rgbMode) };
  }

  return { KEY_COUNT, KEY_ORDER, MODE_COLORS, MODE_GROUPS, FADE_MS, BREATH_CYCLE_MS, COLOR_CYCLE_MS, MARQUEE_STEP_MS,
    hsvToRgb, createRandom, createPreview, representativeTime };
});
