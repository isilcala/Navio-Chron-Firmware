import { renderDevice, escapeHtml } from './device.js';

const P = NavioEditorPreset;
const $ = id => document.getElementById(id);
const PLATFORM = { win: 'Windows', mac: 'macOS', ipad: 'iPadOS' };
const PLATFORM_SHORT = { win: 'Win', mac: 'Mac', ipad: 'iPad' };
const query = new URLSearchParams(location.search);

function chord(code, mods = 0) { return { kind: P.Kind.KeyChord, code, mods, wheelDy: 0 }; }
function consumer(code) { return { kind: P.Kind.Consumer, code, mods: 0, wheelDy: 0 }; }
function wheel(wheelDy) { return { kind: P.Kind.Wheel, code: 0, mods: 0, wheelDy }; }
function mockPreset(id, name, platform = 'win', accent = [232, 120, 50]) {
  const preset = P.createEmptyPreset(id, name);
  preset.platform = platform;
  preset.accent = accent;
  const codes = [0x2C, 0x2A, 0x2B, 0x4C, 0x1A, 0x08, 0x15, 0x52, 0x28, 0x50, 0x51, 0x4F];
  codes.forEach((code, index) => { preset.actions[index] = chord(code, index === 4 ? 1 : 0); });
  preset.actions[12] = chord(0x2C);
  preset.actions[13] = chord(0x2C);
  preset.actions[14] = chord(0x28);
  preset.actions[16] = consumer(0xE9);
  preset.actions[17] = consumer(0xEA);
  preset.actions[18] = wheel(1);
  preset.actions[19] = wheel(-1);
  preset.actions[20] = chord(0x2C, 1);
  preset.actions[21] = chord(0x2C, 1);
  return preset;
}
function entry(key, source, preset, extra = {}) { return { ...preset, ...extra, key, source }; }

const templates = [
  entry('jianying-win', 'template', mockPreset(1, '剪映', 'win', [255, 120, 40]), { installedId: 1 }),
  entry('jianying-mac', 'template', mockPreset(2, '剪映', 'mac', [255, 120, 40])),
  entry('resolve-win', 'template', mockPreset(3, 'DaVinci Resolve', 'win', [63, 140, 220])),
  entry('resolve-mac', 'template', mockPreset(4, 'DaVinci Resolve', 'mac', [63, 140, 220])),
  entry('premiere-win', 'template', mockPreset(5, 'Premiere Pro', 'win', [142, 92, 210])),
  entry('premiere-mac', 'template', mockPreset(6, 'Premiere Pro', 'mac', [142, 92, 210])),
  entry('procreate', 'template', mockPreset(7, 'Procreate', 'ipad', [38, 166, 154])),
  entry('test', 'template', mockPreset(8, '输入测试', 'win', [93, 113, 130])),
  entry('f13', 'template', mockPreset(9, 'F13 宏模板', 'win', [190, 80, 110])),
];
const users = [
  entry('my-resolve', 'local', mockPreset(10, 'Resolve · 我的工作流', 'win', [63, 140, 220]), { dirty: true, installed: true, installedId: 2 }),
  entry('my-jianying', 'local', mockPreset(11, '剪映 · 自定义', 'win', [255, 120, 40]), { dirty: false, installed: true, installedId: 1 }),
];
const devices = [
  entry('device-jianying', 'device', mockPreset(1, '剪映', 'win', [255, 120, 40]), { active: true }),
  entry('device-resolve', 'device', mockPreset(2, 'DaVinci Resolve', 'win', [63, 140, 220])),
  entry('device-premiere', 'device', mockPreset(3, 'Premiere Pro', 'mac', [142, 92, 210])),
  entry('device-procreate', 'device', mockPreset(4, 'Procreate', 'ipad', [38, 166, 154])),
];
const state = {
  page: query.get('page') === 'firmware' ? 'firmware' : 'editor',
  connected: true,
  selectedKey: 'my-resolve',
  libraryTab: 'library',
  workspaceTab: 'mapping',
  selectedInput: { type: 'btn', index: 0 },
  firmwareState: 'ready',
  firmwareProgress: 62,
  updateVisible: true,
  editorScene: 'local',
  editWorking: null,
  editSourceKey: null,
  editContext: null,
  writeVerified: false,
};
let toastTimer;
let firmwareTimer;
let firmwareProgressTimer;
let pendingAfterEdit = null;

const editorScenes = [
  ['local', '本地预设 · 待更新'], ['template', '项目模板'], ['device', '键盘预设 · 只读'],
  ['disconnected', '未连接设备'], ['full', '键盘已满 · 替换'],
];
const firmwareScenes = [
  ['ready', '初始 · 连接设备'], ['checking', '正在检查'], ['confirm', '确认更新'],
  ['updating', '正在更新'], ['success', '更新完成'], ['latest', '已是最新'],
  ['rescue', 'BOOT 救援'], ['error', '连接中断'],
];

function allPresets() { return [...templates, ...users, ...devices]; }
function currentPreset() {
  return state.editWorking || allPresets().find(preset => preset.key === state.selectedKey) || users[0] || templates[0];
}
function accentHex(preset) { return `#${preset.accent.map(value => value.toString(16).padStart(2, '0')).join('')}`; }
function linkedDevice(preset) { return devices.find(item => item.id === preset.installedId) || null; }
function existingSourceCopy(preset) { return users.find(item => item.originSourceKey === preset.key) || null; }
function editingKeyboard() { return Boolean(state.editWorking && state.editContext === 'device'); }
function keyboardOriginal() { return devices.find(item => item.key === state.editSourceKey) || null; }
function sourceLabel(preset) {
  if (state.editWorking) return `${state.editContext === 'device' ? '键盘预设' : '我的预设'} · 编辑中`;
  if (preset.source === 'template') return '项目模板';
  if (preset.source === 'device') return '键盘中的预设';
  return '我的预设';
}
function showToast(message) {
  clearTimeout(toastTimer);
  $('toast').textContent = message;
  $('toast').classList.add('show');
  toastTimer = setTimeout(() => $('toast').classList.remove('show'), 2800);
}
function openDialog(id) { $(id).showModal(); }
function closeDialog(id) { $(id).close(); }
function closePopovers() { $('colorPopover').hidden = true; $('platformPopover').hidden = true; }

