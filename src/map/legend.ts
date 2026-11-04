// Collapsible map key: what the side colours, the map lines and the unit
// symbols mean. Plain DOM with CSS swatches (src/styles/map.css) that mirror
// the unit shader's vocabulary; keep the two in step when the symbology changes.

type Row = [string, string]; // [swatch class, label]

// Lines and areas drawn by the war layers (Control, Front line, Supply lines) and the theater box.
const MAP_ITEMS: Row[] = [
  ['lg-area', 'Shaded land: held by that side'],
  ['lg-front', 'Front line: where the two sides meet'],
  ['lg-supplyline', 'Dotted line: supply route'],
  ['lg-battle', 'Battle; a bigger pulse means a bigger battle'],
  ['lg-theater', 'Dashed box: area the war is fought in'],
];
const UNIT_ITEMS: Row[] = [
  ['lg-unit', 'Army unit; bigger means more troops'],
  ['lg-unit lg-bar', 'Green bar: strength left'],
  ['lg-unit lg-stack', 'Number: several units in one place'],
  ['lg-dot', 'Dot: a unit, when the view is crowded'],
];
const STATE_ITEMS: Row[] = [
  ['lg-unit lg-engaged', 'Orange edge: in combat'],
  ['lg-unit lg-routing', 'Grey stripes: fleeing in disorder'],
  ['lg-unit lg-supply', 'Dashed edge: under a third of its supply'],
  ['lg-unit lg-garrison', 'Thick edge: garrison, defending in place'],
  ['lg-unit lg-siege', 'Purple edge: besieging a fortress or city'],
];

const STORE_KEY = 'mews.map.legendOpen';
let seq = 0;

function row(cls: string, label: string, color?: string) {
  const r = document.createElement('div');
  r.className = 'map-legend-row';
  const sw = document.createElement('i');
  sw.className = cls;
  sw.setAttribute('aria-hidden', 'true');
  if (color) sw.style.setProperty('--c', color);
  const t = document.createElement('span');
  t.textContent = label;
  r.append(sw, t);
  return r;
}

function section(title: string, rows: Row[]) {
  const s = document.createElement('div');
  s.className = 'map-legend-section';
  const h = document.createElement('div');
  h.className = 'map-legend-head';
  h.textContent = title;
  s.appendChild(h);
  for (const [cls, label] of rows) s.appendChild(row(cls, label));
  return s;
}

export class MapLegend {
  readonly el: HTMLDivElement;
  private btn: HTMLButtonElement;
  private sidesEl: HTMLDivElement;
  private open: boolean;
  private key = '';

  constructor(container: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'map-legend';
    let open = false;
    try { open = localStorage.getItem(STORE_KEY) === '1'; } catch { /* storage blocked: start closed */ }
    this.open = open;
    const id = `map-legend-body-${++seq}`;
    const btn = this.btn = document.createElement('button');
    btn.className = 'map-legend-toggle';
    btn.type = 'button';
    btn.setAttribute('aria-controls', id);
    btn.title = 'What the colours, lines and symbols on the map mean';
    btn.onclick = () => this.setOpen(!this.open);
    const body = document.createElement('div');
    body.className = 'map-legend-body';
    body.id = id;
    body.setAttribute('role', 'region');
    body.setAttribute('aria-label', 'Map key');
    const sides = document.createElement('div');
    sides.className = 'map-legend-section';
    const sh = document.createElement('div');
    sh.className = 'map-legend-head';
    sh.textContent = 'Sides';
    this.sidesEl = document.createElement('div');
    sides.append(sh, this.sidesEl);
    body.append(sides, section('On the map', MAP_ITEMS), section('Units', UNIT_ITEMS), section('Unit edges and fills', STATE_ITEMS));
    this.el.append(btn, body);
    // Escape folds the key away and leaves focus on its button
    this.el.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.open) { e.stopPropagation(); this.setOpen(false); this.btn.focus(); }
    });
    container.appendChild(this.el);
    this.setOpen(open, false);
  }

  /** Side names and colours; the front line and shaded land use both colours. */
  setSides(sides: { name: string; color: string }[]) {
    const key = JSON.stringify(sides);
    if (key === this.key) return;
    this.key = key;
    this.el.style.setProperty('--lg-a', sides[0]?.color ?? '#c33');
    this.el.style.setProperty('--lg-b', sides[1]?.color ?? '#36c');
    this.sidesEl.innerHTML = '';
    for (const s of sides) this.sidesEl.appendChild(row('lg-unit', s.name, s.color));
  }

  private setOpen(open: boolean, persist = true) {
    this.open = open;
    this.el.classList.toggle('open', open);
    this.btn.textContent = open ? 'Hide map key' : 'Map key';
    this.btn.setAttribute('aria-expanded', String(open));
    if (persist) { try { localStorage.setItem(STORE_KEY, open ? '1' : '0'); } catch { /* per-viewer convenience only */ } }
  }
}
