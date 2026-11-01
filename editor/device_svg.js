const BUTTONS = [
  { x: 963, y: 200, w: 104, h: 106 }, { x: 1068, y: 200, w: 152, h: 106 }, { x: 1222, y: 200, w: 105, h: 106 },
  { x: 1330, y: 336, w: 98, h: 104 }, { x: 1428, y: 390, w: 105, h: 105 },
  { x: 1428, y: 573, w: 105, h: 160 }, { x: 1324, y: 546, w: 105, h: 216 },
  { x: 1088, y: 545, w: 108, h: 110 }, { x: 952, y: 446, w: 106, h: 107 },
  { x: 1094, y: 655, w: 102, h: 103 }, { x: 987, y: 655, w: 106, h: 103 }, { x: 1198, y: 655, w: 103, h: 103 },
];
const ENCODERS = [
  { id: 'Center', name: '中央旋钮', x: 1148, y: 424, r: 88 },
  { id: 'Large', name: '大旋钮', x: 859, y: 659, r: 110 },
  { id: 'Wheel', name: '滚轮', x: 862, y: 347, r: 60 },
];
const escapeHtml = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));

function buttonDef(index, action, selected, dirty) {
  const { x, y, w, h } = BUTTONS[index];
  const locked = index === 15;
  const label = locked ? 'SideKey' : `K${index + 1}`;
  const classes = ['slot', selected ? 'selected' : '', dirty ? 'dirty' : '', locked ? 'locked' : ''].filter(Boolean).join(' ');
  return `<g class="${classes}" data-input="btn" data-index="${index}" tabindex="0" role="button" aria-label="${label}" title="${label} · ${escapeHtml(action)}">
    <rect class="slot-hit" x="${x}" y="${y}" width="${w}" height="${h}" rx="14"/>
    <text class="slot-name" x="${x + w / 2}" y="${y + 25}" text-anchor="middle">${label}${locked ? ' · 锁定' : ''}</text>
    <text class="slot-action" x="${x + w / 2}" y="${y + 49}" text-anchor="middle">${action === '未设置' ? '＋' : escapeHtml(action)}</text>
    ${dirty ? `<circle class="dirty-dot" cx="${x + w - 12}" cy="${y + 12}" r="5"/>` : ''}
  </g>`;
}
function encoderDef(encoder, action, selected, dirtySlots, press, cw, ccw) {
  const { id, name, x, y, r } = encoder;
  const classes = ['slot', 'encoder', selected ? 'selected' : ''].filter(Boolean).join(' ');
  const dirty = dirtySlots.size > 0;
  const hit = id === 'Wheel'
    ? `<rect class="slot-hit" x="${x - r * 0.55}" y="${y - r * 1.12}" width="${r * 1.1}" height="${r * 2.24}" rx="14"/>`
    : `<circle class="slot-hit" cx="${x}" cy="${y}" r="${r}"/>`;
  return `<g class="${classes}" data-input="encoder" data-id="${id}" tabindex="0" role="button" aria-label="${name}" title="${name}：顺时针 ${escapeHtml(cw)} / 逆时针 ${escapeHtml(ccw)} / 下压 ${escapeHtml(press)}">
    ${hit}
    <text class="slot-action" x="${x}" y="${y + 14}" text-anchor="middle">${press === '未设置' ? '＋' : escapeHtml(press)}</text>
    ${dirty ? `<circle class="dirty-dot" cx="${x + r - 12}" cy="${y - r + 12}" r="5"/>` : ''}
  </g>`;
}

export function renderDevice(container, { actions, actionLabel, selected, dirtySlots, onSelect }) {
  const buttonMarkup = actions.slice(0, 12).map((action, index) =>
    buttonDef(index, actionLabel(action), selected.type === 'btn' && selected.index === index,
      dirtySlots.has(index))).join('');
  const encoderMarkup = ENCODERS.map((encoder, index) => {
    const base = 16 + index * 2;
    const dirty = new Set([base, base + 1, 12 + index].filter(slot => dirtySlots.has(slot)));
    return encoderDef(encoder, actionLabel(actions[12 + index]),
      selected.type === 'encoder' && selected.id === encoder.id, dirty,
      actionLabel(actions[12 + index]), actionLabel(actions[base]), actionLabel(actions[base + 1]));
  }).join('');
  container.innerHTML = `<svg class="device-svg rendered" viewBox="650 40 1000 820" role="img" aria-label="Navio Chron 可编辑设备图">
    <defs>
      <linearGradient id="key" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#243e4d"/><stop offset="1" stop-color="#142a36"/>
      </linearGradient>
    </defs>
    <image class="device-render" href="assets/navio-chron-u1.png" x="0" y="0" width="2048" height="974"/>
    <g class="side-key slot locked" data-input="btn" data-index="15" tabindex="0" role="button" aria-label="SideKey 锁定">
      <rect class="slot-hit" x="704" y="310" width="40" height="80" rx="14"/>
      <text class="slot-name" x="724" y="350" text-anchor="middle" transform="rotate(-90 724 350)">SideKey · 锁定</text>
    </g>
    ${buttonMarkup}
    ${encoderMarkup}
  </svg>`;
  container.querySelectorAll('[data-input]').forEach(element => {
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
