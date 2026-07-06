// Money is stored as integer kobo internally (PRD §6.5). Convert to naira only at the edges.

export function nairaToKobo(naira: number): number {
  return Math.round(naira * 100);
}

export function koboToNaira(kobo: number): number {
  return kobo / 100;
}

/** Format kobo as a Naira string, e.g. 4500000 -> "₦45,000". */
export function formatNaira(kobo: number): string {
  const naira = koboToNaira(kobo);
  return '₦' + naira.toLocaleString('en-NG', { maximumFractionDigits: 2 });
}
