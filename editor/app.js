import { renderDevice, escapeHtml } from './device_svg.js?v=20261107-37';

const P = NavioEditorPreset, L = NavioEditorLibrary, D = NavioEditorDevice, T = NavioEditorTemplates,
  R = NavioWebflashRules, RGB = NavioRgbPreview, TB = NavioTemplateBrowser, $ = id => document.getElementById(id);
const STORAGE_KEY = 'navio-editor-library-v1';
const INSTALLATION_KEY = 'navio-editor-template-installations-v1';
const PLATFORM = { win: 'Windows', mac: 'macOS', ipad: 'iPadOS' };
const PLATFORM_SHORT = { win: 'Win', mac: 'Mac', ipad: 'iPad' };
const ASSET_VERSION = '20261107-37';
const LOCAL_SERVER = ['localhost', '127.0.0.1'].includes(location.hostname);
const RELEASE_MANIFEST_URL = LOCAL_SERVER ? '/release/navio_chron_0.5.26/manifest.json' : './manifest.json';
const FLASHER_URL = LOCAL_SERVER ? '/tools/probe/webunified_probe.html' : './firmware/';
const uuid = () => crypto.randomUUID ? crypto.randomUUID() : `local-${Date.now()}-${Math.random()}`;
const platformOf = preset => P.normalizePlatform(preset?.platform);
const accentHex = preset => `#${preset.accent.map(value => value.toString(16).padStart(2, '0')).join('')}`;

let templates = [], templateGroups = [], userPresets = [], devicePresets = [], selectedKey = null, booted = false;
let templateQuery = '', templatePlatform = /Mac|iPhone|iPad/.test(navigator.userAgent) ? 'mac' : 'win';
let libraryTab = 'library', workspaceTab = 'mapping', selectedInput = { type: 'btn', index: 0 };
let deviceConnection = null, deviceClient = null, activeDeviceId = 0, deviceBusy = false;
let deviceGeneration = 0, deviceFirmware = null, updateDismissed = false;
let editSession = null, pendingAfterEdit = null, pendingDeleteKey = null, pendingKeyboardDeleteId = null;
let operationMessage = null, toastTimer, libraryLoadError = null, librarySaveError = null;
let quarantinedPresets = [], templateInstallations = loadTemplateInstallations();
let previewEngine = null, previewEngineKey = '', previewElapsed = 0, previewLastTick = 0, previewLastPaint = 0;
let previewFrame = 0, previewPlaying = !matchMedia('(prefers-reduced-motion: reduce)').matches, previewSpeed = 1;
let previewSeed = 0x6D2B79F5, previewHeld = new Set();
let thumbnailEngines = new Map(), thumbnailSignature = '', thumbnailElapsed = 0, thumbnailPulseStates = new Map();
let previewDeviceLeds = [], thumbnailLeds = new Map();

for (const id of ['flashLink', 'firmwareFlashLink']) $(id).href = FLASHER_URL;
for (const dialog of document.querySelectorAll('dialog')) {
  const title = dialog.querySelector('h2');
  if (!title) continue;
  title.id ||= `${dialog.id}Title`;
  dialog.setAttribute('aria-labelledby', title.id);
}

