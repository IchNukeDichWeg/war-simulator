// Pulls the World Bank indicators used for modern snapshots into
// data/raw/worldbank.json (most recent non-empty value per country, with year).
// World Bank Open Data, CC BY 4.0. Usage: tsx data-pipeline/fetch-worldbank.ts
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, Progress, cachedFetch } from './lib/util';

export const INDICATORS: Record<string, string> = {
  population: 'SP.POP.TOTL',
  urbanPct: 'SP.URB.TOTL.IN.ZS',
  gdpPpp2021: 'NY.GDP.MKTP.PP.KD',          // constant 2021 international $
  armedForces: 'MS.MIL.TOTL.P1',            // IISS via World Bank
  milexUsd: 'MS.MIL.XPND.CD',               // SIPRI via World Bank
  milexPctGdp: 'MS.MIL.XPND.GD.ZS',
  industryPct: 'NV.IND.TOTL.ZS',
  railKm: 'IS.RRS.TOTL.KM',
  roadKm: 'IS.ROD.TOTL.KM',
  landKm2: 'AG.LND.TOTL.K2',
  male1519Pct: 'SP.POP.1519.MA.5Y',
  female1519Pct: 'SP.POP.1519.FE.5Y',
  malePop: 'SP.POP.TOTL.MA.IN',
  femalePop: 'SP.POP.TOTL.FE.IN',
  cerealYield: 'AG.YLD.CREL.KG',
  arablePct: 'AG.LND.ARBL.ZS',
};

export interface WbCountry {
  iso3: string;
  name: string;
  region: string;
  income: string;
  capital: string;
  lat: number;
  lon: number;
  values: Record<string, { value: number; year: number }>;
}

async function main() {
  const countries: Record<string, WbCountry> = {};
  const list = JSON.parse((await cachedFetch('https://api.worldbank.org/v2/country?format=json&per_page=400')).toString())[1];
  for (const c of list) {
    if (c.region.value === 'Aggregates') continue;
    countries[c.id] = {
      iso3: c.id, name: c.name, region: c.region.value, income: c.incomeLevel.value,
      capital: c.capitalCity, lat: Number(c.latitude), lon: Number(c.longitude), values: {},
    };
  }
  const prog = new Progress('indicators', Object.keys(INDICATORS).length);
  for (const [key, code] of Object.entries(INDICATORS)) {
    const url = `https://api.worldbank.org/v2/country/all/indicator/${code}?format=json&mrnev=1&per_page=500`;
    const rows = JSON.parse((await cachedFetch(url)).toString())[1] ?? [];
    for (const r of rows) {
      const c = countries[r.countryiso3code];
      if (c && r.value !== null) c.values[key] = { value: r.value, year: Number(r.date) };
    }
    prog.tick();
  }
  const out = Object.values(countries).sort((a, b) => a.iso3.localeCompare(b.iso3));
  writeFileSync(join(ROOT, 'data', 'raw', 'worldbank.json'), JSON.stringify({
    source: 'World Bank Open Data API (CC BY 4.0), most recent non-empty value per indicator',
    indicators: INDICATORS,
    countries: out,
  }, null, 1));
  console.log(`wrote ${out.length} countries`);
}

if (process.argv[1]?.endsWith('fetch-worldbank.ts')) main().catch((e) => { console.error(e); process.exit(1); });
