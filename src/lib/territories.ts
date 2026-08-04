/**
 * Stingray territories & factory service reps.
 *
 * Mirrors DealersCircle's zone config (Dealer Configuration assigns the rep
 * per dealer; zones from 11,983 delivery records, 2013–2026 — see
 * stingray-reports/docs/territory-rep-rules.md). Geography resolves a
 * CUSTOMER's territory from their delivery address; an existing DEALER's
 * territory always comes from their DealersCircle records, never geography.
 * NOTE: the DealersCircle "Salesperson" field is dealer floor staff — never
 * use it for rep routing.
 */

export const ZONE_REP: Record<string, string> = {
  Northeast: "Jason Martin",
  Carolinas: "Chad Fink",
  Southeast: "Chandler French",
  Midwest: "Rick Pumphrey",
  Central: "Clayton Wheeler",
  "House Account": "Gail Kimbrell",
};

const STATE_ZONE: Record<string, string> = {
  NC: "Carolinas", SC: "Carolinas", WV: "Carolinas",
  AR: "Central", LA: "Central", OK: "Central", TX: "Central",
  IL: "Midwest", IN: "Midwest", IA: "Midwest", KS: "Midwest", KY: "Midwest",
  MI: "Midwest", NE: "Midwest", ND: "Midwest", SD: "Midwest", WI: "Midwest", ON: "Midwest",
  CT: "Northeast", DE: "Northeast", MA: "Northeast", ME: "Northeast", NH: "Northeast",
  NJ: "Northeast", NY: "Northeast", PA: "Northeast", RI: "Northeast", VT: "Northeast",
  NB: "Northeast", NS: "Northeast", PE: "Northeast", QC: "Northeast", NL: "Northeast",
  AL: "Southeast", FL: "Southeast", PR: "Southeast",
  // split states — dominant zone; zip3 table below refines
  GA: "Southeast", MS: "Southeast", VA: "Northeast", MD: "Northeast",
  TN: "Central", MN: "Central", MO: "Central", OH: "Midwest",
};

/** Split-state refinements: first-3 zip digits → zone (mined from delivery
 *  addresses; a zip3 not listed falls back to the state's dominant zone). */
const ZIP3_ZONE: Record<string, string> = {
  // GA — metro Atlanta is Southeast; Augusta/Savannah side is Carolinas
  "304": "Carolinas", "308": "Carolinas", "309": "Carolinas", "310": "Carolinas",
  "312": "Carolinas", "313": "Carolinas", "314": "Carolinas",
  // VA — southwest VA leans Carolinas
  "240": "Carolinas", "241": "Carolinas", "242": "Carolinas", "243": "Carolinas",
  "244": "Carolinas", "245": "Carolinas",
  // MD — far west
  "215": "Carolinas", "217": "Carolinas",
  // TN — Nashville/Chattanooga Southeast, Knoxville-east Central (state default),
  // Memphis west Carolinas (follows Memphis Boat Center's dealer assignment)
  "370": "Southeast", "371": "Southeast", "373": "Southeast", "374": "Southeast",
  "376": "Southeast", "382": "Southeast", "384": "Southeast", "385": "Southeast",
  "372": "Carolinas", "380": "Carolinas", "381": "Carolinas", "383": "Carolinas",
  // MN — Twin Cities Central (state default); northern lakes Midwest
  "558": "Midwest", "559": "Midwest", "560": "Midwest", "566": "Midwest",
  // MO — KC/Springfield Central (state default); St. Louis side Midwest
  "630": "Midwest", "631": "Midwest", "633": "Midwest",
  // MS — north/central MS follows Carolinas-managed accounts; gulf coast Southeast (state default)
  "386": "Carolinas", "391": "Carolinas", "392": "Carolinas", "396": "Carolinas",
};

export type Territory = { zone: string; rep: string };

/** Resolve a customer's territory from delivery-address state (+ zip for the
 *  eight split states). Returns null for unknown/international. */
export function territoryFor(state?: string | null, zip?: string | null): Territory | null {
  const st = state?.trim().toUpperCase();
  if (!st || !(st in STATE_ZONE)) return null;
  let zone = STATE_ZONE[st];
  const zip3 = zip?.trim().match(/^(\d{3})/)?.[1];
  if (zip3 && ZIP3_ZONE[zip3]) zone = ZIP3_ZONE[zip3];
  const rep = ZONE_REP[zone];
  return rep ? { zone, rep } : null;
}

export function repContextLine(t: Territory): string {
  return `Regional factory service rep for this customer's area: ${t.rep} (${t.zone} territory)`;
}
