import { renderDevice, escapeHtml } from './device_svg.js?v=20261105-33';
const P = NavioEditorPreset, L = NavioEditorLibrary, D = NavioEditorDevice, T = NavioEditorTemplates,
  R = NavioWebflashRules, $ = id => document.getElementById(id);
const STORAGE_KEY = 'navio-editor-library-v1';
const platformOf = preset => P.normalizePlatform(preset?.platform);
const PLATFORM_CHIPS = { win: 'Win', mac: 'Mac', ipad: 'iPad' };
const uuid = () => crypto.randomUUID ? crypto.randomUUID() : `local-${Date.now()}-${Math.random()}`;
let activeTab = 'mapping', selectedInput = { type: 'btn', index: 0 }, toastTimer, libraryLoadError = null, librarySaveError = null;
let quarantinedPresets = [];

// 官方模板库：presets/index.json（tools/build_templates.js 构建期生成）→ 逐文件拉取 → 校验装配；
// 单条损坏跳过并警示，索引或整库失败进入错误态，不静默降级。
const ASSET_VERSION = '20261105-33';
const LOCAL_SERVER = ['localhost', '127.0.0.1'].includes(location.hostname);
const RELEASE_MANIFEST_URL = LOCAL_SERVER ? '/release/navio_chron_0.5.23/manifest.json' : '../manifest.json';
const FLASHER_URL = LOCAL_SERVER ? '/tools/probe/webunified_probe.html' : '../';
for (const id of ['flashLink', 'firmwareFlashLink']) $(id).href = FLASHER_URL;
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
    $('firmwareNoticeText').textContent = `当前固件 ${currentVersion}，最新版本 ${release.version}。请先刷写固件。`;
    $('firmwareNotice').hidden = false;
  } catch (error) {
    console.warn('Firmware update check failed:', error);
  }
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
    templates.forEach(preset => preset.uuid = uuid());
    if (!templates.length) throw new Error(loaded.errors[0] || '官方模板库为空');
    selectedPresetId = templates[0].uuid;
    userPresets = loadUserPresets();  // syncTemplates 依赖 templates，须在模板就位后执行
    booted = true;
    renderAll();
    if (loaded.errors.length) toast(`跳过 ${loaded.errors.length} 套无效官方模板：${loaded.errors[0]}`, true);
    else if (libraryLoadError) toast(`本地预设库读取失败：${libraryLoadError.message}。原数据未改动，本次修改不会保存。`, true);
    else if (librarySaveError) toast(`本地库已读取，但启动清理或模板决定未能保存：${librarySaveError.message}`, true);
    else if (quarantinedPresets.length) toast(`${quarantinedPresets.length} 套预设无法读取已跳过，原始数据已保留`, true);
  } catch (error) {
    $('saveState').textContent = `官方模板加载失败：${error.message}`;
    toast('官方模板加载失败，页面功能不可用；请刷新重试', true);
  }
}
function persistLibrary(list) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(L.packageLibrary([...list, ...quarantinedPresets])));
}
function loadUserPresets() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    const userPresets = [];
    for (const preset of L.migrateLegacy(saved).userPresets) {
      if (L.userPresetError(preset, P)) quarantinedPresets.push(preset);
      else userPresets.push(preset);
    }
    let normalized = false;
    for (const preset of userPresets) {
      if (preset._readonly !== false) { preset._readonly = false; normalized = true; }
      if (Object.hasOwn(preset, 'templateId')) { delete preset.templateId; normalized = true; }
      if (Object.hasOwn(preset, '_device')) { delete preset._device; normalized = true; }
      if (preset._installedId !== undefined && (!Number.isInteger(preset._installedId) ||
          preset._installedId < 1 || preset._installedId > 255)) {
        delete preset._installedId; normalized = true;
      }
      if (preset.platform !== undefined && !P.PLATFORMS.includes(preset.platform)) {
        preset.platform = 'win'; normalized = true;
      }
    }
    const synced = L.syncTemplates(userPresets, templates, (preset, template) =>
      confirm(`官方模板“${template.name}”已更新，是否用新版替换你的预设“${preset.name}”？`));
    if (normalized || synced) {
      try { persistLibrary(userPresets); }
      catch (error) { librarySaveError = error; }
    }
    return userPresets;
  } catch (error) { libraryLoadError = error; return []; }
}
let templates = [], userPresets = [], selectedPresetId = null, booted = false;
let deviceConnection = null, deviceClient = null, devicePresets = [], activeDeviceId = 0, deviceBusy = false;
let deviceGeneration = 0, deviceFirmware = null;
function currentPreset() {
  return userPresets.find(preset => preset.uuid === selectedPresetId) ||
    devicePresets.find(preset => preset.uuid === selectedPresetId) ||
    templates.find(preset => preset.uuid === selectedPresetId) || templates[0];
}
function ensureUserCopy() {
  const preset = currentPreset();
  if (!preset._readonly) return preset;
  const copy = P.clonePreset(preset);
  copy.uuid = uuid(); copy._readonly = false; copy._dirty = true;
  delete copy._device; delete copy.templateId;
  copy.originTemplateId = preset.templateId || null;
  copy.originTemplateVersion = preset.templateId ? L.TEMPLATE_VERSION : null;
  userPresets.push(copy); selectedPresetId = copy.uuid;
  return copy;
}
function dirtySlots() { return new Set(currentPreset()._dirtySlots || []); }
function saveLibrary() {
  if (libraryLoadError) return false;
  try {
    persistLibrary(userPresets);
    librarySaveError = null;
    return true;
  } catch (error) {
    librarySaveError = error;
    toast(`本地保存失败：${error.message}`, true);
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
function markDirty(slot) {
  const preset = ensureUserCopy();
  preset._dirty = true;
  if (slot >= 0) {
    preset._dirtySlots = preset._dirtySlots || [];
    if (!preset._dirtySlots.includes(slot)) preset._dirtySlots.push(slot);
  }
  saveLibrary();
  renderSaveState();
  renderLibrary();
  renderDeviceState();
}
function renderSaveState() {
  $('resetLibrary').textContent = libraryLoadError ? '备份并重建本地库' : '清空我的';
  if (libraryLoadError) {
    $('saveState').textContent = '本地库读取失败；原数据未改动，本次修改不会保存';
    return;
  }
  if (quarantinedPresets.length) {
    $('saveState').textContent = `${quarantinedPresets.length} 套预设无法读取已跳过${librarySaveError ? '；本地保存失败' : ''}`;
    return;
  }
  if (librarySaveError) {
    $('saveState').textContent = '本地保存失败；修改仅保留在当前页面';
    return;
  }
  const count = userPresets.filter(preset => preset._dirty).length;
  $('saveState').textContent = count ? `${count} 套本地修改尚未写入设备` : '本地修改尚未写入设备';
}
function presetItem(preset) {
  const active = preset._device && preset.id === activeDeviceId ? '<span class="device-active">使用中</span>' : '';
  return `<div class="preset-item ${preset.uuid === selectedPresetId ? 'active' : ''}" data-uuid="${escapeHtml(preset.uuid)}" tabindex="0" role="button">
    <i class="swatch" style="background:rgb(${preset.accent.join(',')})"></i><span class="preset-name"></span><span class="platform-chip">${PLATFORM_CHIPS[platformOf(preset)]}</span>${active}${preset._dirty ? '<span class="dirty-mark">●</span>' : ''}
  </div>`;
}
function bindPresetItems(container) {
  container.querySelectorAll('.preset-item').forEach(element => {
    element.querySelector('.preset-name').textContent = currentName(element.dataset.uuid);
    const select = () => {
      selectedPresetId = element.dataset.uuid;
      selectedInput = { type: 'btn', index: 0 };
      renderAll();
    };
    element.addEventListener('click', select);
    element.addEventListener('keydown', event => { if (event.key === 'Enter') select(); });
  });
}
function renderLibrary() {
  $('presetList').innerHTML = `<h3 class="library-section">官方模板</h3>${templates.map(presetItem).join('')}
    <h3 class="library-section">我的预设</h3>${userPresets.length ? userPresets.map(presetItem).join('') : '<p class="hint">修改官方模板会自动创建副本</p>'}`;
  bindPresetItems($('presetList'));
  $('deletePreset').disabled = !userPresets.some(preset => preset.uuid === selectedPresetId);
}
function selectedDeviceIndex() { return devicePresets.findIndex(preset => preset.uuid === selectedPresetId); }
function renderDeviceLibrary() {
  $('deviceList').innerHTML = `<h3 class="library-section">设备预设</h3>${deviceClient ?
    devicePresets.map(presetItem).join('') : '<p class="hint">连接设备后读取真实配置</p>'}
    <div class="device-actions"><button id="moveDeviceUp" class="button secondary">上移</button>
    <button id="moveDeviceDown" class="button secondary">下移</button>
    <button id="deleteDevicePreset" class="button ghost danger-button">从设备删除</button></div>`;
  bindPresetItems($('deviceList'));
  const index = selectedDeviceIndex();
  $('moveDeviceUp').disabled = deviceBusy || index <= 0;
  $('moveDeviceDown').disabled = deviceBusy || index < 0 || index >= devicePresets.length - 1;
  $('deleteDevicePreset').disabled = deviceBusy || index < 0 || devicePresets.length <= 1;
  $('moveDeviceUp').onclick = () => moveSelectedDevice(-1);
  $('moveDeviceDown').onclick = () => moveSelectedDevice(1);
  $('deleteDevicePreset').onclick = deleteSelectedDevice;
}
function renderDeviceState() {
  const active = devicePresets.find(preset => preset.id === activeDeviceId);
  const dirtyCount = userPresets.filter(preset => preset._dirty).length;
  $('deviceFirmware').hidden = !deviceClient || !deviceFirmware;
  $('deviceFirmware').textContent = deviceFirmware ? `固件 ${deviceFirmware}` : '';
  $('deviceStatus').textContent = deviceBusy ? '正在与设备通信…' : deviceClient ?
    `已连接 · ${devicePresets.length}/6 套 · 使用中：${active?.name || '未知'}` : '未连接';
  $('connectDevice').textContent = deviceClient ? '重新读取' : '连接设备';
  $('connectDevice').disabled = deviceBusy;
  $('applyPreset').disabled = deviceBusy || !deviceClient || currentPreset()._device;
  $('applyAll').disabled = deviceBusy || !deviceClient || !dirtyCount;
  $('applyAll').textContent = dirtyCount ? `应用全部修改 (${dirtyCount})` : '应用全部修改';
}
function currentName(id) {
  return userPresets.find(preset => preset.uuid === id)?.name ||
    devicePresets.find(preset => preset.uuid === id)?.name ||
    templates.find(preset => preset.uuid === id)?.name || '';
}
function renderTitle() { $('currentPresetTitle').textContent = currentPreset().name || '未命名预设'; }
function renderEncoderDetail() {
  const detail = $('encoderDetail');
  if (selectedInput.type !== 'encoder') { detail.hidden = true; return; }
  const encoder = P.ENCODERS.find(item => item.id === selectedInput.id), actions = currentPreset().actions,
    platform = platformOf(currentPreset());
  detail.innerHTML = `<div class="detail-heading">${encoder.name}</div>
    <div class="detail-item"><span>↻ 顺时针</span><strong>${P.actionLabel(actions[encoder.cwSlot], platform)}</strong></div>
    <div class="detail-item"><span>↺ 逆时针</span><strong>${P.actionLabel(actions[encoder.ccwSlot], platform)}</strong></div>
    <div class="detail-item"><span>⏹ 下压</span><strong>${P.actionLabel(actions[encoder.pressSlot], platform)}</strong></div>`;
  detail.hidden = false;
}
function renderSvg() {
  renderDevice($('device'), { actions: currentPreset().actions,
    actionLabel: action => P.actionLabel(action, platformOf(currentPreset())),
    selected: selectedInput, dirtySlots: dirtySlots(),
    onSelect: input => { selectedInput = input; renderSvg(); renderInspector(); } });
  renderEncoderDetail();
}
function actionForm(slot) {
  const action = currentPreset().actions[slot];
  const isButton = slot < 16;
  const kindOptions = [
    [P.Kind.None, '未设置'], [P.Kind.KeyChord, '快捷键'], [P.Kind.Consumer, '媒体控制'],
    ...(isButton ? [] : [[P.Kind.Wheel, '滚轮']]),
  ].map(([value, label]) => `<option value="${value}" ${action.kind === value ? 'selected' : ''}>${label}</option>`).join('');
  const source = action.kind === P.Kind.Consumer ? P.CONSUMER_OPTIONS : P.KEY_OPTIONS;
  const options = [...(action.kind === P.Kind.KeyChord ? [{ label: '仅修饰键', code: 0 }] : []), ...source]
    .map(option => `<option value="${option.code}" ${action.code === option.code ? 'selected' : ''}>${option.label}</option>`).join('');
  const mods = P.modLabels(platformOf(currentPreset())).map((label, bit) =>
    `<label class="mod"><input type="checkbox" data-bit="${1 << bit}" ${action.mods & (1 << bit) ? 'checked' : ''} ${action.kind === P.Kind.None || action.kind === P.Kind.Consumer ? 'disabled' : ''}>${label}</label>`).join('');
  const title = slot < 16 ? (slot === 15 ? 'SideKey' : `K${slot + 1}`) :
    slot < 18 ? '中央旋钮' : slot < 20 ? '大旋钮' : '滚轮';
  const direction = slot < 16 ? '' : slot % 2 === 0 ? ' · 顺时针' : ' · 逆时针';
  return `<div class="action-card" data-slot="${slot}"><h3><span>${title}${direction}</span> · ${P.actionLabel(action, platformOf(currentPreset()))}</h3>
    <div class="action-fields">
      <label class="action-field full">动作类型<select data-field="kind">${kindOptions}</select></label>
      ${action.kind !== P.Kind.Wheel ? `<label class="action-field full">键码 / 功能<select data-field="code" ${action.kind === P.Kind.None ? 'disabled' : ''}>${options}</select></label>` : ''}
      ${action.kind === P.Kind.Wheel ? `<label class="action-field">滚动格数<input data-field="wheelDy" type="number" min="-127" max="127" step="1" value="${action.wheelDy}"></label>` : ''}
      ${action.kind !== P.Kind.None && action.kind !== P.Kind.Consumer ? `<div class="full"><span class="field-help">修饰键</span><div class="mods">${mods}</div></div>` : ''}
    </div></div>`;
}
function renderInspector() {
  const preset = currentPreset();
  document.querySelectorAll('.tab').forEach(tab => tab.classList.toggle('active', tab.dataset.tab === activeTab));
  $('presetName').value = preset.name;
  $('nameBytes').textContent = `${P.utf8Length(preset.name)}/23B`;
  $('nameBytes').style.color = P.nameError(preset.name) ? 'var(--danger)' : '';
  $('presetAccent').value = `#${preset.accent.map(value => value.toString(16).padStart(2, '0')).join('')}`;
  $('presetPlatform').value = platformOf(preset);
  $('selectionTitle').textContent = activeTab === 'lighting' ? '灯光效果' :
    selectedInput.type === 'btn' && selectedInput.index === 15 ? '全局保留键' : '键位设置';
  if (activeTab === 'lighting') {
    const options = P.RGB_MODES.map(mode => `<label class="lighting-option">
      <input type="radio" name="rgbMode" value="${mode.value}" ${preset.rgbMode === mode.value ? 'checked' : ''}>
      <span><strong>${mode.label}${mode.value === 0 ? '<em>默认 · 省电</em>' : ''}</strong><small>${mode.description}</small></span>
    </label>`).join('');
    const colorHelp = preset.rgbMode >= 3 && preset.rgbMode !== 7 ? '此模式自动变化或随机选择 RGB 色相，不使用主题色。' : '按键灯使用上方设置的预设主题色。';
    const behavior = preset.rgbMode === 0 ? '按键响应仅作用于 K1–K12：按住保持亮起，松开后 500ms 渐隐。' : '';
    $('inspector').innerHTML = `<div class="lighting-settings"><p class="field-help">${colorHelp}LED0–LED2 状态灯不受影响。</p>
      <div class="lighting-options">${options}</div>
      <p class="hint">${behavior}模式随预设保存，安装或应用修改后生效。</p></div>`;
    return;
  }
  if (selectedInput.type === 'btn' && selectedInput.index === 15) {
    $('inspector').innerHTML = `<div class="locked-message"><strong>SideKey 全局保留</strong>短按切换预设，长按用于配对和刷写。<br>该槽位会在导入导出时原样保留，不会清零。</div>`;
    return;
  }
  if (selectedInput.type === 'btn') $('inspector').innerHTML = actionForm(selectedInput.index);
  else {
    const encoder = P.ENCODERS.find(item => item.id === selectedInput.id);
    $('inspector').innerHTML = `<p class="field-help">${encoder.name}：旋转与按压是三个独立动作槽</p>` +
      actionForm(encoder.pressSlot) + actionForm(encoder.cwSlot) + actionForm(encoder.ccwSlot);
  }
}
async function refreshDevice(selectActive = false) {
  const selectedDeviceId = currentPreset()._device ? currentPreset().id : null;
  const client = deviceClient, generation = deviceGeneration;
  const result = await client.readInstalled();
  if (client !== deviceClient || generation !== deviceGeneration) throw new Error('设备连接已更换');
  activeDeviceId = result.activeId;
  devicePresets = result.presets.map(preset => ({ ...preset, uuid: uuid(), _readonly: true, _device: true }));
  if (selectActive) selectedPresetId = devicePresets.find(preset => preset.id === activeDeviceId).uuid;
  else if (selectedDeviceId)
    selectedPresetId = (devicePresets.find(preset => preset.id === selectedDeviceId) || devicePresets[0]).uuid;
  renderAll();
}
function resetDeviceConnection(connection) {
  const closing = connection.abort();
  if (currentPreset()._device) selectedPresetId = templates[0].uuid;
  deviceConnection = null; deviceClient = null; devicePresets = []; activeDeviceId = 0; deviceBusy = false;
  deviceFirmware = null;
  $('firmwareNotice').hidden = true;
  return closing;
}
function deviceDisconnected(device) {
  if (!deviceConnection || device !== deviceConnection.device) return;
  ++deviceGeneration;
  resetDeviceConnection(deviceConnection);
  renderAll();
  toast('设备已断开，可以连接另一台设备', true);
}
async function runDeviceAction(action) {
  if (deviceBusy || !booted) return;
  const generation = deviceGeneration;
  deviceBusy = true; renderDeviceState();
  try { await action(); }
  catch (error) { if (generation === deviceGeneration) toast(error.message || String(error), true); }
  finally {
    if (generation === deviceGeneration) { deviceBusy = false; renderAll(); }
  }
}
$('connectDevice').addEventListener('click', () => runDeviceAction(async () => {
  if (deviceClient) { await refreshDevice(false); toast('设备预设已重新读取'); return; }
  const connection = await D.connectHid(navigator.hid);
  deviceConnection = connection;
  deviceClient = new D.DeviceClient(connection.session);
  let hello;
  try {
    hello = await deviceClient.hello();
    deviceFirmware = hello.fw;
    await refreshDevice(true);
  } catch (error) {
    if (deviceConnection === connection) await resetDeviceConnection(connection);
    throw error;
  }
  checkFirmwareUpdate(hello.fw);
  toast('设备读取完成；编辑会创建本地副本，不会自动写入');
}));
navigator.hid?.addEventListener('disconnect', event => deviceDisconnected(event.device));
function chooseReplacement(preset) {
  const dialog = $('replaceDialog'), select = $('replaceTarget');
  $('replaceDescription').textContent = `选择一套设备预设，用“${preset.name}”覆盖。本地预设和 ID 不会改变。`;
  select.replaceChildren(...devicePresets.map(item => {
    const option = document.createElement('option'); option.value = item.id; option.textContent = `${item.name}（ID ${item.id}）`; return option;
  }));
  dialog.returnValue = '';
  return new Promise(resolve => {
    dialog.addEventListener('close', () => {
      resolve(dialog.returnValue === 'default' ? devicePresets.find(item => item.id === Number(select.value)) : null);
    }, { once: true });
    dialog.showModal();
  });
}
async function installPreset(source) {
  const errors = P.presetErrors(source);
  if (errors.length) throw new Error(errors[0]);
  const { preset: outgoing, installed: resolved } = D.resolveSlotTarget(P.clonePreset(source), devicePresets);
  const local = userPresets.find(item => item.uuid === source.uuid);
  let installed = resolved;
  if (!installed && devicePresets.length >= 6) {
    installed = await chooseReplacement(outgoing);
    if (!installed) return null;
    outgoing.id = installed.id;
  }
  const message = installed ? `将用“${outgoing.name}”替换设备上的“${installed.name}”（ID ${outgoing.id}）。` :
    `将把“${outgoing.name}”（ID ${outgoing.id}）安装到设备。`;
  if (!confirm(`${message}\n写入后会立即重读并逐字节验证。是否继续？`)) return null;
  await deviceClient.writeVerified(outgoing);
  if (local) { local._dirty = false; local._dirtySlots = []; local._installedId = outgoing.id; }
  saveLibrary();
  return outgoing;
}
$('applyPreset').addEventListener('click', () => runDeviceAction(async () => {
  if (!deviceClient || currentPreset()._device) return;
  const installed = await installPreset(currentPreset());
  if (!installed) return;
  await refreshDevice(false);
  toast(`“${installed.name}”已写入设备，重读验证通过`);
}));
$('applyAll').addEventListener('click', () => runDeviceAction(async () => {
  const dirty = userPresets.filter(preset => preset._dirty);
  if (!deviceClient || !dirty.length) return;
  const plans = D.planBatch(dirty.map(P.clonePreset), devicePresets);
  plans.forEach((plan, index) => { plan.sourceUuid = dirty[index].uuid; plan.sourceId = dirty[index].id; });
  const replacements = plans.filter(plan => plan.installed).length;
  const mapping = plans.filter(plan => plan.installed && plan.preset.id !== plan.sourceId)
    .map(plan => `“${plan.preset.name}” → 覆盖设备“${plan.installed.name}”（ID ${plan.preset.id}）`).join('\n');
  const details = mapping ? `\n槽位覆盖映射：\n${mapping}` : '';
  if (!confirm(`将应用 ${plans.length} 套本地修改：${replacements} 套覆盖，${plans.length - replacements} 套新安装。${details}\n逐条写入并验证，任何失败都会立即停止。是否继续？`)) return;
  let applied = 0;
  try {
    for (const plan of plans) {
      await deviceClient.writeVerified(plan.preset);
      const local = userPresets.find(preset => preset.uuid === plan.sourceUuid);
      if (local) { local._dirty = false; local._dirtySlots = []; local._installedId = plan.preset.id; }
      ++applied; saveLibrary();
    }
  } catch (error) {
    let refreshed = true;
    try { await refreshDevice(false); } catch (_) { refreshed = false; }
    throw new Error(`已应用 ${applied}/${plans.length} 套；${error.message}。${refreshed ? '已重新读取设备状态' : '设备状态重读失败，请手动重新读取'}`);
  }
  await refreshDevice(false);
  toast(`已应用并验证 ${applied}/${plans.length} 套修改`);
}));
function moveSelectedDevice(direction) {
  return runDeviceAction(async () => {
    const preset = devicePresets[selectedDeviceIndex()];
    const beforeId = preset && D.moveAnchor(devicePresets, preset.id, direction);
    if (!preset || beforeId === null) return;
    await deviceClient.move(preset.id, beforeId);
    await refreshDevice(false);
    toast(`“${preset.name}”已${direction < 0 ? '上移' : '下移'}，设备顺序已刷新`);
  });
}
function deleteSelectedDevice() {
  return runDeviceAction(async () => {
    const preset = devicePresets[selectedDeviceIndex()];
    if (!preset || devicePresets.length <= 1) return;
    const activeNote = preset.id === activeDeviceId ? '\n这是当前使用中的预设，删除后设备会切换到列表第一套。' : '';
    if (!confirm(`从设备删除“${preset.name}”（ID ${preset.id}）？${activeNote}\n浏览器中的本地副本会保留。`)) return;
    await deviceClient.remove(preset.id);
    await refreshDevice(false);
    toast(`已从设备删除“${preset.name}”，本地副本未改变`);
  });
}
window.addEventListener('focus', () => {
  if (!deviceClient || deviceBusy || !deviceConnection.device.opened) return;
  runDeviceAction(() => refreshDevice(false));
});
function renderAll() {
  renderTitle(); renderLibrary(); renderDeviceLibrary(); renderSvg(); renderInspector(); renderSaveState(); renderDeviceState();
}

$('inspector').addEventListener('change', event => {
  if (event.target.name === 'rgbMode') {
    const preset = ensureUserCopy();
    preset.rgbMode = Number(event.target.value);
    markDirty(-1);
    renderInspector();
    return;
  }
  const form = event.target.closest('.action-card');
  if (!form) return;
  const slot = Number(form.dataset.slot), preset = ensureUserCopy();
  if (event.target.dataset.field === 'kind') {
    const action = P.actionForKind(Number(event.target.value), preset.actions[slot]);
    preset.actions[slot] = action;
    markDirty(slot);
    renderSvg(); renderInspector();
  }
});
$('inspector').addEventListener('input', event => {
  const form = event.target.closest('.action-card');
  if (!form || event.target.dataset.field === 'kind') return;
  const slot = Number(form.dataset.slot), preset = ensureUserCopy(), action = { ...preset.actions[slot] };
  if (event.target.dataset.field === 'code') action.code = Number(event.target.value);
  else if (event.target.dataset.field === 'wheelDy') action.wheelDy = Number(event.target.value);
  else if (event.target.dataset.bit) action.mods = event.target.checked ? action.mods | Number(event.target.dataset.bit) : action.mods & ~Number(event.target.dataset.bit);
  const issue = P.actionError(action, slot < 16);
  if (issue) { toast(issue, true); return; }
  preset.actions[slot] = action;
  markDirty(slot);
  renderSvg();
  form.querySelector('h3').innerHTML = `<span>${form.querySelector('h3 span').textContent}</span> · ${P.actionLabel(action, platformOf(preset))}`;
});
function rejectPresetName(input, issue) {
  input.value = currentPreset().name;
  $('nameBytes').textContent = `${P.utf8Length(input.value)}/23B`;
  $('nameBytes').style.color = '';
  toast(`预设名称无效：${issue}`, true);
}
$('presetName').addEventListener('input', event => {
  if (!booted) return;
  const name = event.target.value;
  $('nameBytes').textContent = `${P.utf8Length(name)}/23B`;
  $('nameBytes').style.color = P.nameError(name) ? 'var(--danger)' : '';
  if (event.isComposing || P.nameError(name)) return;
  const preset = ensureUserCopy();
  preset.name = name;
  preset._dirty = true;
  saveLibrary(); renderLibrary(); renderTitle(); renderSaveState(); renderDeviceState();
});
$('presetName').addEventListener('change', event => {
  if (!booted) return;
  const issue = P.nameError(event.target.value);
  if (issue) rejectPresetName(event.target, issue);
});
$('presetAccent').addEventListener('input', event => {
  if (!booted) return;
  const hex = event.target.value, preset = ensureUserCopy();
  preset.accent = [1, 3, 5].map(offset => parseInt(hex.slice(offset, offset + 2), 16));
  markDirty(-1); renderLibrary();
});
// 平台随 150B 记录落盘（byte 13，D23）：与主题色同等对待——标 dirty、应用时写入设备
$('presetPlatform').addEventListener('change', event => {
  if (!booted) return;
  const platform = P.normalizePlatform(event.target.value);
  const preset = ensureUserCopy();
  if (platformOf(preset) === platform) return;
  preset.platform = platform;
  markDirty(-1); renderSvg(); renderInspector();
});
document.querySelectorAll('.tab').forEach(tab => tab.addEventListener('click', () => { if (!booted) return; activeTab = tab.dataset.tab; renderInspector(); }));
function nextPresetId() {
  const ids = [...templates, ...userPresets, ...quarantinedPresets, ...devicePresets]
    .map(preset => preset?.id).filter(id => Number.isInteger(id));
  return Math.max(...ids, 0) + 1;
}
$('newPreset').addEventListener('click', () => {
  if (!booted) return;
  const nextId = nextPresetId();
  if (nextId > 255) { toast('本地 presetId 已用完', true); return; }
  const preset = P.createEmptyPreset(nextId, `自定义预设 ${nextId}`);
  preset.uuid = uuid(); preset._dirty = true; preset._readonly = false; preset.originTemplateId = null;
  userPresets.push(preset); selectedPresetId = preset.uuid;
  const saved = saveLibrary(); renderAll();
  if (!saved) toast('新预设仅保留在当前页面，未能保存到浏览器', true);
});
$('duplicatePreset').addEventListener('click', () => {
  if (!booted) return;
  const source = currentPreset(), preset = P.clonePreset(source), nextId = nextPresetId();
  if (nextId > 255) { toast('本地 presetId 已用完', true); return; }
  preset.id = nextId; preset.uuid = uuid(); preset.name = `${preset.name} 副本`; preset._dirty = true;
  const issue = P.nameError(preset.name);
  if (issue) { toast(`无法创建副本：${issue}，请先缩短预设名称`, true); return; }
  preset._readonly = false; delete preset._device; delete preset.templateId; delete preset._installedId;
  preset.originTemplateId = null;
  preset.originTemplateVersion = null;
  userPresets.push(preset); selectedPresetId = preset.uuid;
  const saved = saveLibrary(); renderAll();
  if (!saved) toast('副本仅保留在当前页面，未能保存到浏览器', true);
});
$('deletePreset').addEventListener('click', () => {
  if (!booted) return;
  const index = userPresets.findIndex(preset => preset.uuid === selectedPresetId);
  if (index < 0) return;
  const preset = userPresets[index];
  if (!confirm(`从“我的预设”删除“${preset.name}”？\n只删除浏览器本地副本，不会删除设备上的预设。`)) return;
  userPresets.splice(index, 1);
  selectedPresetId = (userPresets[Math.min(index, userPresets.length - 1)] || templates[0]).uuid;
  selectedInput = { type: 'btn', index: 0 };
  const saved = saveLibrary(); renderAll();
  toast(saved ? '本地预设已删除，设备内容未改变' : '删除仅保留在当前页面，未能保存到浏览器', !saved);
});
$('resetLibrary').addEventListener('click', () => {
  if (!booted) return;
  const recovering = Boolean(libraryLoadError);
  if (recovering) {
    if (!confirm('将先下载无法读取的原始本地库，再写入空库。原始数据会被替换，是否继续？')) return;
    try {
      downloadBlob(localStorage.getItem(STORAGE_KEY), 'navio-editor-library-backup.txt', 'text/plain');
    } catch (error) {
      toast(`原始库备份失败，恢复已取消：${error.message}`, true);
      return;
    }
    libraryLoadError = null;
  } else if (!confirm('清空“我的预设”？官方模板会保留。')) return;
  userPresets = []; quarantinedPresets = []; selectedPresetId = templates[0].uuid;
  selectedInput = { type: 'btn', index: 0 };
  if (!saveLibrary()) {
    if (recovering) { libraryLoadError = librarySaveError; librarySaveError = null; }
    renderAll();
    return;
  }
  renderAll();
  if (recovering) toast('本地库已重建，原始数据已下载备份');
});
$('exportPreset').addEventListener('click', () => {
  if (!booted) return;
  const preset = P.clonePresetData(currentPreset());
  const content = { schemaVersion: 1, product: 'navio-chron', record: 1,
    metadata: { author: 'local', platform: 'custom' }, preset };
  downloadBlob(JSON.stringify(content, null, 2), `${preset.name || 'preset'}.navio.json`, 'application/json');
});
$('importPreset').addEventListener('change', async event => {
  if (!booted) return;
  const file = event.target.files[0];
  if (!file) return;
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
      preset.id = nextId;
      idNote = `；原 ID ${originalId} 冲突，已分配 ${nextId}`;
    }
    preset.uuid = uuid(); preset._dirty = true; preset._readonly = false; preset.originTemplateId = null;
    userPresets.push(preset); selectedPresetId = preset.uuid;
    const saved = saveLibrary(); renderAll();
    toast((saved ? '已导入本地库，未写入设备' : '已导入当前页面，但未能保存到浏览器') + idNote, !saved);
  } catch (error) { toast(error.message, true); }
  event.target.value = '';
});

boot();