function loadTemplateInstallations() {
  try {
    const saved = JSON.parse(localStorage.getItem(INSTALLATION_KEY));
    if (!saved || typeof saved !== 'object' || Array.isArray(saved)) return {};
    return Object.fromEntries(Object.entries(saved).filter(([key, id]) =>
      /^[a-z0-9-]+$/.test(key) && Number.isInteger(id) && id >= 1 && id <= 255));
  } catch { return {}; }
}
function saveTemplateInstallations() {
  try { localStorage.setItem(INSTALLATION_KEY, JSON.stringify(templateInstallations)); return true; }
  catch { return false; }
}
async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP ${response.status}：${url}`);
  return response.json();
}
async function checkFirmwareUpdate(currentVersion) {
  const generation = deviceGeneration;
  try {
    const release = await fetchJson(RELEASE_MANIFEST_URL);
    R.validateManifest(release);
    if (generation !== deviceGeneration || R.compareSemver(currentVersion, release.version) >= 0) return;
    $('updateBannerText').textContent = `当前固件 ${currentVersion}，可更新至 ${release.version}；不影响继续编辑预设。`;
    if (!updateDismissed) $('updateBanner').hidden = false;
  } catch (error) { console.warn('Firmware update check failed:', error); }
}
async function loadOfficialTemplates() {
  const index = await fetchJson(`presets/index.json?v=${ASSET_VERSION}`);
  if (!index || !Array.isArray(index.templates)) throw new Error('index.json 格式不受支持');
  const entries = await Promise.all(index.templates.map(async item => {
    try { return { file: item.file, json: await fetchJson(`presets/${item.file}?v=${ASSET_VERSION}`) }; }
    catch { return { file: item.file, json: null }; }
  }));
  return T.buildTemplates(entries);
}
async function boot() {
  try {
    const loaded = await loadOfficialTemplates();
    templates = loaded.templates;
    templates.forEach(preset => {
      preset._readonly = true;
      preset._installedId = templateInstallations[preset.templateId] || null;
    });
    if (!templates.length) throw new Error(loaded.errors[0] || '项目模板库为空');
    templateGroups = TB.buildTemplateGroups(templates);
    selectedKey = keyFor('template', defaultTemplate());
    userPresets = loadUserPresets();
    booted = true;
    renderEditor();
    if (loaded.errors.length) toast(`跳过 ${loaded.errors.length} 套无效项目模板：${loaded.errors[0]}`, true);
    else if (libraryLoadError) toast(`本地预设库读取失败：${libraryLoadError.message}。原数据未改动，本次修改不会保存。`, true);
    else if (librarySaveError) toast(`本地库已读取，但启动清理或模板决定未能保存：${librarySaveError.message}`, true);
    else if (quarantinedPresets.length) toast(`${quarantinedPresets.length} 套预设无法读取已跳过，原始数据已保留`, true);
  } catch (error) {
    $('saveSummaryTitle').textContent = '项目模板加载失败';
    $('saveSummaryDetail').textContent = error.message;
    $('writePreset').disabled = true;
    toast('项目模板加载失败，页面功能不可用；请刷新重试', true);
  }
}
function persistLibrary(list) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(L.packageLibrary([...list, ...quarantinedPresets])));
}
function loadUserPresets() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    const loaded = [];
    for (const preset of L.migrateLegacy(saved).userPresets) {
      if (L.userPresetError(preset, P)) quarantinedPresets.push(preset);
      else loaded.push(preset);
    }
    let normalized = false;
    for (const preset of loaded) {
      if (preset._readonly !== false) { preset._readonly = false; normalized = true; }
      for (const field of ['templateId', '_device']) {
        if (Object.hasOwn(preset, field)) { delete preset[field]; normalized = true; }
      }
      if (preset._installedId !== undefined && preset._installedId !== null &&
          (!Number.isInteger(preset._installedId) || preset._installedId < 1 || preset._installedId > 255)) {
        delete preset._installedId; normalized = true;
      }
      if (preset.platform !== undefined && !P.PLATFORMS.includes(preset.platform)) {
        preset.platform = 'win'; normalized = true;
      }
    }
    const synced = L.syncTemplates(loaded, templates, (preset, template) =>
      confirm(`项目模板“${template.name}”已更新，是否用新版替换你的预设“${preset.name}”？`));
    if (normalized || synced) {
      try { persistLibrary(loaded); }
      catch (error) { librarySaveError = error; }
    }
    return loaded;
  } catch (error) { libraryLoadError = error; return []; }
}
function saveLibrary(list = userPresets) {
  if (libraryLoadError) return false;
  try {
    persistLibrary(list);
    librarySaveError = null;
    return true;
  } catch (error) {
    librarySaveError = error;
    operationMessage = { text: `保存到我的预设失败：${error.message}。修改仍保留在当前编辑会话。`, error: true };
    return false;
  }
}
function downloadBlob(content, filename, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob), link = document.createElement('a');
  link.href = url; link.download = filename; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return blob;
}
function toast(message, error = false) {
  const element = $('toast');
  element.textContent = message;
  element.classList.toggle('error', error);
  element.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => element.classList.remove('show'), 3200);
}
function openDialog(id) { $(id).showModal(); }
function closeDialog(id) { if ($(id).open) $(id).close(); }
function closePopovers() { $('colorPopover').hidden = true; $('platformPopover').hidden = true; }

function keyFor(source, preset) {
  return source === 'local' ? `local:${preset.uuid}` : L.sourceKey(source, preset);
}
function findByKey(key) {
  if (!key) return null;
  if (key.startsWith('template:')) return templates.find(preset => keyFor('template', preset) === key) || null;
  if (key.startsWith('local:')) return userPresets.find(preset => keyFor('local', preset) === key) || null;
  if (key.startsWith('device:')) return devicePresets.find(preset => keyFor('device', preset) === key) || null;
  return null;
}
function currentSource() { return editSession?.source || selectedKey?.split(':')[0] || 'template'; }
function currentOriginal() { return findByKey(editSession?.sourceKey || selectedKey); }
function currentPreset() { return editSession?.working || currentOriginal() || templates[0]; }
function defaultTemplate() { return TB.variantForPlatform(templateGroups[0]?.items[0], templatePlatform) || templates[0]; }
function keyboardOriginal() { return editSession?.source === 'device' ? editSession.original : null; }
function editingKeyboard() { return editSession?.source === 'device'; }
function sourceCopy(preset, source = currentSource()) {
  return L.existingSourceCopy(userPresets, keyFor(source, preset));
}
function linkedDevice(preset) {
  return devicePresets.find(item => item.id === preset?._installedId) || null;
}
function hasKeyboardChanges(preset) {
  const linked = linkedDevice(preset);
  return Boolean(linked && !D.samePresetContent(preset, linked));
}
function nextPresetId() {
  const ids = [...templates, ...userPresets, ...quarantinedPresets, ...devicePresets]
    .map(preset => preset?.id).filter(id => Number.isInteger(id));
  return Math.max(...ids, 0) + 1;
}
function syncInstalledState() {
  if (!deviceClient) return;
  let changed = false;
  for (const preset of userPresets) {
    const dirty = hasKeyboardChanges(preset);
    if (Boolean(preset._dirty) !== dirty) { preset._dirty = dirty; changed = true; }
    if (!dirty) preset._dirtySlots = [];
  }
  if (changed) saveLibrary();
}

function sourceLabel() {
  if (editSession) return `${editingKeyboard() ? '键盘预设' : '我的预设'} · 编辑中`;
  return { template: '项目模板', local: '我的预设', device: '键盘中的预设' }[currentSource()];
}
function presetItem(preset, source, display = {}) {
  const key = keyFor(source, preset), active = display.active ?? key === selectedKey;
  const linked = source === 'device' ? null : linkedDevice(preset);
  let subline = display.subline || PLATFORM[platformOf(preset)];
  if (source === 'template' && linked && !display.subline) subline += ' · 已安装';
  if (source === 'local') subline = linked ? (hasKeyboardChanges(preset) ? '已安装 · 有修改' : '已安装 · 与键盘一致') : '未安装';
  if (source === 'device') {
    subline = `${PLATFORM[platformOf(preset)]}${preset.id === activeDeviceId ? ' · 使用中' : ''}${editSession?.sourceKey === key ? ' · 编辑中' : ''}`;
  }
  const badge = source === 'device' && preset.id === activeDeviceId
    ? '<span class="state-chip">使用中</span>' : `<span class="platform-chip">${PLATFORM_SHORT[platformOf(preset)]}</span>`;
  const existing = source === 'local' ? null : sourceCopy(preset, source);
  const copyLabel = source === 'local' ? '复制预设' : existing ? '打开我的副本' : '复制到我的预设';
  const actions = editSession || source === 'device' ? '' : `<span class="preset-item-actions">
    <button class="preset-card-action" data-copy="${escapeHtml(key)}" aria-label="${copyLabel} ${escapeHtml(preset.name)}" title="${copyLabel}"><svg viewBox="0 0 20 20" aria-hidden="true"><rect x="6" y="6" width="9" height="10" rx="2"></rect><path d="M4 13V4a2 2 0 0 1 2-2h7"></path></svg></button>
    ${source === 'local' ? `<button class="preset-card-action delete" data-delete="${escapeHtml(key)}" aria-label="删除 ${escapeHtml(preset.name)}" title="删除我的预设"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M3 5h14M8 2h4l1 3H7l1-3ZM5 5l1 13h8l1-13M9 8v7M12 8v7"></path></svg></button>` : ''}
  </span>`;
  return `<div class="preset-item ${active ? 'active' : ''}" data-preset="${escapeHtml(key)}" role="button" tabindex="0">
    <span class="preset-swatch" style="background:${accentHex(preset)}"></span>
    <span class="preset-item-copy"><strong>${escapeHtml(preset.name)}</strong><small>${escapeHtml(subline)}</small></span>
    <span class="preset-item-tail"><span class="preset-item-badge">${badge}</span>${actions}</span>
  </div>`;
}
function templateFamilyItem(item) {
  const preset = TB.variantForPlatform(item, templatePlatform);
  const platforms = item.variants.map(variant => PLATFORM_SHORT[platformOf(variant)]).join(' / ');
  const installed = item.variants.some(variant => linkedDevice(variant));
  return presetItem(preset, 'template', {
    active: item.variants.some(variant => keyFor('template', variant) === selectedKey),
    subline: `${platforms}${installed ? ' · 已安装' : ''}`,
  });
}
function renderLibrary() {
  document.querySelectorAll('[data-library-tab]').forEach(button => {
    const active = button.dataset.libraryTab === libraryTab;
    button.classList.toggle('active', active);
    button.setAttribute('aria-selected', String(active));
  });
  const filteredGroups = TB.filterTemplateGroups(templateGroups, templateQuery);
  const applicationCount = TB.countTemplateItems(filteredGroups);
  $('deviceCount').textContent = devicePresets.length;
  $('libraryToolbar').hidden = libraryTab !== 'library';
  $('resetLibrary').hidden = libraryTab !== 'library';
  $('templateSearchField').hidden = libraryTab !== 'library';
  $('templateSearchStatus').textContent = libraryTab === 'library' && templateQuery
    ? `项目模板筛选出 ${applicationCount} 个应用` : '';
  $('resetLibrary').textContent = libraryLoadError ? '备份并重建本地库' : '清空我的预设';
  $('resetLibrary').classList.toggle('recovery-action', Boolean(libraryLoadError || quarantinedPresets.length));
  if (!deviceClient && libraryTab === 'device') {
    const current = editingKeyboard() ? keyboardOriginal() : null;
    $('libraryContent').innerHTML = '<div class="library-heading"><h2>连接已断开</h2></div>' +
      (current ? `<div class="preset-list">${presetItem(current, 'device')}</div><div class="library-empty">当前修改仍在编辑中。重新连接后可保存到键盘。</div>`
        : '<div class="library-empty">连接键盘后，查看已安装的预设和当前使用顺序。</div>');
    return;
  }
  if (libraryTab === 'device') {
    const selected = currentSource() === 'device' ? currentOriginal() || keyboardOriginal() : null;
    const selectedIndex = selected ? devicePresets.findIndex(item => item.id === selected.id) : -1;
    const existing = selected ? sourceCopy(selected, 'device') : null;
    $('libraryContent').innerHTML = `<div class="device-summary"><strong>键盘中的预设</strong><span>${devicePresets.length}/6 套</span></div>
      <div class="preset-list">${devicePresets.map(preset => presetItem(preset, 'device')).join('')}</div>
      <p class="device-order-hint">预设顺序决定短按侧键时的循环顺序。</p>
      <div class="device-management"><button id="moveDeviceUp" class="button secondary">上移</button><button id="moveDeviceDown" class="button secondary">下移</button>
      <button id="deleteKeyboardPreset" class="button danger">从键盘删除</button></div>
      <div class="keyboard-copy"><button id="copyDevicePreset" class="button secondary">${existing ? '打开我的副本' : '复制到我的预设'}</button></div>`;
    $('moveDeviceUp').disabled = deviceBusy || selectedIndex <= 0 || Boolean(editSession);
    $('moveDeviceDown').disabled = deviceBusy || selectedIndex < 0 || selectedIndex >= devicePresets.length - 1 || Boolean(editSession);
    $('deleteKeyboardPreset').disabled = deviceBusy || !selected || devicePresets.length <= 1 || Boolean(editSession);
    $('copyDevicePreset').disabled = !selected || Boolean(editSession);
    $('moveDeviceUp').onclick = () => moveSelectedDevice(-1);
    $('moveDeviceDown').onclick = () => moveSelectedDevice(1);
    $('deleteKeyboardPreset').onclick = () => openKeyboardDelete(selected);
    $('copyDevicePreset').onclick = () => copyPresetByKey(keyFor('device', selected));
    return;
  }
  const templateGroupsHtml = filteredGroups.map(group => `<section class="template-group" aria-labelledby="template-group-${group.id}">
    <div class="library-heading"><h3 id="template-group-${group.id}">${escapeHtml(group.label)}</h3><span class="library-count">${group.items.length}</span></div>
    <div class="preset-list">${group.items.map(templateFamilyItem).join('')}</div>
  </section>`).join('');
  $('libraryContent').innerHTML = `<div class="library-heading"><h2>我的预设</h2></div>
    <div class="preset-list">${userPresets.length ? userPresets.map(preset => presetItem(preset, 'local')).join('') : '<div class="library-empty">从项目模板或键盘显式复制后，独立预设会保存在这里。</div>'}</div>
    <div class="library-heading"><h2>项目模板</h2><span class="library-count">${applicationCount} 个应用</span></div>
    ${applicationCount ? `<div class="template-groups">${templateGroupsHtml}</div>` : '<div class="library-empty">没有匹配的项目模板，请尝试其他关键词。</div>'}`;
}

function focusSelector() {
  const element = document.activeElement;
  if (!element || element === document.body) return null;
  if (element.id) return `#${CSS.escape(element.id)}`;
  if (element.dataset.input === 'btn') return `[data-input="btn"][data-index="${element.dataset.index}"]`;
  if (element.dataset.input === 'encoder') return `[data-input="encoder"][data-id="${element.dataset.id}"]`;
  if (element.dataset.actionField) {
    const slot = element.closest('[data-slot]')?.dataset.slot;
    return slot === undefined ? null : `[data-slot="${slot}"] [data-action-field="${element.dataset.actionField}"]`;
  }
  if (element.dataset.actionBit) {
    const slot = element.closest('[data-slot]')?.dataset.slot;
    return slot === undefined ? null : `[data-slot="${slot}"] [data-action-bit="${element.dataset.actionBit}"]`;
  }
  if (element.name === 'rgbMode') return `input[name="rgbMode"][value="${element.value}"]`;
  const item = element.closest('[data-preset]');
  if (item) return `[data-preset="${item.dataset.preset}"]`;
  if (element.dataset.libraryTab) return `[data-library-tab="${element.dataset.libraryTab}"]`;
  if (element.dataset.workspaceTab) return `[data-workspace-tab="${element.dataset.workspaceTab}"]`;
  if (element.dataset.platform) return `[data-platform="${element.dataset.platform}"]`;
  if (element.dataset.color) return `[data-color="${element.dataset.color}"]`;
  return null;
}
function restoreFocus(selector) {
  if (selector) document.querySelector(selector)?.focus({ preventScroll: true });
}
function clearPreviewPulses() { previewHeld.clear(); }
function ensurePreviewEngine() {
  const preset = currentPreset(), key = `${editSession?.sourceKey || selectedKey}:${preset.rgbMode}`;
  if (key !== previewEngineKey) {
    clearPreviewPulses();
    previewEngine = RGB.createPreview({ mode: preset.rgbMode, accent: preset.accent, seed: previewSeed, smooth: true });
    previewEngineKey = key; previewElapsed = 0;
  }
  previewEngine.setAccent(preset.accent);
  return previewEngine;
}
function paintPreviewLed(element, color, glow = true) {
  const level = Math.max(...color) / 255;
  const background = [224, 229, 236];
  const cssColor = `rgb(${color.map((channel, index) => Math.round(background[index] + (channel - background[index]) * level)).join(',')})`;
  element.setAttribute('fill', cssColor);
  element.style.backgroundColor = cssColor;
  element.style.opacity = level === 0 ? '0' : '1';
  element.style.filter = glow && level > 0.45
    ? `drop-shadow(0 0 9px rgb(${color.join(',')})) drop-shadow(0 0 20px rgb(${color.join(',')}))` : 'none';
}
function samplePreview(now, thumbnailNow = now) {
  const colors = ensurePreviewEngine().sample(now);
  previewDeviceLeds.forEach((led, index) => paintPreviewLed(led, colors[index]));
  for (const [mode, engine] of thumbnailEngines) {
    let frame;
    if ([1, 2].includes(mode)) {
      let state = thumbnailPulseStates.get(mode);
      if (!state) { state = { cycle: -1, key: 0, releaseAt: null }; thumbnailPulseStates.set(mode, state); }
      const cycle = Math.floor(thumbnailNow / 2000);
      if (state.cycle !== cycle) {
        state.cycle = cycle; state.key = cycle % RGB.KEY_COUNT;
        engine.press(state.key, cycle * 2000); state.releaseAt = cycle * 2000 + 500;
      }
      if (state.releaseAt !== null && thumbnailNow >= state.releaseAt) {
        engine.release(state.key, state.releaseAt); state.releaseAt = null;
      }
      frame = engine.sample(thumbnailNow);
    } else frame = engine.sample(thumbnailNow);
    thumbnailLeds.get(mode)?.forEach(led => paintPreviewLed(led, frame[Number(led.dataset.key)], false));
  }
}
function previewTick(now) {
  const delta = Math.min(100, now - previewLastTick);
  previewLastTick = now; previewElapsed += delta * previewSpeed; thumbnailElapsed += delta * previewSpeed;
  if (now - previewLastPaint >= 16) { samplePreview(previewElapsed, thumbnailElapsed); previewLastPaint = now; }
  previewFrame = requestAnimationFrame(previewTick);
}
function syncPreviewAnimation() {
  // 离开灯光页即停止动画；映射页的局部更新可重绘设备，重新进入时在此重建缓存。
  cancelAnimationFrame(previewFrame); previewFrame = 0;
  previewDeviceLeds = [...$('deviceStage').querySelectorAll('.key-slot .key-led')];
  thumbnailLeds = new Map([...thumbnailEngines.keys()].map(mode => [mode, [...document.querySelectorAll(`[data-effect-thumb="${mode}"] i`)]]));
  if (workspaceTab !== 'lighting') return;
  const engine = ensurePreviewEngine();
  samplePreview(previewPlaying ? previewElapsed : engine.representativeTime(), thumbnailElapsed);
  if (previewPlaying && !document.hidden) {
    previewLastTick = performance.now(); previewLastPaint = 0;
    previewFrame = requestAnimationFrame(previewTick);
  }
}
function setPreviewKeyPressed(index, pressed) {
  const engine = ensurePreviewEngine();
  if (pressed) { engine.press(index, previewElapsed); previewHeld.add(index); }
  else { engine.release(index, previewElapsed); previewHeld.delete(index); }
  samplePreview(previewElapsed, thumbnailElapsed);
}
function renderDeviceCanvas() {
  const focus = focusSelector(), preset = currentPreset();
  const lighting = workspaceTab === 'lighting', engine = lighting ? ensurePreviewEngine() : null;
  const previewColors = lighting ? engine.sample(previewPlaying ? previewElapsed : engine.representativeTime()) : null;
  renderDevice($('deviceStage'), {
    actions: preset.actions,
    actionLabel: action => P.actionLabel(action, platformOf(preset)),
    selected: workspaceTab === 'mapping' ? selectedInput : {},
    accent: preset.accent,
    lighting,
    previewColors,
    onLightInput: lighting && [1, 2].includes(preset.rgbMode) ? setPreviewKeyPressed : null,
    onSelect: input => {
      if (lighting) return;
      selectedInput = input;
      workspaceTab = 'mapping';
      renderWorkspaceTabs(); renderDeviceCanvas(); renderInspector(); syncPreviewAnimation();
    },
  });
  $('canvasHintText').textContent = lighting ? '点击右侧卡片预览；网页示意不代表实机效果' : '点击键位或旋钮查看设置';
  restoreFocus(focus);
}
function renderWorkspaceTabs() {
  document.querySelectorAll('[data-workspace-tab]').forEach(button => {
    const active = button.dataset.workspaceTab === workspaceTab;
    button.classList.toggle('active', active);
    button.setAttribute('aria-selected', String(active));
  });
}
function keyOptions(selected) {
  const onlyModifiers = `<option value="0" ${selected === 0 ? 'selected' : ''}>仅修饰键</option>`;
  return onlyModifiers + P.KEY_GROUPS.map(group => `<optgroup label="${group.label}">${P.KEY_OPTIONS.filter(option => option.group === group.id)
    .map(option => `<option value="${option.code}" ${option.code === selected ? 'selected' : ''}>${escapeHtml(option.optionLabel || option.label)}</option>`).join('')}</optgroup>`).join('');
}
function modifierGroup(labels, start, mods, readonly) {
  return `<div class="modifier-group"><span class="modifier-group-label">${start ? '右侧' : '左侧'}</span><div class="modifiers">${labels.slice(start, start + 4).map((label, offset) => {
    const bit = start + offset;
    return `<label class="modifier"><input type="checkbox" data-action-bit="${1 << bit}" ${mods & (1 << bit) ? 'checked' : ''} ${readonly ? 'disabled' : ''}>${label.replace(/^R/, '右')}</label>`;
  }).join('')}</div></div>`;
}
function actionForm(preset, slot, compact = false) {
  const action = preset.actions[slot], readonly = currentSource() === 'template' && !editSession, isButton = slot < 16;
  const labels = P.modLabels(platformOf(preset));
  const typeName = action.kind === P.Kind.None ? '未设置' : action.kind === P.Kind.KeyChord ? '快捷键' : action.kind === P.Kind.Consumer ? '媒体控制' : '滚轮';
  const direction = slot >= 16 ? (slot % 2 === 0 ? '顺时针' : '逆时针') : '下压';
  return `<div class="action-card" data-slot="${slot}">
    ${compact ? `<div class="action-card-title"><strong>${direction}</strong><span>${typeName}</span></div>` : ''}
    <label class="field">动作类型<select data-action-field="kind" ${readonly ? 'disabled' : ''}>
      <option value="0" ${action.kind === 0 ? 'selected' : ''}>未设置</option>
      <option value="1" ${action.kind === 1 ? 'selected' : ''}>快捷键</option>
      <option value="2" ${action.kind === 2 ? 'selected' : ''}>媒体控制</option>
      ${!isButton ? `<option value="3" ${action.kind === 3 ? 'selected' : ''}>滚轮</option>` : ''}
    </select></label>
    ${action.kind === P.Kind.KeyChord ? `<label class="field">键码<select data-action-field="code" ${readonly ? 'disabled' : ''}>${keyOptions(action.code)}</select></label>` : ''}
    ${action.kind === P.Kind.KeyChord || action.kind === P.Kind.Wheel ? `<div class="field">修饰键<div class="modifier-groups">${modifierGroup(labels, 0, action.mods, readonly)}${modifierGroup(labels, 4, action.mods, readonly)}</div></div>` : ''}
    ${action.kind === P.Kind.Consumer ? `<label class="field">功能<select data-action-field="code" ${readonly ? 'disabled' : ''}>${P.CONSUMER_OPTIONS.map(option => `<option value="${option.code}" ${option.code === action.code ? 'selected' : ''}>${option.label}</option>`).join('')}</select></label>` : ''}
    ${action.kind === P.Kind.Wheel ? `<label class="field">滚动格数<input type="number" min="-127" max="127" value="${action.wheelDy}" data-action-field="wheelDy" ${readonly ? 'disabled' : ''}><small>正数向下滚动，负数向上滚动</small></label>` : ''}
    <small class="field-error action-error" role="alert" hidden></small>
  </div>`;
}
function inspectorHeading(label, title, description, editable = true) {
  let action = '';
  if (!editSession && editable && currentSource() === 'template') {
    const text = sourceCopy(currentPreset(), 'template') ? '编辑副本' : '复制并编辑';
    action = `<button class="button secondary start-edit" data-action="edit-current">${text}</button>`;
  }
  return `<div class="inspector-heading"><div class="inspector-heading-copy"><span class="selection-label">${label}</span><h2>${title}</h2><p>${description}</p></div>${action}</div>`;
}
const THUMB_RING_SLOTS = [0, 1, 2, 3, 7, 11, 15, 14, 13, 12, 8, 4];
function thumbnailCells() {
  const cells = Array.from({ length: 16 }, (_, index) => `<b style="order:${index}"></b>`);
  THUMB_RING_SLOTS.forEach((slot, position) => {
    const key = RGB.KEY_ORDER[position];
    cells[slot] = `<i data-key="${key}" style="order:${slot}"></i>`;
  });
  return cells.join('');
}
function previewControls(mode) {
  return `<div class="preview-controls" aria-label="预览控制" hidden>
    <button id="previewPlay" class="button secondary" type="button">${previewPlaying ? '暂停' : '播放'}</button>
    <button id="previewRestart" class="button secondary" type="button">重播</button>
    <label>速度<select id="previewSpeed" aria-label="预览速度"><option value="0.5" ${previewSpeed === 0.5 ? 'selected' : ''}>0.5×</option><option value="1" ${previewSpeed === 1 ? 'selected' : ''}>1×</option><option value="2" ${previewSpeed === 2 ? 'selected' : ''}>2×</option></select></label>
    ${[2, 5].includes(mode) ? '<button id="previewRandom" class="button secondary" type="button">重新随机</button>' : ''}
  </div>`;
}
function syncThumbnailEngines(preset) {
  const signature = `${preset.accent.join(',')}:${previewSeed}`;
  if (signature === thumbnailSignature) return;
  thumbnailSignature = signature;
  thumbnailEngines = new Map(P.RGB_MODES.map(mode => [mode.value, RGB.createPreview({ mode: mode.value, accent: preset.accent, seed: previewSeed, smooth: true })]));
  thumbnailPulseStates = new Map();
}
function renderLighting(preset) {
  const readonly = currentSource() === 'template' && !editSession, selectedMode = P.RGB_MODES.find(mode => mode.value === preset.rgbMode);
  syncThumbnailEngines(preset);
  const groups = RGB.MODE_GROUPS.map(group => `<section class="effect-group"><h3>${group.label}</h3><div class="lighting-grid">${group.modes.map(value => {
    const mode = P.RGB_MODES.find(item => item.value === value);
    return `<label class="lighting-option effect-option"><input type="radio" name="rgbMode" value="${mode.value}" ${preset.rgbMode === mode.value ? 'checked' : ''} ${readonly ? 'disabled' : ''}>
      <span class="effect-thumb" data-effect-thumb="${mode.value}" aria-hidden="true">${thumbnailCells()}</span>
      <strong>${mode.label}</strong><small>${RGB.MODE_COLORS[mode.value]}</small></label>`;
  }).join('')}</div></section>`).join('');
  return `${inspectorHeading('整套预设', '灯光效果', '选择按键灯的表现方式')}
    <div class="selected-effect"><strong>${selectedMode.label}</strong><span>${selectedMode.detail}</span></div>
    ${previewControls(preset.rgbMode)}
    <div class="effect-groups">${groups}</div>
    <p class="lighting-note">上方电源、连接和预设指示灯不受影响。</p>`;
}
function renderInspector() {
  const preset = currentPreset();
  if (workspaceTab === 'lighting') { $('inspector').innerHTML = renderLighting(preset); return; }
  if (selectedInput.type === 'btn' && selectedInput.index === 15) {
    $('inspector').innerHTML = `${inspectorHeading('全局保留', 'SideKey', '设备侧面按键', false)}
      <div class="locked-card"><span class="lock-symbol">—</span><strong>此按键不可重新映射</strong><p>短按切换预设，长按用于配对和固件烧写。导入导出时会原样保留。</p></div>`;
    return;
  }
  if (selectedInput.type === 'encoder') {
    const encoder = P.ENCODERS.find(item => item.id === selectedInput.id);
    $('inspector').innerHTML = `${inspectorHeading('编码器', encoder.name, '旋转与下压可分别设置')}
      <div class="encoder-rotation-group">${actionForm(preset, encoder.ccwSlot, true)}${actionForm(preset, encoder.cwSlot, true)}</div>
      <div class="encoder-press">${actionForm(preset, encoder.pressSlot, true)}</div>`;
    return;
  }
  const index = selectedInput.index, action = preset.actions[index];
  $('inspector').innerHTML = `${inspectorHeading(`按键 K${index + 1}`, '键位设置', '选择这个按键要执行的动作')}
    <div class="action-summary">${escapeHtml(P.actionLabel(action, platformOf(preset)))}</div>
    ${actionForm(preset, index)}`;
}
function renderPresetHeader() {
  const preset = currentPreset(), readonly = currentSource() === 'template' && !editSession;
  const templateItem = currentSource() === 'template' ? TB.findTemplateItem(templateGroups, preset.templateId) : null;
  const canSwitchPlatform = Boolean(templateItem && templateItem.variants.length > 1);
  $('presetTitle').textContent = preset.name;
  $('presetTitle').hidden = false;
  $('presetNameInput').hidden = true;
  $('presetNameInput').setAttribute('aria-invalid', 'false');
  $('renameActions').hidden = true;
  $('renameError').hidden = true;
  $('presetTitle').setAttribute('aria-disabled', String(readonly));
  $('presetSource').innerHTML = `<span class="source-chip">${sourceLabel()}</span>${editSession?.dirty ? '<span class="dirty-label">未保存</span>' : ''}`;
  $('accentButton').style.background = accentHex(preset);
  $('accentInput').value = accentHex(preset);
  $('platformButton').innerHTML = `${PLATFORM[platformOf(preset)]} <span class="chevron" aria-hidden="true"></span>`;
  $('platformButton').title = canSwitchPlatform ? '切换此项目模板的平台版本' : '';
  $('accentButton').disabled = readonly;
  $('platformButton').disabled = readonly && !canSwitchPlatform;
  $('platformPopover').querySelector('strong').textContent = templateItem ? '选择模板平台' : '平台与修饰键';
  for (const button of $('platformPopover').querySelectorAll('[data-platform]')) {
    const available = !templateItem || templateItem.variants.some(variant => platformOf(variant) === button.dataset.platform);
    button.hidden = !available;
    button.disabled = !available;
  }
  $('presetIdentity').classList.remove('is-pending');
  $('draftNotice').hidden = !editSession;
  if (editSession) {
    const target = editingKeyboard() ? '键盘' : '我的预设';
    $('draftNotice').innerHTML = `<strong>正在编辑「${escapeHtml(editSession.original.name)}」</strong><span>修改尚未保存到${target}。</span>`;
  }
}
function renderActionbar() {
  const preset = currentPreset(), source = currentSource(), editing = Boolean(editSession), linked = linkedDevice(preset);
  const persistentMessage = libraryLoadError
    ? { text: `本地库读取失败：${libraryLoadError.message}。原数据未改动，本次修改不会保存。`, error: true }
    : librarySaveError
      ? { text: `本地保存失败：${librarySaveError.message}。修改仅保留在当前页面。`, error: true }
      : operationMessage;
  $('discardEdit').hidden = !editing;
  $('discardEdit').disabled = deviceBusy;
  $('writeResult').hidden = !persistentMessage;
  $('writeResult').textContent = persistentMessage?.text || '';
  $('writeResult').classList.toggle('error', Boolean(persistentMessage?.error));
  let title = '项目模板 · 只读', detail = '可直接安装，或复制到我的预设后编辑', label = '安装到键盘';
  let disabled = !deviceClient || deviceBusy;
  if (source === 'local') {
    title = '已保存到我的预设';
    detail = linked ? (hasKeyboardChanges(preset) ? `键盘中的「${linked.name}」尚未更新` : `已安装到键盘中的「${linked.name}」`) : '尚未安装到键盘';
    label = linked ? '更新键盘中的此预设' : '安装到键盘';
  }
  if (source === 'device') {
    title = '键盘中的只读预设';
    detail = '可直接修改，保存前键盘不会改变';
    disabled = deviceBusy;
  }
  if (editing) {
    title = editSession.dirty ? '当前修改尚未保存' : '正在编辑当前预设';
    detail = editingKeyboard() ? '保存到键盘后才会改变原预设' : '保存到我的预设后才会保留本次修改';
    label = editingKeyboard() ? '保存到键盘' : '保存到我的预设';
    disabled = !editSession.dirty || deviceBusy || (editingKeyboard() && !deviceClient);
    if (editingKeyboard() && !deviceClient) detail = '键盘已断开；当前修改仍保留，重新连接后可保存';
  }
  if (!deviceClient && !editing && source !== 'device') detail = '连接键盘后可安装或更新';
  $('saveSummaryTitle').textContent = title;
  $('saveSummaryDetail').textContent = detail;
  $('saveSummaryIcon').textContent = editing ? '!' : source === 'device' ? 'i' : '✓';
  $('writePreset').textContent = label;
  $('writePreset').disabled = disabled;
  $('writePreset').hidden = source === 'device' && !editing;
}
function renderHeader() {
  const connected = Boolean(deviceClient);
  $('connectionStatus').classList.toggle('connected', connected);
  $('connectionStatus').querySelector('span').textContent = connected ? 'Navio Chron 已连接' : '未连接';
  $('firmwareBadge').hidden = !connected || !deviceFirmware;
  $('firmwareBadge').textContent = deviceFirmware ? `固件 ${deviceFirmware}` : '';
  $('connectButton').textContent = connected ? '重新读取' : '连接设备';
  $('connectButton').disabled = deviceBusy;
  if (!connected || updateDismissed) $('updateBanner').hidden = true;
}
function renderEditor() {
  if (!booted) return;
  const focus = focusSelector();
  renderHeader(); renderLibrary(); renderPresetHeader(); renderWorkspaceTabs();
  renderDeviceCanvas(); renderInspector(); renderActionbar();
  syncPreviewAnimation(); restoreFocus(focus);
}

