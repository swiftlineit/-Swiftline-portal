// Copies the country flag SVGs into `public/flags` so the portal serves them
// from its own origin.
//
// Flags are served rather than bundled: importing 265 SVGs into the client
// bundle to look one up by code would defeat tree shaking, and pulling them
// from a CDN puts every country name in the portal behind a third party that a
// customer network can block. Static files under `public/` cost nothing until
// they are asked for.
//
// The output is committed. Re-run `npm run sync:flags` after upgrading
// `country-flag-icons`.
//
// Source: country-flag-icons (MIT). The flag artwork itself is public domain.

import { copyFile, mkdir, readdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const source = path.resolve(here, "..", "node_modules", "country-flag-icons", "3x2");
const destination = path.resolve(here, "..", "public", "flags");

const files = await readdir(source).catch(() => {
  throw new Error(
    `Could not read ${source}. Run \`npm install\` first- country-flag-icons is a devDependency.`
  );
});

const svgs = files.filter((file) => file.toLowerCase().endsWith(".svg"));
if (!svgs.length) throw new Error(`No SVG files found in ${source}.`);

// Cleared rather than merged, so a flag dropped upstream does not linger here
// as a file nothing references.
await rm(destination, { recursive: true, force: true });
await mkdir(destination, { recursive: true });

await Promise.all(
  svgs.map((file) => copyFile(
    path.join(source, file),
    // Lowercase, matching the ISO-2 casing the country catalogue uses, so the
    // component never has to guess at the case of a filename.
    path.join(destination, file.toLowerCase())
  ))
);

console.log(`Copied ${svgs.length} flags to public/flags`);