function presetItem(preset) {
  const active = preset.key === state.selectedKey;
  let subline = PLATFORM[preset.platform];
  if (preset.source === 'template' && linkedDevice(preset)) subline += ' · 已安装';
  if (preset.source === 'device') {
    const editing = state.editWorking && state.editContext === 'device' && active;
    subline = `${PLATFORM[preset.platform]}${preset.active ? ' · 使用中' : ''}${editing ? ' · 编辑中' : ''}`;
  }
  if (preset.source === 'local') {
    const linked = linkedDevice(preset);
    subline = preset.dirty && linked ? '已安装 · 有修改' : linked ? '已安装 · 与键盘一致' : '未安装';
  }
  const badge = preset.active ? '<span class="state-chip">使用中</span>' : `<span class="platform-chip">${PLATFORM_SHORT[preset.platform]}</span>`;
  const existingCopy = preset.source === 'local' ? null : existingSourceCopy(preset);
  const copyLabel = preset.source === 'local' ? '复制预设' : existingCopy ? '打开我的副本' : '复制到我的预设';
  const actions = state.editWorking || preset.source === 'device' ? '' : `<span class="preset-item-actions">
    <button class="preset-card-action" data-copy="${preset.key}" aria-label="${copyLabel} ${escapeHtml(preset.name)}" title="${copyLabel}"><svg viewBox="0 0 20 20" aria-hidden="true"><rect x="6" y="6" width="9" height="10" rx="2"></rect><path d="M4 13V4a2 2 0 0 1 2-2h7"></path></svg></button>
    ${preset.source === 'local' ? `<button class="preset-card-action delete" data-delete="${preset.key}" aria-label="删除 ${escapeHtml(preset.name)}" title="删除我的预设"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M3 5h14M8 2h4l1 3H7l1-3ZM5 5l1 13h8l1-13M9 8v7M12 8v7"></path></svg></button>` : ''}
  </span>`;
  return `<div class="preset-item ${active ? 'active' : ''}" data-preset="${preset.key}" role="button" tabindex="0">
    <span class="preset-swatch" style="background:${accentHex(preset)}"></span>
    <span class="preset-item-copy"><strong>${escapeHtml(preset.name)}</strong><small>${escapeHtml(subline)}</small></span>
    <span class="preset-item-tail"><span class="preset-item-badge">${badge}</span>${actions}</span>
  </div>`;
}
function renderLibrary() {
  document.querySelectorAll('[data-library-tab]').forEach(button => {
    const active = button.dataset.libraryTab === state.libraryTab;
    button.classList.toggle('active', active);
    button.setAttribute('aria-selected', active);
  });
  $('deviceCount').textContent = devices.length;
  $('libraryToolbar').hidden = state.libraryTab !== 'library';
  if (!state.connected && state.libraryTab === 'device') {
    const current = editingKeyboard() ? keyboardOriginal() : null;
    $('libraryContent').innerHTML = `<div class="library-heading"><h2>连接已断开</h2></div>
      ${current ? `<div class="preset-list">${presetItem(current)}</div><div class="library-empty">当前修改仍在编辑中。重新连接后可保存到键盘。</div>` : '<div class="library-empty">连接键盘后，查看已安装的预设和当前使用顺序。</div>'}`;
    return;
  }
  if (state.libraryTab === 'device') {
    $('libraryContent').innerHTML = `<div class="device-summary"><strong>键盘中的预设</strong><span>${devices.length}/6 套</span></div>
      <div class="preset-list">${devices.map(presetItem).join('')}</div>
      <p class="device-order-hint">预设顺序决定短按侧键时的循环顺序。</p>
      <div class="device-management"><button class="button secondary" data-demo="move">上移</button><button class="button secondary" data-demo="move">下移</button>
      <button id="deleteKeyboardPreset" class="button danger">从键盘删除</button></div>
      <div class="keyboard-copy"><button id="copyDevicePreset" class="button secondary">复制到我的预设</button></div>`;
    const copyButton = $('copyDevicePreset');
    const selectedIndex = devices.findIndex(item => item.key === state.selectedKey);
    const selected = devices[selectedIndex] || null;
    const existing = selected ? existingSourceCopy(selected) : null;
    copyButton.textContent = existing ? '打开我的副本' : '复制到我的预设';
    copyButton.disabled = !state.connected || !selected || Boolean(state.editWorking);
    copyButton.onclick = () => { if (selected) copyPresetByKey(selected.key); };
    const moveButtons = document.querySelectorAll('[data-demo="move"]');
    moveButtons[0].disabled = selectedIndex <= 0 || Boolean(state.editWorking);
    moveButtons[1].disabled = selectedIndex < 0 || selectedIndex >= devices.length - 1 || Boolean(state.editWorking);
    $('deleteKeyboardPreset').disabled = !selected || devices.length <= 1 || Boolean(state.editWorking);
    $('deleteKeyboardPreset').onclick = () => { if (selected) openKeyboardDelete(selected); };
    return;
  }
  $('libraryContent').innerHTML = `<div class="library-heading"><h2>我的预设</h2></div>
    <div class="preset-list">${users.length ? users.map(presetItem).join('') : '<div class="library-empty">从项目模板或键盘显式复制后，独立预设会保存在这里。</div>'}</div>
    <div class="library-heading"><h2>项目模板</h2></div>
    <div class="preset-list">${templates.map(presetItem).join('')}</div>`;
}

function renderDeviceCanvas() {
  const preset = currentPreset();
  renderDevice($('deviceStage'), {
    actions: preset.actions,
    actionLabel: action => P.actionLabel(action, preset.platform),
    selected: state.workspaceTab === 'mapping' ? state.selectedInput : {},
    accent: preset.accent,
    lighting: state.workspaceTab === 'lighting',
    onSelect: input => {
      state.selectedInput = input;
      state.workspaceTab = 'mapping';
      renderWorkspaceTabs();
      renderDeviceCanvas();
      renderInspector();
    },
  });
  $('canvasHint').innerHTML = state.workspaceTab === 'lighting'
    ? '<span class="hint-dot"></span>网页仅为灯效示意，安装或更新后在设备上生效'
    : '<span class="hint-dot"></span>点击键位或旋钮开始编辑';
}
function renderWorkspaceTabs() {
  document.querySelectorAll('[data-workspace-tab]').forEach(button => {
    const active = button.dataset.workspaceTab === state.workspaceTab;
    button.classList.toggle('active', active);
    button.setAttribute('aria-selected', active);
  });
}
function keyOptions(selected) {
  return P.KEY_GROUPS.map(group => `<optgroup label="${group.label}">${P.KEY_OPTIONS.filter(option => option.group === group.id)
    .map(option => `<option value="${option.code}" ${option.code === selected ? 'selected' : ''}>${escapeHtml(option.optionLabel || option.label)}</option>`).join('')}</optgroup>`).join('');
}
function modifierGroup(labels, start, mods, readonly) {
  return `<div class="modifier-group"><span class="modifier-group-label">${start ? '右侧' : '左侧'}</span><div class="modifiers">${labels.slice(start, start + 4).map((label, offset) => {
    const bit = start + offset;
    const text = label.replace(/^R/, '右');
    return `<label class="modifier"><input type="checkbox" data-action-bit="${1 << bit}" ${mods & (1 << bit) ? 'checked' : ''} ${readonly ? 'disabled' : ''}>${text}</label>`;
  }).join('')}</div></div>`;
}
function actionForm(preset, slot, compact = false) {
  const action = preset.actions[slot];
  const readonly = !state.editWorking;
  const isButton = slot < 16;
  const labels = P.modLabels(preset.platform);
  const typeName = action.kind === P.Kind.None ? '未设置' : action.kind === P.Kind.KeyChord ? '快捷键' : action.kind === P.Kind.Consumer ? '媒体控制' : '滚轮';
  return `<div class="action-card" data-slot="${slot}">
    ${compact ? `<div class="action-card-title"><strong>${slot % 2 === 0 && slot >= 16 ? '顺时针' : slot >= 16 ? '逆时针' : '下压'}</strong><span>${typeName}</span></div>` : ''}
    <label class="field">动作类型<select data-action-field="kind" ${readonly ? 'disabled' : ''}>
      <option value="0" ${action.kind === 0 ? 'selected' : ''}>未设置</option>
      <option value="1" ${action.kind === 1 ? 'selected' : ''}>快捷键</option>
      <option value="2" ${action.kind === 2 ? 'selected' : ''}>媒体控制</option>
      ${!isButton ? `<option value="3" ${action.kind === 3 ? 'selected' : ''}>滚轮</option>` : ''}
    </select></label>
    ${action.kind === P.Kind.KeyChord ? `<label class="field">键码<select data-action-field="code" ${readonly ? 'disabled' : ''}>${keyOptions(action.code)}</select></label>
      <div class="field">修饰键<div class="modifier-groups">${modifierGroup(labels, 0, action.mods, readonly)}${modifierGroup(labels, 4, action.mods, readonly)}</div></div>` : ''}
    ${action.kind === P.Kind.Consumer ? `<label class="field">功能<select data-action-field="code" ${readonly ? 'disabled' : ''}>${P.CONSUMER_OPTIONS.map(option => `<option value="${option.code}" ${option.code === action.code ? 'selected' : ''}>${option.label}</option>`).join('')}</select></label>` : ''}
    ${action.kind === P.Kind.Wheel ? `<label class="field">滚动格数<input type="number" min="-127" max="127" value="${action.wheelDy}" data-action-field="wheelDy" ${readonly ? 'disabled' : ''}><small>正数向下滚动，负数向上滚动</small></label>` : ''}
  </div>`;
}
function readonlyAction(preset) {
  if (preset.source === 'template') {
    const copy = existingSourceCopy(preset);
    return `<button class="button primary" data-action="copy-current" style="width:100%;margin-top:14px">${copy ? '打开我的副本' : '复制到我的预设'}</button>`;
  }
  return '';
}
function renderLighting(preset) {
  const readonly = !state.editWorking;
  return `<div class="inspector-heading"><span class="selection-label">整套预设</span><h2>灯光效果</h2><p>选择按键灯的表现方式</p></div>
    <div class="lighting-grid">${P.RGB_MODES.map(mode => `<label class="lighting-option"><input type="radio" name="rgbMode" value="${mode.value}" ${preset.rgbMode === mode.value ? 'checked' : ''} ${readonly ? 'disabled' : ''}><strong>${mode.label}</strong><small>${mode.description}</small></label>`).join('')}</div>
    <p class="lighting-note">LED0–LED2 状态灯不受影响。网页预览不代表键盘已实时更新。</p>
    ${readonly ? readonlyAction(preset) : ''}`;
}
function renderInspector() {
  const preset = currentPreset();
  if (state.workspaceTab === 'lighting') { $('inspector').innerHTML = renderLighting(preset); return; }
  if (state.selectedInput.type === 'btn' && state.selectedInput.index === 15) {
    $('inspector').innerHTML = `<div class="inspector-heading"><span class="selection-label">全局保留</span><h2>SideKey</h2><p>设备侧面按键</p></div>
      <div class="locked-card"><span class="lock-symbol">—</span><strong>此按键不可重新映射</strong><p>短按切换预设；侧键+K1/K2/K3 选择蓝牙频道；长按 5 秒在当前频道配对或替换主机。导入导出时会原样保留。</p></div>`;
    return;
  }
  const readonly = !state.editWorking;
  if (state.selectedInput.type === 'encoder') {
    const encoder = P.ENCODERS.find(item => item.id === state.selectedInput.id);
    $('inspector').innerHTML = `<div class="inspector-heading"><span class="selection-label">编码器</span><h2>${encoder.name}</h2><p>旋转与下压可分别设置</p></div>
      ${readonly ? readonlyNotice(preset) : ''}
      <div class="encoder-rotation-group">${actionForm(preset, encoder.ccwSlot, true)}${actionForm(preset, encoder.cwSlot, true)}</div>
      <div class="encoder-press">${actionForm(preset, encoder.pressSlot, true)}</div>`;
    return;
  }
  const index = state.selectedInput.index;
  const action = preset.actions[index];
  $('inspector').innerHTML = `<div class="inspector-heading"><span class="selection-label">按键 K${index + 1}</span><h2>键位设置</h2><p>选择这个按键要执行的动作</p></div>
    <div class="action-summary">${escapeHtml(P.actionLabel(action, preset.platform))}</div>
    ${readonly ? readonlyNotice(preset) : ''}${actionForm(preset, index)}`;
}
function readonlyNotice(preset) {
  const text = preset.source === 'template'
    ? '项目模板为只读。复制到我的预设后即可自由修改，也可以直接安装到键盘。'
    : preset.source === 'device' ? '当前为只读。可在下方点击“编辑”，保存到键盘前原预设不会改变。'
      : '当前为只读。可在下方点击“编辑”，保存到我的预设后才会保留本次修改。';
  return `<div class="readonly-card"><p>${text}</p>${readonlyAction(preset)}</div>`;
}

function renderPresetHeader() {
  const preset = currentPreset();
  const readonly = !state.editWorking;
  const original = keyboardOriginal();
  $('presetTitle').textContent = preset.name;
  $('presetTitle').hidden = false;
  $('presetNameInput').hidden = true;
  $('presetNameInput').setAttribute('aria-invalid', 'false');
  $('renameActions').hidden = true;
  $('renameError').hidden = true;
  $('presetTitle').setAttribute('aria-disabled', readonly);
  $('presetSource').innerHTML = `<span class="source-chip">${sourceLabel(preset)}</span>${state.editWorking?.dirty ? '<span class="dirty-label">未保存</span>' : ''}`;
  $('accentButton').style.background = accentHex(preset);
  $('accentInput').value = accentHex(preset);
  $('platformButton').innerHTML = `${PLATFORM[preset.platform]} <span class="chevron" aria-hidden="true"></span>`;
  $('accentButton').disabled = readonly;
  $('platformButton').disabled = readonly;
  $('draftNotice').hidden = !state.editWorking;
  if (state.editWorking) {
    const target = editingKeyboard() ? '键盘' : '我的预设';
    const name = editingKeyboard() ? original?.name || preset.name : allPresets().find(item => item.key === state.editSourceKey)?.name || preset.name;
    $('draftNotice').innerHTML = `<strong>正在编辑「${escapeHtml(name)}」</strong><span>修改尚未保存到${target}。</span>`;
  }
  closePopovers();
}
function renderActionbar() {
  const preset = currentPreset();
  const button = $('writePreset');
  const editing = Boolean(state.editWorking);
  const linked = linkedDevice(preset);
  $('editPreset').hidden = editing || preset.source !== 'local';
  $('discardEdit').hidden = !editing;
  $('writeResult').hidden = !state.writeVerified || editing;
  $('writeResult').textContent = '已保存到键盘并完成验证';
  let title = '已保存到我的预设';
  let detail = '尚未安装到键盘';
  let label = '安装到键盘';
  let disabled = !state.connected;
  if (preset.source === 'template') {
    title = '项目模板 · 只读';
    detail = linked ? `再次安装将更新键盘中的「${linked.name}」` : '可作为新预设安装，或先复制到我的预设';
  }
  if (preset.source === 'device') {
    title = '键盘中的只读预设';
    detail = '点击编辑后开始修改，保存前键盘不会改变';
    label = '编辑';
    disabled = false;
  }
  if (preset.source === 'local' && linked) {
    detail = preset.dirty ? `键盘中的「${linked.name}」尚未更新` : `已安装到键盘中的「${linked.name}」`;
    label = preset.dirty ? '更新键盘中的此预设' : '无需更新';
    disabled = !state.connected || !preset.dirty;
  }
  if (editing) {
    title = preset.dirty ? '当前修改尚未保存' : '正在编辑当前预设';
    detail = editingKeyboard() ? '保存到键盘后才会改变原预设' : '保存到我的预设后才会保留本次修改';
    label = editingKeyboard() ? '保存到键盘' : '保存到我的预设';
    disabled = !preset.dirty || (editingKeyboard() && !state.connected);
  }
  if (!state.connected && preset.source !== 'device' && !editing) detail = '连接键盘后可安装或更新';
  $('saveSummaryTitle').textContent = title;
  $('saveSummaryDetail').textContent = detail;
  $('saveSummaryIcon').textContent = editing ? '!' : preset.source === 'device' ? 'i' : '✓';
  button.textContent = label;
  button.disabled = disabled;
}
function renderHeader() {
  const connected = state.connected && state.page === 'editor';
  $('connectionStatus').classList.toggle('connected', connected);
  $('connectionStatus').querySelector('span').textContent = connected ? 'Navio Chron 已连接' : '未连接';
  $('firmwareBadge').hidden = !connected;
  $('connectButton').hidden = state.page !== 'editor';
  $('connectButton').textContent = state.connected ? '重新读取' : '连接设备';
  $('updateBanner').hidden = state.page !== 'editor' || !state.connected || !state.updateVisible;
}
function renderEditor() {
  renderLibrary();
  renderPresetHeader();
  renderWorkspaceTabs();
  renderDeviceCanvas();
  renderInspector();
  renderActionbar();
}

function ensureEditable() {
  if (state.editWorking) return state.editWorking;
  showToast('请先点击“编辑”进入修改状态');
  return null;
}
function beginEdit() {
  if (state.editWorking) return;
  const preset = currentPreset();
  if (preset.source === 'template') return;
  state.editSourceKey = preset.key;
  state.editContext = preset.source;
  state.editWorking = P.clonePreset(preset);
  state.editWorking.dirty = false;
  state.writeVerified = false;
  renderEditor();
  $('inspector').querySelector('select:not(:disabled), input:not(:disabled)')?.focus();
}
function endEdit() {
  state.editWorking = null;
  state.editSourceKey = null;
  state.editContext = null;
  state.writeVerified = false;
  pendingAfterEdit = null;
}
function requestLeave(action) {
  if (!state.editWorking) { action?.(); return; }
  if (!state.editWorking.dirty) { endEdit(); renderEditor(); action?.(); return; }
  pendingAfterEdit = action;
  $('unsavedTitle').textContent = '当前修改尚未保存';
  $('unsavedDescription').textContent = editingKeyboard()
    ? '保存到键盘后才会改变键盘中的预设。放弃后，本次修改不会被保留。'
    : '保存到我的预设后才会保留这些修改。放弃后，本次修改不会写入本地库。';
  $('saveChanges').textContent = editingKeyboard() ? '保存到键盘' : '保存到我的预设';
  $('saveChanges').disabled = editingKeyboard() && !state.connected;
  openDialog('unsavedDialog');
  $('continueEdit').focus();
}
function discardAndContinue() {
  const action = pendingAfterEdit;
  endEdit();
  closeDialog('unsavedDialog');
  renderEditor();
  if (action) action();
  else $(currentPreset().source === 'device' ? 'writePreset' : 'editPreset').focus();
}
function saveAndContinue() {
  const action = pendingAfterEdit;
  if (!saveCurrent()) return;
  closeDialog('unsavedDialog');
  action?.();
}
function saveCurrent() {
  const working = state.editWorking;
  if (!working) return true;
  if (editingKeyboard() && !state.connected) return false;
  const target = editingKeyboard() ? keyboardOriginal() : users.find(item => item.key === state.editSourceKey);
  if (!target) return false;
  target.name = working.name;
  target.platform = working.platform;
  target.accent = [...working.accent];
  target.rgbMode = working.rgbMode;
  target.actions = P.clonePreset(working).actions;
  if (!editingKeyboard()) target.dirty = Boolean(linkedDevice(target));
  const savedToKeyboard = editingKeyboard();
  endEdit();
  state.writeVerified = savedToKeyboard;
  if ($('writeDialog').open) closeDialog('writeDialog');
  renderEditor();
  $(savedToKeyboard ? 'writePreset' : 'editPreset').focus();
  showToast(savedToKeyboard ? '已保存到键盘并完成验证' : '已保存到我的预设');
  return true;
}
function openWriteDialog() {
  const preset = currentPreset();
  if (state.editWorking) {
    if (!editingKeyboard()) { saveCurrent(); return; }
    const original = keyboardOriginal();
    $('writeDialogTitle').textContent = '保存到键盘';
    $('writeDialogDescription').textContent = `将把本次修改保存到键盘中的“${original?.name || preset.name}”。键盘中的顺序保持不变。`;
    $('replacementField').hidden = true;
    $('installAsNewField').hidden = true;
    $('confirmWrite').textContent = '保存到键盘';
    openDialog('writeDialog');
    return;
  }
  if (preset.source === 'device') { beginEdit(); return; }
  const linked = linkedDevice(preset);
  const full = devices.length >= 6 && !linked;
  $('writeDialogTitle').textContent = linked ? '更新键盘中的此预设' : full ? '键盘已满，选择替换目标' : '安装到键盘';
  $('writeDialogDescription').textContent = linked
    ? `将用“${preset.name}”更新上次安装的目标“${linked.name}”。不会创建重复预设。`
    : full ? '键盘中已有 6 套预设。选择一套进行替换，我的预设不会改变。'
      : `将把“${preset.name}”作为新预设安装到键盘，现有预设不会被覆盖。`;
  $('replacementTarget').replaceChildren(...devices.map(item => new Option(item.name, item.key)));
  $('replacementField').hidden = !full;
  $('installAsNewField').hidden = !linked || devices.length >= 6;
  $('installAsNew').checked = false;
  $('confirmWrite').textContent = full ? '确认替换' : linked ? '确认更新' : '确认安装';
  openDialog('writeDialog');
}

function firmwareStepIndex() {
  return { ready: 0, checking: 0, confirm: 1, updating: 2, success: 3, latest: 3, rescue: 0, error: 0 }[state.firmwareState];
}
function renderFirmwareSteps() {
  const active = firmwareStepIndex();
  const order = ['connect', 'confirm', 'update', 'done'];
  document.querySelectorAll('#firmwareSteps li').forEach(item => {
    const index = order.indexOf(item.dataset.step);
    item.classList.toggle('active', index === active);
    item.classList.toggle('complete', index < active);
    item.querySelector('span').textContent = index < active ? '✓' : index + 1;
  });
}
function firmwareContent() {
  switch (state.firmwareState) {
    case 'checking': return `<div class="firmware-state"><div class="spinner" aria-label="正在检查"></div><h2>正在检查设备</h2><p>正在识别键盘和当前固件，请稍候。</p></div>`;
    case 'confirm': return `<div class="firmware-state"><h2>确认固件更新</h2><p>检查完成，可以开始更新。</p>
      <div class="version-comparison"><div><span>当前版本</span><strong>0.5.20</strong></div><span class="arrow">→</span><div><span>目标版本</span><strong>0.5.23</strong></div></div>
      <div class="update-facts"><span>更新方式：应用内更新</span><span>数据影响：<strong>保留你的预设</strong></span></div>
      <div class="firmware-actions"><button class="button secondary" data-fw-action="cancel">取消</button><button class="button primary" data-fw-action="confirm">开始更新</button></div>
      <p class="usb-note">更新期间请保持 USB 连接，不要关闭页面。</p></div>`;
    case 'updating': return `<div class="firmware-state"><h2>正在更新固件</h2><p>正在写入设备，请保持 USB 连接。</p>
      <div class="progress-value">${state.firmwareProgress}%</div><div class="progress-track" role="progressbar" aria-valuenow="${state.firmwareProgress}" aria-valuemin="0" aria-valuemax="100"><span style="width:${state.firmwareProgress}%"></span></div>
      <p class="progress-caption">不要关闭页面或拔出设备。</p></div>`;
    case 'success': return `<div class="firmware-state"><div class="state-symbol success">✓</div><h2>固件写入完成</h2><p>设备正在自动重启。</p>
      <div class="firmware-actions success-next"><button class="button secondary" data-fw-action="restart">返回固件更新</button><button class="button primary" data-fw-action="configure">配置预设</button></div></div>`;
    case 'latest': return `<div class="firmware-state"><div class="state-symbol success">✓</div><h2>你的设备已是最新</h2><p>当前固件 0.5.23，无需更新。</p>
      <div class="firmware-actions success-next"><button class="button primary" data-fw-action="configure">打开预设编辑器</button></div></div>`;
    case 'rescue': return `<div class="rescue-card"><div class="state-symbol">↻</div><h2>需要一次手动连接</h2><p>自动更新暂时无法继续。按以下步骤操作即可，不会反复重启设备。</p>
      <div class="rescue-steps"><div class="rescue-step"><span>1</span><div><strong>拔下 USB</strong><p>让设备完全断电。</p></div></div><div class="rescue-step"><span>2</span><div><strong>按住 BOOT 键</strong><p>保持按住，不要松开。</p></div></div><div class="rescue-step"><span>3</span><div><strong>插入 USB 后松开</strong><p>设备进入手动连接状态。</p></div></div><div class="rescue-step"><span>4</span><div><strong>回到此页面继续</strong><p>下一步会请求选择设备串口。</p></div></div></div>
      <button class="button primary" data-fw-action="rescue-continue">我已准备好，连接设备</button></div>`;
    case 'error': return `<div class="firmware-state"><div class="state-symbol error">!</div><h2>连接已中断</h2><p>设备没有响应，可以重新连接后再试。</p><div class="error-detail">尚未开始写入，设备中的固件和预设没有改变。</div>
      <div class="firmware-actions"><button class="button secondary" data-fw-action="rescue">使用救援方式</button><button class="button primary" data-fw-action="retry">重新连接</button></div></div>`;
    default: return `<div class="release-ready"><div class="release-icon">N</div><h2>Navio Chron 固件</h2><p>最新发布版本已就绪</p><div class="release-version"><strong>0.5.23</strong><span>稳定版</span></div>
      <button class="button primary" data-fw-action="start">连接设备</button><p class="release-help">使用桌面 Chrome 或 Edge，通过 USB 连接设备</p></div>`;
  }
}
function clearFirmwareTimers() {
  clearTimeout(firmwareTimer);
  clearInterval(firmwareProgressTimer);
}
function renderFirmware() {
  clearFirmwareTimers();
  renderFirmwareSteps();
  $('firmwareCard').innerHTML = firmwareContent();
}
function setFirmwareState(next) {
  state.firmwareState = next;
  if (next === 'updating' && state.firmwareProgress >= 100) state.firmwareProgress = 0;
  renderFirmware();
}
function beginSimulatedUpdate() {
  state.firmwareProgress = 8;
  setFirmwareState('updating');
  firmwareProgressTimer = setInterval(() => {
    state.firmwareProgress = Math.min(100, state.firmwareProgress + 13);
    renderFirmwareSteps();
    $('firmwareCard').innerHTML = firmwareContent();
    if (state.firmwareProgress >= 100) {
      clearInterval(firmwareProgressTimer);
      firmwareTimer = setTimeout(() => setFirmwareState('success'), 350);
    }
  }, 220);
}

function updatePreviewScenes() {
  const scenes = state.page === 'editor' ? editorScenes : firmwareScenes;
  $('previewScene').replaceChildren(...scenes.map(([value, label]) => new Option(label, value)));
  $('previewScene').value = state.page === 'editor' ? state.editorScene : state.firmwareState;
}
function setPage(page) {
  clearFirmwareTimers();
  state.page = page;
  document.querySelectorAll('[data-page]').forEach(button => {
    if (!button.classList.contains('nav-item')) return;
    const active = button.dataset.page === page;
    button.classList.toggle('active', active);
    if (active) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  });
  $('editorView').hidden = page !== 'editor';
  $('firmwareView').hidden = page !== 'firmware';
  $('previewPage').value = page;
  renderHeader();
  if (page === 'editor') renderEditor();
  else renderFirmware();
  updatePreviewScenes();
  document.title = `${page === 'editor' ? '预设' : '固件更新'} · Navio Chron 交互原型`;
}
function applyEditorScene(scene) {
  const resetFullScene = state.editorScene === 'full' && scene !== 'full';
  state.editorScene = scene;
  state.connected = scene !== 'disconnected';
  state.workspaceTab = 'mapping';
  state.libraryTab = 'library';
  endEdit();
  state.writeVerified = false;
  state.selectedInput = { type: 'btn', index: 0 };
  if (resetFullScene) while (devices.length > 4) devices.pop();
  users[0].installed = scene !== 'full';
  users[0].installedId = scene === 'full' ? null : 2;
  if (scene === 'template') state.selectedKey = 'jianying-win';
  else if (scene === 'device') { state.selectedKey = 'device-jianying'; state.libraryTab = 'device'; }
  else if (scene === 'full') {
    state.selectedKey = 'my-resolve';
    while (devices.length < 6) devices.push(entry(`device-extra-${devices.length}`, 'device', mockPreset(devices.length + 1, `预设 ${devices.length + 1}`)));
  } else state.selectedKey = 'my-resolve';
  users[0].dirty = true;
  renderHeader();
  renderEditor();
}
function beginRename() {
  const preset = currentPreset();
  if (!state.editWorking) {
    showToast(preset.source === 'template' ? '项目模板为只读，请先复制到我的预设' : '请先点击“编辑”进入修改状态');
    return;
  }
  closePopovers();
  $('renameError').hidden = true;
  $('presetNameInput').setAttribute('aria-invalid', 'false');
  $('presetNameInput').value = preset.name;
  $('presetTitle').hidden = true;
  $('presetNameInput').hidden = false;
  $('renameActions').hidden = false;
  $('presetNameInput').focus();
  $('presetNameInput').select();
}
function finishRename(commit) {
  const input = $('presetNameInput');
  if (input.hidden) return;
  if (!commit) {
    input.hidden = true;
    $('presetTitle').hidden = false;
    $('renameActions').hidden = true;
    $('renameError').hidden = true;
    input.setAttribute('aria-invalid', 'false');
    return;
  }
  const name = input.value.trim();
  if (!name || P.utf8Length(name) > 23) {
    $('renameError').textContent = name ? '名称最长为 23 个 UTF-8 字节，请缩短后再确认。' : '请输入预设名称后再确认。';
    $('renameError').hidden = false;
    input.setAttribute('aria-invalid', 'true');
    input.focus();
    return;
  }
  const preset = ensureEditable();
  if (!preset) return;
  preset.name = name;
  preset.dirty = true;
  state.writeVerified = false;
  renderEditor();
}
function setAccent(hex) {
  const preset = ensureEditable();
  if (!preset) return;
  preset.accent = [1, 3, 5].map(offset => parseInt(hex.slice(offset, offset + 2), 16));
  preset.dirty = true;
  state.writeVerified = false;
  renderEditor();
}

for (const button of document.querySelectorAll('[data-page]')) button.addEventListener('click', () => {
  if (button.dataset.page === state.page) return;
  requestLeave(() => setPage(button.dataset.page));
});
for (const button of document.querySelectorAll('[data-library-tab]')) button.addEventListener('click', () => {
  if (button.dataset.libraryTab === state.libraryTab) return;
  requestLeave(() => { state.libraryTab = button.dataset.libraryTab; renderEditor(); });
});
for (const button of document.querySelectorAll('[data-workspace-tab]')) button.addEventListener('click', () => { state.workspaceTab = button.dataset.workspaceTab; renderWorkspaceTabs(); renderDeviceCanvas(); renderInspector(); });
for (const button of document.querySelectorAll('[data-close]')) button.addEventListener('click', () => closeDialog(button.dataset.close));

function selectPreset(key) {
  if (key === state.selectedKey) return;
  requestLeave(() => {
    state.selectedKey = key;
    state.writeVerified = false;
    renderEditor();
  });
}
$('libraryContent').addEventListener('click', event => {
  const copyButton = event.target.closest('[data-copy]');
  if (copyButton) { copyPresetByKey(copyButton.dataset.copy); return; }
  const deleteButton = event.target.closest('[data-delete]');
  if (deleteButton) { deletePresetByKey(deleteButton.dataset.delete); return; }
  const presetButton = event.target.closest('[data-preset]');
  if (presetButton) { selectPreset(presetButton.dataset.preset); return; }
  const demo = event.target.closest('[data-demo]')?.dataset.demo;
  if (demo) showToast({ move: '原型：这里会调整键盘预设顺序', delete: '原型：删除前会显示影响范围确认' }[demo]);
});
$('libraryContent').addEventListener('keydown', event => {
  if (event.target.closest('[data-copy],[data-delete]')) return;
  const item = event.target.closest('[data-preset]');
  if (item && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); selectPreset(item.dataset.preset); }
});
$('connectButton').addEventListener('click', () => {
  state.connected = !state.connected;
  if (!state.connected) state.editorScene = 'disconnected';
  else if (state.editorScene === 'disconnected') state.editorScene = 'local';
  showToast(state.connected ? '原型：已模拟连接并读取键盘' : '原型：已模拟断开，本地编辑仍可继续');
  renderHeader();
  renderEditor();
  updatePreviewScenes();
});
$('dismissUpdate').addEventListener('click', () => { state.updateVisible = false; renderHeader(); });
$('helpButton').addEventListener('click', () => openDialog('helpDialog'));
$('presetTitle').addEventListener('click', beginRename);
$('presetTitle').addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); beginRename(); } });
$('presetNameInput').addEventListener('input', () => {
  $('renameError').hidden = true;
  $('presetNameInput').setAttribute('aria-invalid', 'false');
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
$('accentInput').addEventListener('input', event => setAccent(event.target.value));
$('colorPopover').addEventListener('click', event => {
  const button = event.target.closest('[data-color]');
  if (button) setAccent(button.dataset.color);
});
$('platformPopover').addEventListener('click', event => {
  const button = event.target.closest('[data-platform]');
  if (!button) return;
  const preset = ensureEditable();
  if (!preset) return;
  preset.platform = button.dataset.platform;
  preset.dirty = true;
  state.writeVerified = false;
  renderEditor();
});
document.addEventListener('click', event => { if (!event.target.closest('.popover-anchor')) closePopovers(); });
$('newPresetButton').addEventListener('click', () => showToast('原型：这里会新建一套空白预设'));
function copyPresetByKey(key) {
  const preset = allPresets().find(item => item.key === key);
  if (!preset) return;
  if (preset.source !== 'local') {
    const existing = existingSourceCopy(preset);
    if (existing) {
      state.libraryTab = 'library';
      selectPreset(existing.key);
      showToast('已打开之前复制的预设，没有创建重复副本');
      return;
    }
  }
  const copy = entry(`my-copy-${Date.now()}`, 'local', P.clonePreset(preset), { dirty: true, installed: false, installedId: null });
  copy.name = `${preset.name} 副本`;
  copy.originSourceKey = preset.source === 'local' ? null : preset.key;
  delete copy.originDeviceKey;
  users.push(copy);
  state.libraryTab = 'library';
  selectPreset(copy.key);
  showToast('已复制到我的预设，来源内容未改变');
}
let pendingDeleteKey = null;
function deletePresetByKey(key) {
  const preset = users.find(item => item.key === key);
  if (!preset) return;
  pendingDeleteKey = key;
  $('deleteDescription').textContent = `确定删除“${preset.name}”吗？`;
  openDialog('deleteDialog');
}
$('confirmDelete').addEventListener('click', () => {
  const index = users.findIndex(item => item.key === pendingDeleteKey);
  if (index < 0) return;
  users.splice(index, 1);
  if (state.selectedKey === pendingDeleteKey) selectPreset((users[0] || templates[0]).key);
  else renderLibrary();
  pendingDeleteKey = null;
  closeDialog('deleteDialog');
  showToast('原型：已模拟删除我的预设，键盘内容未改变');
});
let pendingKeyboardDeleteKey = null;
function openKeyboardDelete(preset) {
  pendingKeyboardDeleteKey = preset.key;
  $('deleteKeyboardDescription').textContent = `确定从键盘删除“${preset.name}”吗？`;
  $('deleteKeyboardWarning').textContent = preset.active ? '这是使用中的预设，删除后将切换到列表第一套。' : '键盘中的这套预设将被移除。';
  openDialog('deleteKeyboardDialog');
}
$('confirmDeleteKeyboard').addEventListener('click', () => {
  const index = devices.findIndex(item => item.key === pendingKeyboardDeleteKey);
  if (index < 0 || devices.length <= 1) return;
  const wasActive = devices[index].active;
  devices.splice(index, 1);
  devices.forEach(item => { item.active = false; });
  if (wasActive) devices[0].active = true;
  state.selectedKey = devices[0].key;
  pendingKeyboardDeleteKey = null;
  closeDialog('deleteKeyboardDialog');
  renderEditor();
  showToast('原型：已从键盘删除，我的预设未改变');
});
$('importButton').addEventListener('click', () => showToast('原型：导入只进入本地库，不会写入键盘'));
$('exportButton').addEventListener('click', () => showToast('原型：这里会导出当前预设为 .navio.json 文件'));
$('installAsNew').addEventListener('change', event => {
  const preset = currentPreset(), linked = linkedDevice(preset);
  if (!linked) return;
  $('writeDialogTitle').textContent = event.target.checked ? '作为新预设安装' : '更新键盘中的此预设';
  $('writeDialogDescription').textContent = event.target.checked
    ? `将把“${preset.name}”作为新预设安装，键盘中的“${linked.name}”保持不变。`
    : `将用“${preset.name}”更新上次安装的目标“${linked.name}”。不会创建重复预设。`;
  $('confirmWrite').textContent = event.target.checked ? '确认安装' : '确认更新';
});
$('editPreset').addEventListener('click', beginEdit);
$('discardEdit').addEventListener('click', () => requestLeave(null));
$('discardChanges').addEventListener('click', discardAndContinue);
$('saveChanges').addEventListener('click', saveAndContinue);
$('writePreset').addEventListener('click', openWriteDialog);
$('confirmWrite').addEventListener('click', () => {
  if (state.editWorking) { saveCurrent(); return; }
  const preset = currentPreset();
  const asNew = !$('installAsNewField').hidden && $('installAsNew').checked;
  let linked = asNew ? null : linkedDevice(preset);
  if (!linked && devices.length >= 6) linked = devices.find(item => item.key === $('replacementTarget').value) || null;
  if (!linked && devices.length < 6) {
    linked = entry(`device-installed-${Date.now()}`, 'device', P.clonePreset(preset), {});
    linked.id = Math.max(...devices.map(item => item.id)) + 1;
    devices.push(linked);
  }
  if (!linked) return;
  linked.name = preset.name;
  linked.platform = preset.platform;
  linked.accent = [...preset.accent];
  linked.rgbMode = preset.rgbMode;
  linked.actions = P.clonePreset(preset).actions;
  preset.installedId = linked.id;
  preset.dirty = false;
  preset.installed = true;
  state.writeVerified = true;
  closeDialog('writeDialog');
  renderEditor();
  showToast(asNew ? '原型：已作为新预设安装，原键盘项目保留' : '原型：已模拟保存当前预设并完成重读验证');
});
$('inspector').addEventListener('click', event => {
  const copyButton = event.target.closest('[data-action="copy-current"]');
  if (copyButton) copyPresetByKey(currentPreset().key);
});
$('inspector').addEventListener('change', event => {
  if (event.target.name === 'rgbMode') {
    const preset = ensureEditable();
    if (!preset) return;
    preset.rgbMode = Number(event.target.value);
    preset.dirty = true;
    state.writeVerified = false;
    renderEditor();
    return;
  }
  const card = event.target.closest('[data-slot]');
  if (!card) return;
  const preset = ensureEditable();
  if (!preset) return;
  const slot = Number(card.dataset.slot);
  const action = { ...preset.actions[slot] };
  if (event.target.dataset.actionField === 'kind') preset.actions[slot] = P.actionForKind(Number(event.target.value), action);
  else if (event.target.dataset.actionField === 'code') preset.actions[slot] = { ...action, code: Number(event.target.value) };
  else if (event.target.dataset.actionBit) {
    const bit = Number(event.target.dataset.actionBit);
    preset.actions[slot] = { ...action, mods: event.target.checked ? action.mods | bit : action.mods & ~bit };
  }
  preset.dirty = true;
  state.writeVerified = false;
  renderEditor();
});
$('inspector').addEventListener('input', event => {
  if (event.target.dataset.actionField !== 'wheelDy') return;
  const card = event.target.closest('[data-slot]');
  const preset = ensureEditable();
  if (!preset) return;
  preset.actions[Number(card.dataset.slot)].wheelDy = Number(event.target.value);
  preset.dirty = true;
  state.writeVerified = false;
  renderDeviceCanvas();
  renderActionbar();
});
$('firmwareCard').addEventListener('click', event => {
  const action = event.target.closest('[data-fw-action]')?.dataset.fwAction;
  if (!action) return;
  if (action === 'configure') { setPage('editor'); return; }
  if (action === 'cancel' || action === 'restart' || action === 'retry') { setFirmwareState('ready'); return; }
  if (action === 'rescue') { setFirmwareState('rescue'); return; }
  if (action === 'confirm') { beginSimulatedUpdate(); return; }
  if (action === 'start' || action === 'rescue-continue') {
    setFirmwareState('checking');
    firmwareTimer = setTimeout(() => setFirmwareState('confirm'), 750);
  }
});
$('previewPage').addEventListener('change', event => requestLeave(() => setPage(event.target.value)));
window.addEventListener('beforeunload', event => {
  if (!state.editWorking?.dirty) return;
  event.preventDefault();
  event.returnValue = '';
});
$('previewScene').addEventListener('change', event => {
  if (state.page === 'editor') applyEditorScene(event.target.value);
  else setFirmwareState(event.target.value);
});
$('hidePreview').addEventListener('click', () => { $('previewDock').hidden = true; $('showPreview').hidden = false; });
$('showPreview').addEventListener('click', () => { $('previewDock').hidden = false; $('showPreview').hidden = true; });

if (state.page === 'firmware' && firmwareScenes.some(([value]) => value === query.get('state'))) state.firmwareState = query.get('state');
if (state.page === 'editor' && editorScenes.some(([value]) => value === query.get('state'))) applyEditorScene(query.get('state'));
if (query.get('controls') === '0') { $('previewDock').hidden = true; $('showPreview').hidden = true; }
setPage(state.page);
