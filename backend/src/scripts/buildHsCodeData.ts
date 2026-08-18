/**
 * Regenerates the compact HS code file the shipment forms search, from the
 * published Harmonized System CSV.
 *
 * The source carries the full hierarchy- sections, chapters, parent links and
 * a grand-total row- none of which a person typing "cotton shirt" needs. This
 * reduces it to the headings (4 digit) and subheadings (6 digit) that may
 * actually be declared, as `[code, description]` pairs.
 *
 * Output (committed, ~450 KB):
 *   data/reference/hs-codes.json   [["010121","Horses; live, pure-bred..."], ...]
 *
 * DELIBERATELY MANUAL, matching build:reference-data. The output is committed
 * and the CSV is not, so the app boots without it. Run this only after
 * replacing the source, then commit what changes:
 *
 *   npm run build:hs-codes
 *
 * Place the CSV at portal/harmonized-system.csv (or one directory above) first.
 */
import fs from "node:fs";
import path from "node:path";

const candidateSources = [
  path.resolve(process.cwd(), "..", "harmonized-system.csv"),
  path.resolve(process.cwd(), "..", "..", "harmonized-system.csv")
];
const outputRoot = path.resolve(process.cwd(), "data", "reference");
const outputPath = path.join(outputRoot, "hs-codes.json");

/**
 * Splits one CSV line, honouring the quoted fields the descriptions use
 * ("Horses, asses, mules and hinnies; live") and the "" escape inside them.
 */
function splitCsvLine(line: string) {
  const cells: string[] = [];
  let cell = "";
  let quoted = false;

  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];

    if (quoted && character === '"' && line[index + 1] === '"') {
      cell += '"';
      index += 1;
    } else if (character === '"') {
      quoted = !quoted;
    } else if (character === "," && !quoted) {
      cells.push(cell);
      cell = "";
    } else {
      cell += character;
    }
  }

  cells.push(cell);
  return cells.map((value) => value.trim());
}

function main() {
  const sourcePath = candidateSources.find((candidate) => fs.existsSync(candidate));

  if (!sourcePath) {
    // Only this script needs the CSV. If you are seeing this, you are trying to
    // regenerate without it- data/reference/hs-codes.json is committed and is
    // what the app actually reads.
    throw new Error(
      `Harmonized System CSV not found at ${candidateSources.join(" or ")}.\n`
      + "It is git-ignored on purpose. Copy it there to regenerate;\n"
      + "the app itself does not need it- data/reference/hs-codes.json is committed."
    );
  }

  const lines = fs.readFileSync(sourcePath, "utf8").split(/\r?\n/);
  const header = splitCsvLine(lines[0] ?? "");
  const columnOf = (name: string) => header.indexOf(name);
  const codeColumn = columnOf("hscode");
  const descriptionColumn = columnOf("description");
  const levelColumn = columnOf("level");

  if (codeColumn < 0 || descriptionColumn < 0 || levelColumn < 0) {
    throw new Error('The CSV must have "hscode", "description" and "level" columns.');
  }

  const entries: Array<[string, string]> = [];
  const seen = new Set<string>();

  for (const line of lines.slice(1)) {
    if (!line.trim()) continue;

    const cells = splitCsvLine(line);
    const code = (cells[codeColumn] ?? "").replace(/\D/g, "");
    const description = cells[descriptionColumn] ?? "";
    const level = Number(cells[levelColumn]);

    // Chapters (level 2) are too broad to declare against, and the TOTAL row is
    // bookkeeping. Headings and subheadings are what customs actually accepts.
    if (level < 4 || !code || !description || seen.has(code)) continue;

    seen.add(code);
    entries.push([code, description]);
  }

  entries.sort((left, right) => left[0].localeCompare(right[0]));

  fs.mkdirSync(outputRoot, { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify(entries));

  const sizeKb = (fs.statSync(outputPath).size / 1024).toFixed(0);
  console.log(`Wrote hs-codes.json: ${entries.length} codes (${sizeKb} KB) from ${sourcePath}`);
}

main();
