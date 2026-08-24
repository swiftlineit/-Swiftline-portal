import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { resolveImportedCountryNames } from "@/lib/rateCardImportMatch";

/** The country names exactly as SWIFTLINE ERUOPE RATELIST.xlsx spells them. */
const europeZones = [
  ["BELGIUM", "FRANCE", "GERMANY", "LUXEMBOURG", "NETHERLANDS"],
  ["AUSTRIA", "CZECH REPUBLIC", "DENMARK", "POLAND", "SWITZERLAND"],
  ["HUNGARY", "LITHUANIA", "SLOVAKIA", "SLOVANIA"],
  ["ESTONIA", "ITALY", "LATVIA", "SPAIN", "SWEDEN"],
  ["BOSNIA", "CROATIA", "FINALND", "LIECHENSTEIN", "NORWAY", "PORTUGAL", "SERBIA & MONTENEGRO"],
  ["IRELAND", "ROMANIA", "BULGARIA", "GREECE"]
];

function resolveZone(names: string[]) {
  return resolveImportedCountryNames(names).flatMap((match) =>
    match.parts.map((part) => ({
      raw: part.raw,
      code: part.country?.iso2.toUpperCase() ?? null,
      confidence: part.confidence
    }))
  );
}

function codeFor(names: string[], raw: string) {
  return resolveZone(names).find((entry) => entry.raw === raw)?.code ?? null;
}

describe("matching the country names in a rate list", () => {
  test("matches every name in the Europe rate list", () => {
    const resolved = europeZones.flatMap(resolveZone);

    assert.equal(resolved.length, 31, "Serbia & Montenegro should split into two destinations");
    assert.deepEqual(resolved.filter((entry) => !entry.code), []);
    assert.equal(new Set(resolved.map((entry) => entry.code)).size, 31, "no two names may claim one country");
  });

  test("splits a cell that names two countries", () => {
    const zone = europeZones[4]!;
    assert.equal(codeFor(zone, "SERBIA"), "RS");
    assert.equal(codeFor(zone, "MONTENEGRO"), "ME");
  });

  test("keeps a country whose own name contains \"and\" intact", () => {
    const resolved = resolveZone(["BOSNIA AND HERZEGOVINA", "TRINIDAD AND TOBAGO"]);

    assert.equal(resolved.length, 2, "neither name should have been torn in half");
    assert.equal(resolved[0]?.code, "BA");
    assert.equal(resolved[1]?.code, "TT");
  });

  test("corrects a misspelling when one country is clearly closest", () => {
    const zone = europeZones[4]!;
    assert.equal(codeFor(zone, "FINALND"), "FI");
    assert.equal(codeFor(zone, "LIECHENSTEIN"), "LI");
  });

  test("reads SLOVANIA as Slovenia because SLOVAKIA is spelled correctly beside it", () => {
    // One edit from both Slovakia and Slovenia. The zone settles it: Slovakia
    // has already claimed SK, so only Slovenia is left.
    assert.equal(codeFor(europeZones[2]!, "SLOVANIA"), "SI");
    assert.equal(codeFor(europeZones[2]!, "SLOVAKIA"), "SK");
  });

  test("asks rather than guesses when SLOVANIA stands alone", () => {
    const [entry] = resolveZone(["SLOVANIA"]);

    assert.equal(entry?.code, null, "a coin toss between Slovakia and Slovenia must be surfaced");
  });

  test("flags a corrected spelling rather than matching it silently", () => {
    assert.equal(codeFor(europeZones[4]!, "FINALND"), "FI");
    assert.equal(resolveZone(europeZones[4]!).find((e) => e.raw === "FINALND")?.confidence, "fuzzy");
    assert.equal(resolveZone(europeZones[4]!).find((e) => e.raw === "CROATIA")?.confidence, "exact");
  });

  test("expands a short name to the one country it can mean", () => {
    assert.equal(codeFor(["BOSNIA"], "BOSNIA"), "BA");
  });

  test("leaves a name it cannot place for the operator to pick", () => {
    const [entry] = resolveZone(["ZZZ FAR SIDE OF THE MOON"]);
    assert.equal(entry?.code, null);
  });
});
