const assert = require('node:assert/strict');
const R = require('./rgb_preview.js');
let passed = 0;
function test(name, fn) { try { fn(); console.log(`PASS ${name}`); ++passed; } catch (error) { console.error(`FAIL ${name}`); throw error; } }
const accent = [255, 120, 40];
const brightness = color => Math.max(...color);

test('HSV conversion matches firmware hue anchors', () => {
  assert.deepEqual(R.hsvToRgb(0), [255, 0, 0]);
  assert.deepEqual(R.hsvToRgb(43), [255, 255, 0]);
  assert.deepEqual(R.hsvToRgb(85), [3, 255, 0]);
  assert.deepEqual(R.hsvToRgb(128), [0, 255, 252]);
  assert.deepEqual(R.hsvToRgb(170), [0, 9, 255]);
  assert.deepEqual(R.hsvToRgb(255), [255, 0, 15]);
});
test('reactive starts dark and holds the accent while pressed', () => {
  const preview = R.createPreview({ mode: 0, accent });
  assert.equal(brightness(preview.sample(0)[0]), 0);
  preview.press(0, 100);
  assert.deepEqual(preview.sample(100)[0], accent);
  assert.deepEqual(preview.sample(500)[0], accent);
});
test('reactive fades for 500ms and then turns off', () => {
  const preview = R.createPreview({ mode: 0, accent });
  preview.press(0, 100); preview.release(0, 600);
  assert.deepEqual(preview.sample(600)[0], accent);
  assert.deepEqual(preview.sample(850)[0], [128, 60, 20]);
  assert.equal(brightness(preview.sample(1100)[0]), 0);
});
test('releaseAll releases every held key', () => {
  const preview = R.createPreview({ mode: 0, accent });
  preview.press(0, 0); preview.press(4, 0); preview.releaseAll(100);
  assert.equal(brightness(preview.sample(700)[0]), 0);
  assert.equal(brightness(preview.sample(700)[4]), 0);
});
test('random reactive colors are deterministic by seed', () => {
  const first = R.createPreview({ mode: 5, seed: 123 }), second = R.createPreview({ mode: 5, seed: 123 });
  first.press(0, 0); second.press(0, 0);
  assert.deepEqual(first.sample(0), second.sample(0));
  assert.notEqual(brightness(first.sample(0)[0]), 0);
});
test('follow keeps all keys at the accent', () => {
  const colors = R.createPreview({ mode: 2, accent }).sample(1000);
  assert.equal(colors.every(color => color.join(',') === accent.join(',')), true);
});
test('breath reaches both endpoints and holds the peak', () => {
  const preview = R.createPreview({ mode: 1, accent });
  assert.equal(brightness(preview.sample(0)[0]), 0);
  assert.equal(brightness(preview.sample(4000)[0]), 255);
  assert.equal(brightness(preview.sample(4500)[0]), 255);
  assert.equal(brightness(preview.sample(8500)[0]), 0);
  assert.equal(brightness(preview.sample(8999)[0]), 0);
});
test('breath has smooth intermediate brightness and repeats after 9s', () => {
  const preview = R.createPreview({ mode: 1, accent });
  const middle = brightness(preview.sample(2000)[0]);
  assert.equal(middle > 0 && middle < 255, true);
  assert.equal(brightness(preview.sample(9000)[0]), 0);
});
test('random breath chooses a new deterministic hue per cycle', () => {
  const preview = R.createPreview({ mode: 6, seed: 123 });
  const first = preview.sample(4250)[0], second = preview.sample(9000 + 4250)[0];
  assert.notDeepEqual(first, second);
});
test('color cycle changes all keys together', () => {
  const preview = R.createPreview({ mode: 3 });
  const first = preview.sample(0), second = preview.sample(4000);
  assert.equal(new Set(first.map(color => color.join(','))).size, 1);
  assert.notDeepEqual(first[0], second[0]);
});
test('rainbow flow follows the physical outer-ring order', () => {
  const colors = R.createPreview({ mode: 4 }).sample(0);
  for (let position = 0; position < R.KEY_COUNT; ++position)
    assert.deepEqual(colors[R.KEY_ORDER[position]], R.hsvToRgb(-Math.floor(position * 256 / R.KEY_COUNT)));
});
test('theme marquee has a full head and three fading tails', () => {
  const colors = R.createPreview({ mode: 7, accent }).sample(0);
  const levels = R.KEY_ORDER.map(key => brightness(colors[key]));
  assert.deepEqual([levels[0], levels[9], levels[10], levels[11]], [255, 15, 63, 143]);
  assert.equal(levels.slice(1, 9).every(level => level === 0), true);
});
test('marquee interpolates the next rising key and keeps the tail maximum', () => {
  const colors = R.createPreview({ mode: 7, accent }).sample(600);
  const headLevel = brightness(colors[R.KEY_ORDER[0]]), nextLevel = brightness(colors[R.KEY_ORDER[1]]);
  assert.equal(headLevel > nextLevel, true);
  assert.equal(nextLevel >= 64, true);
});
test('marquee has four lights at alignment and five while the next key rises', () => {
  const preview = R.createPreview({ mode: 7, accent });
  const count = time => preview.sample(time).filter(color => brightness(color) > 0).length;
  assert.equal(count(0), 4);
  assert.equal(count(600), 5);
});
test('blue breath preserves its hue instead of mixing to gray', () => {
  const preview = R.createPreview({ mode: 1, accent: [0, 0, 255], smooth: true });
  const color = preview.sample(500)[0];
  assert.equal(color[0] === 0 && color[1] === 0 && color[2] > 0, true);
});
test('both marquee modes advance clockwise one outer-ring position per step', () => {
  for (const mode of [7, 8]) {
    const preview = R.createPreview({ mode, accent });
    assert.equal(brightness(preview.sample(0)[R.KEY_ORDER[0]]), 255);
    assert.equal(brightness(preview.sample(1200)[R.KEY_ORDER[1]]), 255);
    assert.equal(brightness(preview.sample(2400)[R.KEY_ORDER[2]]), 255);
  }
});
test('rainbow marquee changes hue over time while retaining its tail', () => {
  const preview = R.createPreview({ mode: 8 });
  const first = preview.sample(0), second = preview.sample(4000);
  assert.notDeepEqual(first[R.KEY_ORDER[0]], second[R.KEY_ORDER[0]]);
  assert.equal(brightness(second[R.KEY_ORDER[1]]) > 0, true);
});
test('thumbnail marquee wraps after ten visible positions without hidden steps', () => {
  assert.equal(R.thumbnailTime(7, 10800), 10800);
  assert.equal(R.thumbnailTime(7, 12000), 0);
  assert.equal(R.thumbnailTime(8, 12000), 0);
  assert.equal(R.thumbnailTime(1, 12000), 12000);
});
test('restart clears held keys and restarts the effect timeline', () => {
  const preview = R.createPreview({ mode: 7, accent });
  preview.sample(6000); preview.restart(10000);
  assert.deepEqual(preview.sample(10000), R.createPreview({ mode: 7, accent }).sample(0));
});
test('representative breath frame uses the bright hold', () => {
  assert.equal(R.representativeTime(1), 4250);
  assert.equal(brightness(R.createPreview({ mode: 1, accent }).sample(R.representativeTime(1))[0]), 255);
});
test('mode groups expose every mode once', () => {
  assert.deepEqual(R.MODE_GROUPS.flatMap(group => group.modes).sort((a, b) => a - b), [0, 1, 2, 3, 4, 5, 6, 7, 8]);
});
console.log(`All ${passed} RGB preview checks passed.`);
