// Side names and the scenario title follow the nations picked. Swapping Spain for the Swiss used
// to leave side B called "Spain" and the title "Roman Empire (117) vs Spain (2026)". A name is
// only replaced when it still describes the old members (or is a default), so a name the user
// typed or a coalition name ("Hellenic League", "NATO (partial)") is kept.
import type { Scenario } from '../types/scenario';
import type { Nation, Snapshot } from '../types/schema';
import { yearLabel } from './data';

const DEFAULT_SIDE = ['Side A', 'Side B'];
const DEFAULT_TITLE = 'Custom scenario';
const ALLIES = ' and allies';

const norm = (s: string) => s.toLowerCase().replace(/\s*\([^)]*\)/g, '').replace(/-/g, ' ').trim();
const base = (name: string) => (name.endsWith(ALLIES) ? name.slice(0, -ALLIES.length) : name);
/** "Roman Empire (Trajan)" -> "Roman Empire": the reign in brackets belongs to the year picker. */
const shortName = (s: Snapshot) => s.name.replace(/\s*\([^)]*\)/g, '').trim() || s.name;

type Lookup = { snapById: Map<string, Snapshot>; nationById: Map<string, Nation> };

/** True when `name` names this snapshot's polity: "Spain" for Kingdom of Spain, "Germany" for
 *  the German Reich (via the nation id), "Swiss" for the Swiss Confederation. */
function names(name: string, id: string, d: Lookup): boolean {
  const n = norm(base(name));
  const s = d.snapById.get(id);
  if (n.length < 3 || !s) return false;
  const words = [norm(s.name), norm(s.nationId), norm(d.nationById.get(s.nationId)?.name ?? '')].filter(Boolean);
  return words.some((w) => w.includes(n) || n.includes(w));
}

function sideName(old: string, i: number, before: string[], after: string[], d: Lookup): string {
  const auto = old.trim() === '' || old === DEFAULT_SIDE[i] || before.some((m) => names(old, m, d));
  if (!auto) return old;
  const first = after.find((m) => d.snapById.has(m));
  if (!first) return DEFAULT_SIDE[i];
  const b = names(old, first, d) ? base(old) : shortName(d.snapById.get(first)!);
  return after.length > 1 ? b + ALLIES : b;
}

/** "(117)" after a side's name in the title, when the side has one member. */
const yearOf = (members: string[], d: Lookup) => {
  const s = members.length === 1 ? d.snapById.get(members[0]) : undefined;
  return s ? ` (${yearLabel(s.year)})` : '';
};
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The scenario after an edit, with side names and title brought in line with changed members.
 *  Returns `after` itself when no member changed, so typing a name is never overridden. */
export function followNames(before: Scenario, after: Scenario, d: Lookup): Scenario {
  const changed = [0, 1].map((i) => before.sides[i].members.join('|') !== after.sides[i].members.join('|'));
  if (!changed[0] && !changed[1]) return after;
  const sides = after.sides.map((s, i) => (changed[i] && s.name === before.sides[i].name
    ? { ...s, name: sideName(s.name, i, before.sides[i].members, s.members, d) } : s)) as Scenario['sides'];
  let name = after.name;
  if (name.trim() === '' || name === DEFAULT_TITLE) {
    if (sides.every((s) => s.members.length > 0)) name = sides.map((s) => s.name + yearOf(s.members, d)).join(' vs ');
  } else {
    // swap each changed side's name, and its "(year)" if the title carries one, in place
    for (const i of [0, 1]) {
      if (!changed[i]) continue;
      const old = before.sides[i].name;
      name = name.replace(new RegExp(`${esc(old)}( \\((\\d+( BCE)?)\\))?`), (_, yr) => sides[i].name + (yr ? yearOf(sides[i].members, d) || yr : ''));
    }
  }
  return name === after.name && sides.every((s, i) => s === after.sides[i]) ? after : { ...after, sides, name };
}
