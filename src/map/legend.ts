// Collapsible map legend: what the unit symbols, their states and the map
// lines mean. Plain DOM with CSS swatches (src/styles/map.css) that mirror the
// unit shader's vocabulary; keep the two in step when the symbology changes.

const ITEMS: [string, string][] = [
  // [swatch class, label]
  ['lg-unit', 'Formation; size grows with personnel'],
  ['lg-unit lg-bar', 'Bar under it: strength left'],
  ['lg-unit lg-stack', 'Several formations on one spot'],
  ['lg-dot', 'Crowded view: formations as discs'],
  ['lg-unit lg-engaged', 'Engaged'],
  ['lg-unit lg-routing', 'Routing'],
  ['lg-unit lg-supply', 'Supply under a third'],
  ['lg-unit lg-garrison', 'Garrison'],
  ['lg-unit lg-siege', 'Besieging'],
  ['lg-battle', 'Battle; the pulse grows with its size'],
  ['lg-front', 'Front line between the two sides'],
  ['lg-supplyline', 'Supply line'],
  ['lg-theater', 'Theater of operations'],
];

const STORE_KEY = 'mews.map.legendOpen';

export class MapLegend {
  readonly el: HTMLDivElement;
  private sidesEl: HTMLDivElement;
  private open: boolean;
  private key = '';

  constructor(container: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'map-legend';
    let open = false;
    try { open = localStorage.getItem(STORE_KEY) === '1'; } catch { /* storage blocked: start closed */ }
    this.open = open;
    const btn = document.createElement('button');
    btn.className = 'map-legend-toggle';
    btn.type = 'button';
    btn.onclick = () => this.setOpen(!this.open);
    const body = document.createElement('div');
    body.className = 'map-legend-body';
    this.sidesEl = document.createElement('div');
    this.sidesEl.className = 'map-legend-sides';
    body.appendChild(this.sidesEl);
    for (const [cls, label] of ITEMS) {
      const row = document.createElement('div');
      row.className = 'map-legend-row';
      const sw = document.createElement('i');
      sw.className = cls;
      const t = document.createElement('span');
      t.textContent = label;
      row.append(sw, t);
      body.appendChild(row);
    }
    this.el.append(btn, body);
    container.appendChild(this.el);
    this.setOpen(open, false);
  }

  /** Side names and colours; the front-line swatch uses both colours. */
  setSides(sides: { name: string; color: string }[]) {
    const key = JSON.stringify(sides);
    if (key === this.key) return;
    this.key = key;
    this.el.style.setProperty('--lg-a', sides[0]?.color ?? '#c33');
    this.el.style.setProperty('--lg-b', sides[1]?.color ?? '#36c');
    this.sidesEl.innerHTML = '';
    for (const s of sides) {
      const row = document.createElement('div');
      row.className = 'map-legend-row';
      const sw = document.createElement('i');
      sw.className = 'lg-unit';
      sw.style.setProperty('--c', s.color);
      const t = document.createElement('span');
      t.textContent = s.name;
      row.append(sw, t);
      this.sidesEl.appendChild(row);
    }
  }

  private setOpen(open: boolean, persist = true) {
    this.open = open;
    this.el.classList.toggle('open', open);
    const btn = this.el.firstChild as HTMLButtonElement;
    btn.textContent = open ? 'Legend  x' : 'Legend';
    btn.setAttribute('aria-expanded', String(open));
    if (persist) { try { localStorage.setItem(STORE_KEY, open ? '1' : '0'); } catch { /* per-viewer convenience only */ } }
  }
}
