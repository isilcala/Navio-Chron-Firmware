import { renderDevice } from './device_svg.js?v=20261101-1';
const P = NavioEditorPreset, L = NavioEditorLibrary, $ = id => document.getElementById(id);
const STORAGE_KEY = 'navio-editor-library-v1';
const key = (mods, code) => ({ kind: P.Kind.KeyChord, mods, code, wheelDy: 0 });
const consumer = code => ({ kind: P.Kind.Consumer, mods: 0, code, wheelDy: 0 });
const wheel = (mods, wheelDy) => ({ kind: P.Kind.Wheel, mods, code: 0, wheelDy });
const uuid = () => crypto.randomUUID ? crypto.randomUUID() : `local-${Date.now()}-${Math.random()}`;
let activeTab = 'mapping', selectedInput = { type: 'btn', index: 0 }, toastTimer;

function factoryLibrary() {
  const jianying = P.createEmptyPreset(1, 'JianYing');
  jianying.uuid = uuid(); jianying.accent = [0, 170, 170];
  jianying.actions[0] = key(0, 0x14); jianying.actions[1] = key(1, 0x05); jianying.actions[2] = key(0, 0x1A);
  jianying.actions[3] = key(1, 0x1D); jianying.actions[4] = key(3, 0x1D); jianying.actions[5] = key(0, 0x2C);
  jianying.actions[6] = key(0, 0x2A); jianying.actions[7] = key(0, 0x52); jianying.actions[8] = key(4, 0);
  jianying.actions[9] = key(0, 0x51); jianying.actions[10] = key(0, 0x50); jianying.actions[11] = key(0, 0x4F);
  jianying.actions[12] = key(0, 0x19); jianying.actions[13] = key(0, 0x2C); jianying.actions[14] = key(0, 0x27);
  jianying.actions[16] = key(0, 0x4F); jianying.actions[17] = key(0, 0x50);
  jianying.actions[18] = wheel(4, 1); jianying.actions[19] = wheel(4, -1);
  jianying.actions[20] = wheel(1, 1); jianying.actions[21] = wheel(1, -1);

  const resolve = P.createEmptyPreset(2, 'Resolve');
  resolve.uuid = uuid(); resolve.accent = [200, 90, 0];
  resolve.actions[0] = key(0, 0x0C); resolve.actions[1] = key(1, 0x31); resolve.actions[2] = key(0, 0x12);
  resolve.actions[3] = key(1, 0x1D); resolve.actions[4] = key(1, 0x1C); resolve.actions[5] = key(0, 0x2C);
  resolve.actions[6] = key(2, 0x2A); resolve.actions[7] = key(0, 0x52); resolve.actions[8] = key(0, 0x10);
  resolve.actions[9] = key(0, 0x50); resolve.actions[10] = key(0, 0x51); resolve.actions[11] = key(0, 0x4F);
  resolve.actions[12] = key(0, 0x43); resolve.actions[13] = key(0, 0x0E); resolve.actions[14] = key(0, 0x2C);
  resolve.actions[16] = key(0, 0x4F); resolve.actions[17] = key(0, 0x50);
  resolve.actions[18] = key(0, 0x0F); resolve.actions[19] = key(0, 0x0D);
  resolve.actions[20] = key(1, 0x2E); resolve.actions[21] = key(1, 0x2D);

  const test = P.createEmptyPreset(3, 'Test');
  test.uuid = uuid(); test.accent = [0, 0, 200];
  for (let index = 0; index < 12; ++index) test.actions[index] = key(0, index < 9 ? 0x1E + index : index === 9 ? 0x27 : 0x2D + index - 10);
  test.actions[12] = consumer(0xE2); test.actions[13] = key(0, 0x28); test.actions[14] = key(0, 0x29);
  test.actions[16] = consumer(0xE9); test.actions[17] = consumer(0xEA);
  test.actions[18] = key(0, 0x4F); test.actions[19] = key(0, 0x50);
  test.actions[20] = wheel(0, 1); test.actions[21] = wheel(0, -1);

  const f13 = P.createEmptyPreset(4, 'F13 Macro');
  f13.uuid = uuid(); f13.accent = [160, 0, 200];
  for (let index = 0; index < 12; ++index) f13.actions[index] = key(0, 0x68 + index);
  f13.actions[12] = consumer(0xCD); f13.actions[13] = key(0, 0x2C); f13.actions[14] = key(1, 0x1D);
  f13.actions[16] = consumer(0xE9); f13.actions[17] = consumer(0xEA);
  f13.actions[18] = key(1, 0x2E); f13.actions[19] = key(1, 0x2D);
  f13.actions[20] = wheel(0, 1); f13.actions[21] = wheel(0, -1);
  for (const preset of [jianying, resolve, test, f13]) {
    preset._readonly = true;
    preset.templateId = preset.name;
  }
  return [jianying, resolve, test, f13];
}
function loadUserPresets() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    const userPresets = L.migrateLegacy(saved).userPresets;
    L.syncTemplates(userPresets, factoryLibrary(), (preset, template) =>
      confirm(`官方模板“${template.name}”已更新，是否用新版替换你的预设“${preset.name}”？`));
    return userPresets;
  } catch (_) { return []; }
}
let templates = factoryLibrary(), userPresets = loadUserPresets(), selectedPresetId = templates[0].uuid;
function currentPreset() {
  return userPresets.find(preset => preset.uuid === selectedPresetId) ||
    templates.find(preset => preset.uuid === selectedPresetId) || templates[0];
}
function ensureUserCopy() {
  const preset = currentPreset();
  if (!preset._readonly) return preset;
  const copy = P.clonePreset(preset);
  copy.uuid = uuid(); copy._readonly = false; copy._dirty = true;
  copy.originTemplateId = preset.templateId; copy.originTemplateVersion = L.TEMPLATE_VERSION;
  userPresets.push(copy); selectedPresetId = copy.uuid;
  return copy;
}
function dirtySlots() { return new Set(currentPreset()._dirtySlots || []); }
function saveLibrary() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(L.packageLibrary(userPresets)));
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
}
function renderSaveState() {
  const count = userPresets.filter(preset => preset._dirty).length;
  $('saveState').textContent = count ? `${count} 套本地修改 · 不会写入设备` : '本地修改，不会写入设备';
}
function presetItem(preset) {
  return `<div class="preset-item ${preset.uuid === selectedPresetId ? 'active' : ''}" data-uuid="${preset.uuid}" tabindex="0" role="button">
    <i class="swatch" style="background:rgb(${preset.accent.join(',')})"></i><span class="preset-name"></span>${preset._dirty ? '<span class="dirty-mark">●</span>' : ''}
  </div>`;
}
function renderLibrary() {
  $('presetList').innerHTML = `<h3 class="library-section">官方模板</h3>${templates.map(presetItem).join('')}
    <h3 class="library-section">我的预设</h3>${userPresets.length ? userPresets.map(presetItem).join('') : '<p class="hint">修改官方模板会自动创建副本</p>'}`;
  $('presetList').querySelectorAll('.preset-item').forEach(element => {
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
function currentName(id) {
  return userPresets.find(preset => preset.uuid === id)?.name ||
    templates.find(preset => preset.uuid === id)?.name || '';
}
function renderTitle() { $('currentPresetTitle').textContent = currentPreset().name || '未命名预设'; }
function renderEncoderDetail() {
  const detail = $('encoderDetail');
  if (selectedInput.type !== 'encoder') { detail.hidden = true; return; }
  const encoder = P.ENCODERS.find(item => item.id === selectedInput.id), actions = currentPreset().actions;
  detail.innerHTML = `<div class="detail-heading">${encoder.name}</div>
    <div class="detail-item"><span>↻ 顺时针</span><strong>${P.actionLabel(actions[encoder.cwSlot])}</strong></div>
    <div class="detail-item"><span>↺ 逆时针</span><strong>${P.actionLabel(actions[encoder.ccwSlot])}</strong></div>
    <div class="detail-item"><span>⏹ 下压</span><strong>${P.actionLabel(actions[encoder.pressSlot])}</strong></div>`;
  detail.hidden = false;
}
function renderSvg() {
  renderDevice($('device'), { actions: currentPreset().actions, actionLabel: P.actionLabel,
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
  const mods = ['Ctrl', 'Shift', 'Alt', 'Win', 'RCtrl', 'RShift', 'RAlt', 'RWin'].map((label, bit) =>
    `<label class="mod"><input type="checkbox" data-bit="${1 << bit}" ${action.mods & (1 << bit) ? 'checked' : ''} ${action.kind === P.Kind.None || action.kind === P.Kind.Consumer ? 'disabled' : ''}>${label}</label>`).join('');
  const title = slot < 16 ? (slot === 15 ? 'SideKey' : `K${slot + 1}`) :
    slot < 18 ? '中央旋钮' : slot < 20 ? '大旋钮' : '滚轮';
  const direction = slot < 16 ? '' : slot % 2 === 0 ? ' · 顺时针' : ' · 逆时针';
  return `<div class="action-card" data-slot="${slot}"><h3><span>${title}${direction}</span> · ${P.actionLabel(action)}</h3>
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
  $('selectionTitle').textContent = activeTab === 'lighting' ? '灯光效果' :
    selectedInput.type === 'btn' && selectedInput.index === 15 ? '全局保留键' : '键位设置';
  if (activeTab === 'lighting') {
    $('inspector').innerHTML = `<div class="lighting-placeholder">主题色由上方设置<br><br>灯光模式、按键颜色和实时预览将在后续协议阶段开放。<br>此布局已为静态、呼吸、按下响应等效果预留。</div>`;
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
function renderAll() { renderTitle(); renderLibrary(); renderSvg(); renderInspector(); renderSaveState(); }

$('inspector').addEventListener('change', event => {
  const form = event.target.closest('.action-card');
  if (!form) return;
  const slot = Number(form.dataset.slot), preset = ensureUserCopy(), action = { ...preset.actions[slot] };
  if (event.target.dataset.field === 'kind') {
    action.kind = Number(event.target.value);
    if (action.kind === P.Kind.None) { action.mods = 0; action.code = 0; action.wheelDy = 0; }
    else if (action.kind === P.Kind.KeyChord && action.code > 0xE7) action.code = 0x04;
    else if (action.kind === P.Kind.Consumer) { action.mods = 0; action.code = 0xCD; action.wheelDy = 0; }
    else if (action.kind === P.Kind.Wheel) { action.code = 0; action.wheelDy = 1; }
    const issue = P.actionError(action, slot < 16);
    if (issue) { toast(issue, true); return; }
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
  form.querySelector('h3').innerHTML = `<span>${form.querySelector('h3 span').textContent}</span> · ${P.actionLabel(action)}`;
});
$('presetName').addEventListener('input', event => {
  const preset = ensureUserCopy();
  preset.name = event.target.value;
  preset._dirty = true;
  $('nameBytes').textContent = `${P.utf8Length(preset.name)}/23B`;
  $('nameBytes').style.color = P.nameError(preset.name) ? 'var(--danger)' : '';
  saveLibrary(); renderLibrary(); renderTitle(); renderSaveState();
});
$('presetAccent').addEventListener('input', event => {
  const hex = event.target.value, preset = ensureUserCopy();
  preset.accent = [1, 3, 5].map(offset => parseInt(hex.slice(offset, offset + 2), 16));
  markDirty(-1); renderLibrary();
});
document.querySelectorAll('.tab').forEach(tab => tab.addEventListener('click', () => { activeTab = tab.dataset.tab; renderInspector(); }));
function nextPresetId() {
  return Math.max(...templates.map(preset => preset.id), ...userPresets.map(preset => preset.id), 0) + 1;
}
$('newPreset').addEventListener('click', () => {
  const nextId = nextPresetId();
  if (nextId > 255) { toast('本地 presetId 已用完', true); return; }
  const preset = P.createEmptyPreset(nextId, `自定义预设 ${nextId}`);
  preset.uuid = uuid(); preset._dirty = true; preset.originTemplateId = null;
  userPresets.push(preset); selectedPresetId = preset.uuid; saveLibrary(); renderAll();
});
$('duplicatePreset').addEventListener('click', () => {
  const source = currentPreset(), preset = P.clonePreset(source), nextId = nextPresetId();
  if (nextId > 255) { toast('本地 presetId 已用完', true); return; }
  preset.id = nextId; preset.uuid = uuid(); preset.name = `${preset.name} 副本`; preset._dirty = true;
  preset._readonly = false; preset.originTemplateId = source.templateId || null;
  preset.originTemplateVersion = source.templateId ? L.TEMPLATE_VERSION : null;
  userPresets.push(preset); selectedPresetId = preset.uuid; saveLibrary(); renderAll();
});
$('resetLibrary').addEventListener('click', () => {
  if (!confirm('清空“我的预设”？官方模板会保留。')) return;
  userPresets = []; selectedPresetId = templates[0].uuid;
  selectedInput = { type: 'btn', index: 0 }; saveLibrary(); renderAll();
});
$('exportPreset').addEventListener('click', () => {
  const preset = currentPreset();
  const content = { schemaVersion: 1, product: 'navio-chron', record: 1,
    metadata: { author: 'local', platform: 'custom' }, preset };
  delete content.preset._dirty; delete content.preset._dirtySlots;
  const blob = new Blob([JSON.stringify(content, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob), link = document.createElement('a');
  link.href = url; link.download = `${preset.name || 'preset'}.navio.json`; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});
$('importPreset').addEventListener('change', async event => {
  const file = event.target.files[0];
  if (!file) return;
  try {
    const content = JSON.parse(await file.text());
    if (content.schemaVersion !== 1 || content.record !== 1 || !content.preset)
      throw new Error('不支持的 .navio.json 格式或 record 版本');
    const errors = P.presetErrors(content.preset);
    if (errors.length) throw new Error(errors[0]);
    const preset = content.preset;
    preset.uuid = uuid(); preset._dirty = true; preset.originTemplateId = null;
    userPresets.push(preset); selectedPresetId = preset.uuid; saveLibrary(); renderAll();
    toast('已导入本地库，未写入设备');
  } catch (error) { toast(error.message, true); }
  event.target.value = '';
});

renderAll();