function ensureEditSession() {
  if (editSession) return true;
  if (!['local', 'device'].includes(currentSource())) return false;
  const original = currentOriginal();
  if (!original) return false;
  editSession = { source: currentSource(), sourceKey: selectedKey, original: P.clonePreset(original), working: P.clonePreset(original), dirty: false };
  operationMessage = null;
  return true;
}
function beginEdit() {
  if (!ensureEditSession()) return;
  renderEditor();
  $('inspector').querySelector('select:not(:disabled), input:not(:disabled)')?.focus();
}
function endEdit() {
  editSession = null;
  pendingAfterEdit = null;
}
function requestLeave(action) {
  if (!editSession) { action?.(); return; }
  if (!editSession.dirty) {
    endEdit(); renderEditor(); action?.(); return;
  }
  pendingAfterEdit = action || null;
  $('unsavedDescription').textContent = editingKeyboard()
    ? '保存到键盘后才会改变键盘中的预设。放弃后，本次修改不会被保留。'
    : '保存到我的预设后才会保留这些修改。放弃后，本次修改不会写入本地库。';
  $('unsavedError').hidden = true;
  $('saveChanges').textContent = editingKeyboard() ? '保存到键盘' : '保存到我的预设';
  $('saveChanges').disabled = editingKeyboard() && !deviceClient;
  openDialog('unsavedDialog');
  $('continueEdit').focus();
}
function discardAndContinue() {
  const action = pendingAfterEdit;
  endEdit(); closeDialog('unsavedDialog'); operationMessage = null; renderEditor();
  if (action) action();
  else $('presetTitle').focus();
}
function saveLocal() {
  if (!editSession || editingKeyboard()) return false;
  const target = findByKey(editSession.sourceKey);
  if (!target) return false;
  const errors = P.presetErrors(editSession.working);
  if (errors.length) {
    operationMessage = { text: `无法保存：${errors[0]}`, error: true };
    renderActionbar(); return false;
  }
  const updated = { ...target, ...P.clonePresetData(editSession.working), _dirtySlots: [] };
  updated._dirty = hasKeyboardChanges(updated);
  const next = userPresets.map(preset => preset === target ? updated : preset);
  if (!saveLibrary(next)) { renderActionbar(); return false; }
  userPresets = next;
  endEdit();
  operationMessage = { text: '已保存到我的预设', error: false };
  renderEditor(); $('presetTitle').focus();
  return true;
}
async function saveAndContinue() {
  if (!editSession) return;
  if (editingKeyboard()) {
    closeDialog('unsavedDialog'); openWriteDialog(); return;
  }
  const action = pendingAfterEdit;
  if (!saveLocal()) {
    $('unsavedError').textContent = operationMessage?.text || '保存失败，请继续编辑后重试。';
    $('unsavedError').hidden = false;
    return;
  }
  closeDialog('unsavedDialog');
  action?.();
}
function selectPreset(key) {
  const next = findByKey(key);
  if (key === selectedKey || !next) return;
  requestLeave(() => {
    selectedKey = key;
    if (key.startsWith('template:')) templatePlatform = platformOf(next);
    selectedInput = { type: 'btn', index: 0 };
    operationMessage = null;
    renderEditor();
  });
}

