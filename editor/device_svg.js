const BUTTONS = [
  { x: 309, y: 130, w: 100, h: 88 }, { x: 429, y: 130, w: 142, h: 88 }, { x: 591, y: 130, w: 100, h: 88 },
  { x: 700, y: 275, w: 96, h: 88 }, { x: 820, y: 325, w: 96, h: 88 },
  { x: 820, y: 477, w: 96, h: 135 }, { x: 700, y: 460, w: 96, h: 169 },
  { x: 450, y: 460, w: 100, h: 88 }, { x: 305, y: 349, w: 100, h: 88 },
  { x: 330, y: 570, w: 100, h: 82 }, { x: 450, y: 570, w: 100, h: 82 }, { x: 570, y: 570, w: 100, h: 82 },
];
const ENCODERS = [
  { id: 'Center', name: '中央旋钮', x: 500, y: 339, r: 76 },
  { id: 'Large', name: '大旋钮', x: 192, y: 532, r: 82 },
  { id: 'Wheel', name: '滚轮', x: 192, y: 273, r: 64 },
];
export const escapeHtml = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));

function buttonDef(index, action, selected, ledColor) {
  const { x, y, w, h } = BUTTONS[index];
  const label = `K${index + 1}`;
  const classes = ['slot', 'key-slot', selected ? 'selected' : ''].filter(Boolean).join(' ');
  return `<g class="${classes}" data-input="btn" data-index="${index}" tabindex="0" role="button" aria-label="${label}：${escapeHtml(action)}">
    <title>${label} · ${escapeHtml(action)}</title>
    <rect class="slot-hit" x="${x}" y="${y}" width="${w}" height="${h}" rx="18"/>
    <text class="slot-name" x="${x + 16}" y="${y + 25}">${label}</text>
    <text class="slot-action ${action === '未设置' ? 'is-empty' : ''}" x="${x + w / 2}" y="${y + h / 2}" text-anchor="middle" dominant-baseline="central" data-max-width="${w - 18}">${escapeHtml(action)}</text>
    <circle class="key-led" cx="${x + w / 2}" cy="${y + h / 2 - 22}" r="7" fill="${ledColor}"/>
  </g>`;
}
function encoderDef(encoder, selected, press, cw, ccw) {
  const { id, name, x, y, r } = encoder;
  const classes = ['slot', 'encoder-slot', selected ? 'selected' : ''].filter(Boolean).join(' ');
  const hit = id === 'Wheel'
    ? `<rect class="slot-hit" x="${x - r * 0.55}" y="${y - r * 1.12}" width="${r * 1.1}" height="${r * 2.24}" rx="20"/>`
    : `<circle class="slot-hit" cx="${x}" cy="${y}" r="${r}"/><circle class="knob-ring" cx="${x}" cy="${y}" r="${r - 18}"/>`;
  const nameY = id === 'Wheel' ? y - r * 0.72 : y - r * 0.45;
  return `<g class="${classes}" data-input="encoder" data-id="${id}" tabindex="0" role="button" aria-label="${name}：逆时针 ${escapeHtml(ccw)}，顺时针 ${escapeHtml(cw)}，下压 ${escapeHtml(press)}">
    <title>${name}：逆时针 ${escapeHtml(ccw)} / 顺时针 ${escapeHtml(cw)} / 下压 ${escapeHtml(press)}</title>
    ${hit}
    <text class="slot-action ${press === '未设置' ? 'is-empty' : ''}" x="${x}" y="${y}" text-anchor="middle" dominant-baseline="central" data-max-width="${(id === 'Wheel' ? r * 1.1 : r * 2) - 18}">${escapeHtml(press)}</text>
    <text class="control-name" x="${x}" y="${nameY}" text-anchor="middle">${name}</text>
  </g>`;
}
function statusLed(x, title, color) {
  return `<g class="status-led" tabindex="0" role="img" aria-label="${title}"><title>${title}</title>
    <rect class="status-led-socket" x="${x - 16}" y="204" width="32" height="14" rx="7"/><rect class="status-led-light" x="${x - 7}" y="207.5" width="14" height="7" rx="3.5" fill="${color}"/>
  </g>`;
}

