import { describe, expect, it } from "vitest";

import { territoryFor, repContextLine, ZONE_REP } from "@/lib/territories";

describe("territoryFor", () => {
  it("resolves clean single-zone states", () => {
    expect(territoryFor("SC")).toEqual({ zone: "Carolinas", rep: "Chad Fink" });
    expect(territoryFor("FL")).toEqual({ zone: "Southeast", rep: "Chandler French" });
    expect(territoryFor("NY")).toEqual({ zone: "Northeast", rep: "Jason Martin" });
    expect(territoryFor("TX")).toEqual({ zone: "Central", rep: "Clayton Wheeler" });
    expect(territoryFor("ON")).toEqual({ zone: "Midwest", rep: "Rick Pumphrey" });
  });

  it("splits Georgia by zip: metro Atlanta Southeast, Augusta side Carolinas", () => {
    expect(territoryFor("GA", "30301")?.zone).toBe("Southeast");
    expect(territoryFor("GA", "30901")?.zone).toBe("Carolinas");
    expect(territoryFor("GA")?.zone).toBe("Southeast"); // no zip → dominant
  });

  it("splits Virginia: NoVA Northeast, southwest VA Carolinas", () => {
    expect(territoryFor("VA", "22101")?.zone).toBe("Northeast");
    expect(territoryFor("VA", "24016")?.zone).toBe("Carolinas");
  });

  it("is case/whitespace tolerant and null-safe", () => {
    expect(territoryFor(" nc ")).toEqual({ zone: "Carolinas", rep: "Chad Fink" });
    expect(territoryFor(null)).toBeNull();
    expect(territoryFor("Bogota")).toBeNull(); // international → no zone rep
  });

  it("every mapped zone has a rep", () => {
    for (const rep of Object.values(ZONE_REP)) expect(rep).toBeTruthy();
  });

  it("renders the context line", () => {
    expect(repContextLine({ zone: "Carolinas", rep: "Chad Fink" })).toContain("Chad Fink (Carolinas territory)");
  });
});