async function refreshDevice(selectActive = false) {
  const selectedDeviceId = selectedKey?.startsWith('device:') ? Number(selectedKey.split(':')[1]) : null;
  const client = deviceClient, generation = deviceGeneration;
  const result = await client.readInstalled();
  if (client !== deviceClient || generation !== deviceGeneration) throw new Error('设备连接已更换');
  activeDeviceId = result.activeId;
  devicePresets = result.presets.map(preset => ({ ...preset, _readonly: true, _device: true }));
  syncInstalledState();
  if (!editingKeyboard()) {
    if (selectActive && !selectedKey?.startsWith('local:')) selectedKey = keyFor('device', devicePresets.find(preset => preset.id === activeDeviceId));
    else if (selectedDeviceId) selectedKey = keyFor('device', devicePresets.find(preset => preset.id === selectedDeviceId) || devicePresets[0]);
  }
  renderEditor();
}
function resetDeviceConnection(connection) {
  const closing = connection.abort();
  if (currentSource() === 'device' && !editingKeyboard()) selectedKey = keyFor('template', defaultTemplate());
  deviceConnection = null; deviceClient = null; devicePresets = []; activeDeviceId = 0; deviceBusy = false;
  deviceFirmware = null;
  $('updateBanner').hidden = true;
  return closing;
}
function deviceDisconnected(device) {
  if (!deviceConnection || device !== deviceConnection.device) return;
  ++deviceGeneration;
  resetDeviceConnection(deviceConnection);
  operationMessage = { text: editingKeyboard() ? '键盘已断开，当前修改仍保留；重新连接后可保存。' : '键盘已断开，可以连接另一台键盘。', error: true };
  renderEditor();
  toast('键盘已断开', true);
}
async function runDeviceAction(action) {
  if (deviceBusy || !booted) return;
  const generation = deviceGeneration;
  deviceBusy = true; $('confirmWrite').disabled = true; renderEditor();
  try { await action(); }
  catch (error) {
    if (generation === deviceGeneration) {
      operationMessage = { text: error.message || String(error), error: true };
      $('writeError').textContent = operationMessage.text;
      $('writeError').hidden = !$('writeDialog').open;
      toast(operationMessage.text, true);
    }
  } finally {
    if (generation === deviceGeneration) {
      deviceBusy = false; $('confirmWrite').disabled = false; renderEditor();
    }
  }
}
$('connectButton').addEventListener('click', () => runDeviceAction(async () => {
  if (deviceClient) { await refreshDevice(false); operationMessage = { text: '已重新读取键盘预设', error: false }; return; }
  const connection = await D.connectHid(navigator.hid);
  deviceConnection = connection;
  deviceClient = new D.DeviceClient(connection.session);
  try {
    const hello = await deviceClient.hello();
    deviceFirmware = hello.fw;
    await refreshDevice(!editSession);
    checkFirmwareUpdate(hello.fw);
  } catch (error) {
    if (deviceConnection === connection) await resetDeviceConnection(connection);
    throw error;
  }
  operationMessage = { text: '键盘读取完成；修改只会在明确保存后写入', error: false };
}));
navigator.hid?.addEventListener('disconnect', event => deviceDisconnected(event.device));
window.addEventListener('focus', () => {
  if (!deviceClient || deviceBusy || editSession || !deviceConnection.device.opened) return;
  runDeviceAction(() => refreshDevice(false));
});

