// Day length from latitude and date (derived:daylight-from-latitude, data/SOURCES.md).
// Solar declination: Spencer 1971 Fourier series, the one NOAA's General Solar Position
// Calculations use; day length: twice the hour angle at the standard sunrise/sunset zenith of
// 90.833 deg (NOAA: atmospheric refraction plus the solar disc's radius).
const DEG = Math.PI / 180;
const MONTH_START = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];

/** Day of year (1..365) of sim day `day` (1 = the 1st of startMonth), no leap years. */
export function dayOfYear(startMonth: number, day: number): number {
  const m = (((startMonth - 1) % 12) + 12) % 12;
  return ((MONTH_START[m] + Math.max(1, day) - 1) % 365) + 1;
}

/** Solar declination in radians (Spencer 1971). */
export function declination(doy: number): number {
  const g = (2 * Math.PI * (doy - 1)) / 365;
  return 0.006918 - 0.399912 * Math.cos(g) + 0.070257 * Math.sin(g) - 0.006758 * Math.cos(2 * g)
    + 0.000907 * Math.sin(2 * g) - 0.002697 * Math.cos(3 * g) + 0.00148 * Math.sin(3 * g);
}

/** Hours from sunrise to sunset at latitude latDeg on day of year doy (0 in polar night, 24 in polar day). */
export function daylightHours(latDeg: number, doy: number): number {
  const phi = latDeg * DEG, d = declination(doy);
  const c = (Math.cos(90.833 * DEG) - Math.sin(phi) * Math.sin(d)) / (Math.cos(phi) * Math.cos(d));
  if (c >= 1) return 0;
  if (c <= -1) return 24;
  return (2 * Math.acos(c)) / DEG / 15;
}