function fitActionLabels(container) {
  for (const text of container.querySelectorAll('.slot-action[data-max-width]')) {
    const maxWidth = Number(text.dataset.maxWidth);
    for (let fontSize = 16; fontSize > 11 && text.getComputedTextLength() > maxWidth; --fontSize)
      text.style.fontSize = `${fontSize - 1}px`;
    if (text.getComputedTextLength() > maxWidth) {
      text.setAttribute('textLength', String(maxWidth));
      text.setAttribute('lengthAdjust', 'spacingAndGlyphs');
    }
  }
}

export function renderDevice(container, { actions, actionLabel, selected, accent = [109, 93, 252], lighting = false, previewColors = null, onLightInput = null, onSelect }) {
  const ledColor = `rgb(${accent.join(',')})`;
  const buttonMarkup = actions.slice(0, 12).map((action, index) =>
    buttonDef(index, actionLabel(action), selected.type === 'btn' && selected.index === index,
      previewColors ? `rgb(${previewColors[index].join(',')})` : ledColor)).join('');
  const encoderMarkup = ENCODERS.map((encoder, index) => {
    const base = 16 + index * 2;
    return encoderDef(encoder, selected.type === 'encoder' && selected.id === encoder.id,
      actionLabel(actions[12 + index]), actionLabel(actions[base]), actionLabel(actions[base + 1]));
  }).join('');
  container.innerHTML = `<svg class="device-svg ${lighting ? 'lighting-mode' : ''}" viewBox="0 0 1000 740" role="group" aria-label="Navio Chron 可编辑键盘">
    <defs>
      <filter id="device-raised" x="-25%" y="-25%" width="160%" height="160%">
        <feDropShadow dx="8" dy="8" stdDeviation="10" flood-color="#aeb5bf"/>
        <feDropShadow dx="-8" dy="-8" stdDeviation="10" flood-color="#ffffff"/>
      </filter>
      <filter id="key-raised" x="-30%" y="-30%" width="170%" height="170%">
        <feDropShadow dx="5" dy="5" stdDeviation="5" flood-color="#aeb5bf"/>
        <feDropShadow dx="-5" dy="-5" stdDeviation="5" flood-color="#ffffff"/>
      </filter>
    </defs>
    <rect class="hardware-shell" x="55" y="45" width="890" height="650" rx="48"/>
    <text class="device-brand" x="105" y="86">navio chron</text>
    <g class="status-leds" aria-label="设备状态指示灯">
      ${statusLed(760, '电源指示灯：显示电量与低电提示', '#8995a3')}
      ${statusLed(795, '连接状态指示灯：显示 USB、蓝牙连接或配对状态', '#187c6b')}
      ${statusLed(830, '当前预设指示灯：显示当前预设的主题色', ledColor)}
    </g>
    <g class="side-key slot locked" data-input="btn" data-index="15" tabindex="0" role="button" aria-label="SideKey，全局保留">
      <rect class="slot-hit" x="38" y="245" width="42" height="88" rx="16"/>
      <text class="side-key-label" x="60" y="289" text-anchor="middle" transform="rotate(-90 60 289)">SideKey</text>
    </g>
    ${buttonMarkup}
    ${encoderMarkup}
  </svg>`;
  fitActionLabels(container);
  container.querySelectorAll('[data-input]').forEach(element => {
    if (onLightInput && element.dataset.input === 'btn' && Number(element.dataset.index) < 12) {
      const index = Number(element.dataset.index);
      element.addEventListener('pointerdown', event => {
        event.preventDefault();
        try { element.setPointerCapture(event.pointerId); } catch (_) {}
        onLightInput(index, true);
      });
      for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) {
        element.addEventListener(type, event => { event.preventDefault(); onLightInput(index, false); });
      }
      element.addEventListener('keydown', event => {
        if ((event.key === 'Enter' || event.key === ' ') && !event.repeat) { event.preventDefault(); onLightInput(index, true); }
      });
      element.addEventListener('keyup', event => {
        if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onLightInput(index, false); }
      });
      return;
    }
    const select = () => {
      if (element.dataset.input === 'btn') onSelect({ type: 'btn', index: Number(element.dataset.index) });
      else onSelect({ type: 'encoder', id: element.dataset.id });
    };
    element.addEventListener('click', select);
    element.addEventListener('keydown', event => {
      if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); select(); }
    });
  });
}