function openWriteDialog() {
  if (deviceBusy) return;
  const preset = currentPreset();
  $('writeError').hidden = true;
  if (editSession) {
    if (!editingKeyboard()) { saveLocal(); return; }
    if (!deviceClient) return;
    const original = devicePresets.find(item => item.id === editSession.original.id);
    if (!original) {
      operationMessage = { text: '键盘中已找不到原预设，无法保存；可复制到我的预设保留内容。', error: true };
      renderActionbar(); return;
    }
    $('writeDialogTitle').textContent = '保存到键盘';
    $('writeDialogDescription').textContent = `将把本次修改保存到键盘中的“${original.name}”。键盘中的顺序保持不变。`;
    $('replacementField').hidden = true;
    $('installAsNewField').hidden = true;
    $('confirmWrite').textContent = '保存到键盘';
    openDialog('writeDialog'); return;
  }
  if (currentSource() === 'device') { beginEdit(); return; }
  if (!deviceClient) return;
  const linked = linkedDevice(preset), full = devicePresets.length >= 6 && !linked;
  $('writeDialogTitle').textContent = linked ? '更新键盘中的此预设' : full ? '键盘已满，选择替换目标' : '安装到键盘';
  $('writeDialogDescription').textContent = linked
    ? `将用“${preset.name}”更新上次安装的目标“${linked.name}”。不会创建重复预设。`
    : full ? '键盘中已有 6 套预设。选择一套进行替换，我的预设不会改变。'
      : `将把“${preset.name}”作为新预设安装到键盘，现有预设不会被覆盖。`;
  $('replacementTarget').replaceChildren(...devicePresets.map(item => new Option(item.name, String(item.id))));
  $('replacementField').hidden = !full;
  $('installAsNewField').hidden = !linked || devicePresets.length >= 6;
  $('installAsNew').checked = false;
  $('confirmWrite').textContent = full ? '确认替换' : linked ? '确认更新' : '确认安装';
  openDialog('writeDialog');
}
$('installAsNew').addEventListener('change', event => {
  const preset = currentPreset(), linked = linkedDevice(preset);
  if (!linked) return;
  $('writeDialogTitle').textContent = event.target.checked ? '作为新预设安装' : '更新键盘中的此预设';
  $('writeDialogDescription').textContent = event.target.checked
    ? `将把“${preset.name}”作为新预设安装，键盘中的“${linked.name}”保持不变。`
    : `将用“${preset.name}”更新上次安装的目标“${linked.name}”。不会创建重复预设。`;
  $('confirmWrite').textContent = event.target.checked ? '确认安装' : '确认更新';
});
$('confirmWrite').addEventListener('click', () => runDeviceAction(async () => {
  if (!deviceClient) throw new Error('键盘已断开，请重新连接');
  if (editingKeyboard()) {
    const continuation = pendingAfterEdit;
    const target = devicePresets.find(item => item.id === editSession.original.id);
    if (!target) throw new Error('键盘中已找不到原预设，保存已取消');
    const outgoing = P.clonePresetData(editSession.working);
    outgoing.id = target.id;
    await deviceClient.writeVerified(outgoing);
    endEdit(); pendingAfterEdit = null;
    selectedKey = keyFor('device', target);
    closeDialog('writeDialog');
    await refreshDevice(false);
    operationMessage = { text: '已保存到键盘并完成验证', error: false };
    renderEditor(); $('presetTitle').focus();
    continuation?.();
    return;
  }
  const source = currentOriginal();
  if (!source || !['template', 'local'].includes(currentSource())) return;
  const asNew = !$('installAsNewField').hidden && $('installAsNew').checked;
  const plan = D.planInstall(P.clonePreset(source), devicePresets, {
    asNew, replacementId: Number($('replacementTarget').value),
  });
  await deviceClient.writeVerified(plan.preset);
  source._installedId = plan.preset.id;
  let relationSaved = true;
  if (currentSource() === 'local') {
    source._dirty = false; source._dirtySlots = [];
    relationSaved = saveLibrary();
  } else {
    templateInstallations[source.templateId] = plan.preset.id;
    relationSaved = saveTemplateInstallations();
  }
  closeDialog('writeDialog');
  await refreshDevice(false);
  operationMessage = { text: relationSaved ? (asNew ? '已作为新预设安装并完成验证' : '已写入键盘并完成验证') : '键盘已写入并验证，但浏览器未能保存安装目标记录', error: !relationSaved };
  toast(asNew ? '已作为新预设安装，原键盘项目保留' : '已写入键盘并完成重读验证', !relationSaved);
}));

function selectedDeviceIndex() {
  if (currentSource() !== 'device') return -1;
  const original = currentOriginal() || keyboardOriginal();
  return original ? devicePresets.findIndex(preset => preset.id === original.id) : -1;
}
function moveSelectedDevice(direction) {
  return runDeviceAction(async () => {
    const preset = devicePresets[selectedDeviceIndex()];
    const beforeId = preset && D.moveAnchor(devicePresets, preset.id, direction);
    if (!preset || beforeId === null) return;
    await deviceClient.move(preset.id, beforeId);
    await refreshDevice(false);
    operationMessage = { text: `“${preset.name}”已${direction < 0 ? '上移' : '下移'}`, error: false };
  });
}
function openKeyboardDelete(preset) {
  if (!preset || editSession) return;
  pendingKeyboardDeleteId = preset.id;
  $('deleteKeyboardDescription').textContent = `确定从键盘删除“${preset.name}”吗？`;
  $('deleteKeyboardWarning').textContent = preset.id === activeDeviceId ? '这是使用中的预设，删除后将切换到列表第一套。' : '键盘中的这套预设将被移除。';
  openDialog('deleteKeyboardDialog');
}
$('confirmDeleteKeyboard').addEventListener('click', () => {
  const id = pendingKeyboardDeleteId;
  closeDialog('deleteKeyboardDialog');
  runDeviceAction(async () => {
    const preset = devicePresets.find(item => item.id === id);
    if (!preset || devicePresets.length <= 1) return;
    await deviceClient.remove(id);
    await refreshDevice(false);
    operationMessage = { text: `已从键盘删除“${preset.name}”，我的预设未改变`, error: false };
  });
});

function copyPresetByKey(key, editAfter = false) {
  const source = findByKey(key);
  if (!source) return;
  const sourceType = key.split(':')[0];
  if (sourceType !== 'local') {
    const existing = sourceCopy(source, sourceType);
    if (existing) {
      libraryTab = 'library'; selectPreset(keyFor('local', existing));
      if (editAfter) beginEdit();
      toast('已打开之前复制的预设，没有创建重复副本'); return;
    }
  }
  const nextId = nextPresetId();
  if (nextId > 255) { toast('本地 presetId 已用完', true); return; }
  const copy = L.createUserCopy(source, P, {
    uuid: uuid(), id: nextId, originSourceKey: sourceType === 'local' ? null : key,
  });
  copy.name = `${source.name} 副本`;
  const issue = P.nameError(copy.name);
  if (issue) { toast(`无法创建副本：${issue}，请先缩短预设名称`, true); return; }
  userPresets.push(copy);
  const saved = saveLibrary();
  libraryTab = 'library'; selectedKey = keyFor('local', copy); operationMessage = null;
  renderEditor();
  if (editAfter) beginEdit();
  toast(saved ? '已复制到我的预设，来源内容未改变' : '副本仅保留在当前页面，未能保存到浏览器', !saved);
}
function openLocalDelete(key) {
  const preset = findByKey(key);
  if (!preset || editSession) return;
  pendingDeleteKey = key;
  $('deleteDescription').textContent = `确定删除“${preset.name}”吗？`;
  openDialog('deleteDialog');
}
$('confirmDelete').addEventListener('click', () => {
  const index = userPresets.findIndex(preset => keyFor('local', preset) === pendingDeleteKey);
  if (index < 0) return;
  userPresets.splice(index, 1);
  if (selectedKey === pendingDeleteKey) selectedKey = userPresets.length ? keyFor('local', userPresets[Math.min(index, userPresets.length - 1)]) : keyFor('template', defaultTemplate());
  pendingDeleteKey = null;
  const saved = saveLibrary();
  closeDialog('deleteDialog'); operationMessage = null; renderEditor();
  toast(saved ? '本地预设已删除，键盘内容未改变' : '删除仅保留在当前页面，未能保存到浏览器', !saved);
});

$('libraryContent').addEventListener('click', event => {
  const copy = event.target.closest('[data-copy]');
  if (copy) { copyPresetByKey(copy.dataset.copy); return; }
  const remove = event.target.closest('[data-delete]');
  if (remove) { openLocalDelete(remove.dataset.delete); return; }
  const item = event.target.closest('[data-preset]');
  if (item) selectPreset(item.dataset.preset);
});
$('libraryContent').addEventListener('keydown', event => {
  if (event.target.closest('[data-copy],[data-delete]')) return;
  const item = event.target.closest('[data-preset]');
  if (item && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); selectPreset(item.dataset.preset); }
});
$('templateSearch').addEventListener('input', event => {
  templateQuery = event.target.value;
  renderLibrary();
});
for (const button of document.querySelectorAll('[data-library-tab]')) button.addEventListener('click', () => {
  if (button.dataset.libraryTab === libraryTab) return;
  requestLeave(() => { libraryTab = button.dataset.libraryTab; renderEditor(); });
});
for (const button of document.querySelectorAll('[data-workspace-tab]')) button.addEventListener('click', () => {
  workspaceTab = button.dataset.workspaceTab;
  renderWorkspaceTabs(); renderDeviceCanvas(); renderInspector(); syncPreviewAnimation();
});
for (const button of document.querySelectorAll('[data-close]')) button.addEventListener('click', () => {
  const id = button.dataset.close;
  if (id === 'unsavedDialog' || id === 'writeDialog') pendingAfterEdit = null;
  closeDialog(id);
});
for (const tablist of document.querySelectorAll('[role="tablist"]')) tablist.addEventListener('keydown', event => {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
  const tabs = [...tablist.querySelectorAll('[role="tab"]')], current = tabs.indexOf(document.activeElement);
  if (current < 0) return;
  const index = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 :
    (current + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
  event.preventDefault();
  tabs[index].focus(); tabs[index].click();
});
for (const id of ['unsavedDialog', 'writeDialog']) $(id).addEventListener('cancel', () => { pendingAfterEdit = null; });
document.addEventListener('keydown', event => {
  if (event.key !== 'Escape') return;
  const trigger = !$('colorPopover').hidden ? $('accentButton') : !$('platformPopover').hidden ? $('platformButton') : null;
  closePopovers(); trigger?.focus();
});
for (const link of [$('flashLink'), $('firmwareFlashLink')]) link.addEventListener('click', event => {
  event.preventDefault();
  if (deviceBusy) return;
  requestLeave(() => { location.href = FLASHER_URL; });
});
$('dismissUpdate').addEventListener('click', () => { updateDismissed = true; $('updateBanner').hidden = true; });
$('helpButton').addEventListener('click', () => openDialog('helpDialog'));
$('discardEdit').addEventListener('click', () => requestLeave(null));
$('discardChanges').addEventListener('click', discardAndContinue);
$('saveChanges').addEventListener('click', saveAndContinue);
$('writePreset').addEventListener('click', openWriteDialog);
$('inspector').addEventListener('click', event => {
  const control = event.target.closest('#previewPlay, #previewRestart, #previewRandom');
  if (control) {
    if (control.id === 'previewPlay') {
      previewPlaying = !previewPlaying;
      control.textContent = previewPlaying ? '暂停' : '播放';
    } else if (control.id === 'previewRestart') {
      previewElapsed = 0; clearPreviewPulses(); ensurePreviewEngine().restart(0);
    } else {
      previewSeed = (previewSeed + 0x9E3779B9) >>> 0;
      previewEngineKey = ''; previewElapsed = 0; previewHeld.clear();
      renderEditor(); return;
    }
    syncPreviewAnimation(); return;
  }
  const start = event.target.closest('[data-action="edit-current"]');
  if (!start) return;
  if (currentSource() === 'template') copyPresetByKey(selectedKey, true);
  else beginEdit();
});
document.addEventListener('visibilitychange', syncPreviewAnimation);

function beginRename() {
  if (!editSession && currentSource() === 'template') {
    toast('项目模板为只读，请先复制到我的预设');
    return;
  }
  if (!ensureEditSession()) return;
  closePopovers();
  $('renameError').hidden = true;
  $('presetNameInput').setAttribute('aria-invalid', 'false');
  $('presetNameInput').value = currentPreset().name;
  $('presetTitle').hidden = true;
  $('presetNameInput').hidden = false;
  $('renameActions').hidden = false;
  $('presetNameInput').focus(); $('presetNameInput').select();
}
function finishRename(commit) {
  const input = $('presetNameInput');
  if (input.hidden) return;
  if (!commit) {
    input.hidden = true; $('presetTitle').hidden = false; $('renameActions').hidden = true;
    $('renameError').hidden = true; input.setAttribute('aria-invalid', 'false'); return;
  }
  const issue = P.nameError(input.value);
  if (issue) {
    $('renameError').textContent = input.value ? '名称最长为 23 个 UTF-8 字节，请缩短后再确认。' : '请输入预设名称后再确认。';
    $('renameError').hidden = false; input.setAttribute('aria-invalid', 'true'); input.focus(); return;
  }
  editSession.working.name = input.value;
  editSession.dirty = true; operationMessage = null;
  renderEditor();
}
$('presetTitle').addEventListener('click', beginRename);
$('presetTitle').addEventListener('keydown', event => {
  if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); beginRename(); }
});
$('presetNameInput').addEventListener('input', () => {
  $('renameError').hidden = true; $('presetNameInput').setAttribute('aria-invalid', 'false');
});
$('presetNameInput').addEventListener('blur', () => finishRename(true));
$('presetNameInput').addEventListener('keydown', event => {
  if (event.key === 'Enter') { event.preventDefault(); finishRename(true); }
  if (event.key === 'Escape') { event.preventDefault(); finishRename(false); }
});
for (const button of [$('confirmRename'), $('cancelRename')]) button.addEventListener('mousedown', event => event.preventDefault());
$('confirmRename').addEventListener('click', () => finishRename(true));
$('cancelRename').addEventListener('click', () => finishRename(false));
$('accentButton').addEventListener('click', () => { $('colorPopover').hidden = !$('colorPopover').hidden; $('platformPopover').hidden = true; });
$('platformButton').addEventListener('click', () => { $('platformPopover').hidden = !$('platformPopover').hidden; $('colorPopover').hidden = true; });
function changeWorking(render = false) {
  if (!ensureEditSession()) return;
  editSession.dirty = true; operationMessage = null;
  if (render) renderEditor();
  else { renderPresetHeader(); renderDeviceCanvas(); renderActionbar(); }
}
$('accentInput').addEventListener('input', event => {
  if (!ensureEditSession()) return;
  editSession.working.accent = [1, 3, 5].map(offset => parseInt(event.target.value.slice(offset, offset + 2), 16));
  changeWorking(true);
});
$('colorPopover').addEventListener('click', event => {
  const button = event.target.closest('[data-color]');
  if (!button || !ensureEditSession()) return;
  editSession.working.accent = [1, 3, 5].map(offset => parseInt(button.dataset.color.slice(offset, offset + 2), 16));
  changeWorking(true); closePopovers(); $('accentButton').focus();
});
$('platformPopover').addEventListener('click', event => {
  const button = event.target.closest('[data-platform]');
  if (!button) return;
  if (currentSource() === 'template' && !editSession) {
    const item = TB.findTemplateItem(templateGroups, currentOriginal()?.templateId);
    const next = TB.variantForPlatform(item, button.dataset.platform);
    if (!next || platformOf(next) !== button.dataset.platform) return;
    templatePlatform = button.dataset.platform;
    closePopovers();
    if (keyFor('template', next) === selectedKey) $('platformButton').focus();
    else selectPreset(keyFor('template', next));
    return;
  }
  if (!ensureEditSession()) return;
  editSession.working.platform = button.dataset.platform;
  changeWorking(true); closePopovers(); $('platformButton').focus();
});
document.addEventListener('click', event => { if (!event.target.closest('.popover-anchor')) closePopovers(); });

$('inspector').addEventListener('change', event => {
  if (event.target.id === 'previewSpeed') { previewSpeed = Number(event.target.value); syncPreviewAnimation(); return; }
  if (!ensureEditSession()) return;
  if (event.target.name === 'rgbMode') {
    editSession.working.rgbMode = Number(event.target.value);
    changeWorking(true); return;
  }
  const card = event.target.closest('[data-slot]');
  if (!card) return;
  const slot = Number(card.dataset.slot), action = { ...editSession.working.actions[slot] };
  if (event.target.dataset.actionField === 'kind') editSession.working.actions[slot] = P.actionForKind(Number(event.target.value), action);
  else if (event.target.dataset.actionField === 'code') editSession.working.actions[slot] = { ...action, code: Number(event.target.value) };
  else if (event.target.dataset.actionBit) {
    const bit = Number(event.target.dataset.actionBit);
    editSession.working.actions[slot] = { ...action, mods: event.target.checked ? action.mods | bit : action.mods & ~bit };
  } else return;
  changeWorking(true);
});
$('inspector').addEventListener('input', event => {
  if (event.target.dataset.actionField !== 'wheelDy' || !ensureEditSession()) return;
  const card = event.target.closest('[data-slot]'), slot = Number(card.dataset.slot);
  const action = { ...editSession.working.actions[slot], wheelDy: Number(event.target.value) };
  const issue = P.actionError(action, slot < 16), error = card.querySelector('.action-error');
  error.hidden = !issue; error.textContent = issue ? '滚动格数需为非零整数，范围为 -127 到 127。' : '';
  event.target.setAttribute('aria-invalid', String(Boolean(issue)));
  if (issue) return;
  editSession.working.actions[slot] = action;
  changeWorking(false);
});

$('newPresetButton').addEventListener('click', () => requestLeave(() => {
  const nextId = nextPresetId();
  if (nextId > 255) { toast('本地 presetId 已用完', true); return; }
  const preset = P.createEmptyPreset(nextId, `自定义预设 ${nextId}`);
  preset.uuid = uuid(); preset._dirty = false; preset._readonly = false;
  preset.originTemplateId = null; preset._originSourceKey = null;
  userPresets.push(preset); selectedKey = keyFor('local', preset); operationMessage = null;
  const saved = saveLibrary(); renderEditor();
  if (!saved) toast('新预设仅保留在当前页面，未能保存到浏览器', true);
}));
$('resetLibrary').addEventListener('click', () => requestLeave(() => {
  const recovering = Boolean(libraryLoadError);
  $('resetTitle').textContent = recovering ? '备份并重建本地库' : '清空我的预设';
  $('resetDescription').textContent = recovering
    ? '将先下载无法读取的原始本地库，再写入空库。原始数据会被替换。'
    : `将删除浏览器中的 ${userPresets.length} 套我的预设。项目模板和键盘内容不会改变。`;
  $('confirmReset').textContent = recovering ? '备份并重建' : '确认清空';
  openDialog('resetDialog');
}));
$('confirmReset').addEventListener('click', () => {
  const recovering = Boolean(libraryLoadError);
  if (recovering) {
    try { downloadBlob(localStorage.getItem(STORAGE_KEY), 'navio-editor-library-backup.txt', 'text/plain'); }
    catch (error) { toast(`原始库备份失败，恢复已取消：${error.message}`, true); return; }
    libraryLoadError = null;
  }
  userPresets = []; quarantinedPresets = []; selectedKey = keyFor('template', defaultTemplate());
  selectedInput = { type: 'btn', index: 0 };
  if (!saveLibrary()) {
    if (recovering) { libraryLoadError = librarySaveError; librarySaveError = null; }
    renderEditor(); return;
  }
  closeDialog('resetDialog'); operationMessage = null; renderEditor();
  if (recovering) toast('本地库已重建，原始数据已下载备份');
});
$('exportButton').addEventListener('click', () => {
  if (!booted) return;
  const preset = P.clonePresetData(currentPreset());
  const content = { schemaVersion: 1, product: 'navio-chron', record: 1,
    metadata: { author: 'local', platform: 'custom' }, preset };
  downloadBlob(JSON.stringify(content, null, 2), `${preset.name || 'preset'}.navio.json`, 'application/json');
});
$('importPreset').addEventListener('change', event => {
  const file = event.target.files[0];
  event.target.value = '';
  if (!file || !booted) return;
  requestLeave(async () => {
    try {
      const content = JSON.parse(await file.text());
      if (content.schemaVersion !== 1 || content.record !== 1 || !content.preset)
        throw new Error('不支持的 .navio.json 格式或 record 版本');
      const errors = P.presetErrors(content.preset);
      if (errors.length) throw new Error(errors[0]);
      const preset = P.clonePresetData(content.preset);
      let idNote = '';
      if ([...userPresets, ...quarantinedPresets].some(item => item?.id === preset.id)) {
        const originalId = preset.id, nextId = nextPresetId();
        if (nextId > 255) throw new Error('本地 presetId 已用完，无法导入冲突预设');
        preset.id = nextId; idNote = `；原 ID ${originalId} 冲突，已分配 ${nextId}`;
      }
      preset.uuid = uuid(); preset._dirty = false; preset._readonly = false;
      preset.originTemplateId = null; preset._originSourceKey = null;
      userPresets.push(preset); selectedKey = keyFor('local', preset);
      const saved = saveLibrary(); operationMessage = null; renderEditor();
      toast((saved ? '已导入我的预设，未写入键盘' : '已导入当前页面，但未能保存到浏览器') + idNote, !saved);
    } catch (error) { toast(error.message, true); }
  });
});
window.addEventListener('beforeunload', event => {
  if (!editSession?.dirty) return;
  event.preventDefault(); event.returnValue = '';
});

boot();
