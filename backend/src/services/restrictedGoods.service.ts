// Goods that may never be shipped. The check runs at data entry (parcel contents
// description) so a restricted item is rejected before it can be booked, which is
// also why the EDI export can print the description verbatim: nothing on this list
// ever reaches the database. The same list backs the frontend toast, so keep this
// file and the frontend copy in step.

export type RestrictedCategory = {
  label: string;
  // Lower-case keywords/phrases. Each is matched on word boundaries, so "cash"
  // does not fire on "cashew" and "gold" does not fire on "marigold".
  keywords: string[];
};

export const restrictedCategories: RestrictedCategory[] = [
  { label: "Alcohol / Liquor", keywords: ["alcohol", "liquor", "wine", "beer", "whisky", "whiskey", "vodka", "rum", "brandy", "champagne", "spirits"] },
  { label: "Tobacco / Nicotine / Vape", keywords: ["tobacco", "cigarette", "cigar", "nicotine", "vape", "smoking", "e-cigarette", "hookah", "shisha", "bidi"] },
  { label: "Cash / Currency", keywords: ["cash", "currency", "banknote", "bank note"] },
  { label: "Gold / Silver / Precious Metals", keywords: ["gold", "silver", "platinum", "precious metal", "bullion"] },
  { label: "Gems / Diamonds", keywords: ["gem", "gems", "gemstone", "diamond", "ruby", "sapphire", "emerald"] },
  { label: "Arms / Ammunition / Weapons", keywords: ["arms", "ammunition", "ammo", "weapon", "gun", "firearm", "pistol", "rifle", "bullet", "knife", "bomb"] },
  { label: "Explosives / Fireworks", keywords: ["explosive", "firework", "firecracker", "dynamite", "detonator"] },
  { label: "Flammable Items", keywords: ["flammable", "inflammable", "petrol", "gasoline", "diesel", "kerosene", "lighter fluid", "gas cylinder"] },
  { label: "Dangerous Chemicals", keywords: ["chemical", "dangerous chemical", "hazardous chemical", "corrosive", "acid", "solvent"] },
  { label: "Poison / Toxic Material", keywords: ["poison", "toxic", "pesticide", "insecticide"] },
  { label: "Prescription Medicines", keywords: ["medicine", "medication", "prescription", "prescription medicine", "prescription drug", "prescription medication"] },
  { label: "Narcotics / Drugs", keywords: ["narcotic", "narcotics", "drug", "cannabis", "marijuana", "cocaine", "heroin", "opium", "charas", "ganja"] },
  { label: "Live Animals", keywords: ["animal", "live animal", "live animals", "livestock", "live bird", "live fish", "live insect"] },
  { label: "Plants / Seeds", keywords: ["plant", "plants", "seed", "seeds", "sapling", "sappling"] },
  { label: "Pornographic Material", keywords: ["pornographic", "pornography", "porn", "obscene material"] },
  { label: "Counterfeit Goods", keywords: ["counterfeit", "fake goods", "replica goods", "duplicate goods"] },
  { label: "Loose Battery / Power Bank", keywords: ["battery", "loose battery", "loose batteries", "power bank", "powerbank", "lithium", "lithium battery", "lithium batteries"] },
  { label: "Perishable Fresh Food", keywords: ["perishable", "food", "fresh food", "fresh fruit", "fresh vegetable", "raw meat", "fresh fish"] },
  { label: "Human Remains / Ashes", keywords: ["human remains", "human ashes", "cremated", "cremation ash", "ash", "ashes of"] }
];

function keywordPattern(keyword: string): RegExp {
  // Escape regex metacharacters, then allow flexible whitespace inside phrases so
  // "power  bank" and "power bank" both match.
  const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
  // An optional plural suffix lets "cigarette" match "cigarettes" while the trailing
  // boundary still keeps "cash" off "cashew" and "gold" off "marigold".
  return new RegExp(`(^|[^a-z0-9])${escaped}(?:es|s)?([^a-z0-9]|$)`, "i");
}

// Precompiled once at module load.
const compiled = restrictedCategories.map((category) => ({
  label: category.label,
  patterns: category.keywords.map(keywordPattern)
}));

/**
 * Returns the labels of every restricted category found in the description,
 * de-duplicated and in list order. Empty array means the description is clean.
 */
export function findRestrictedCategories(description: unknown): string[] {
  const text = typeof description === "string" ? description.toLowerCase() : "";
  if (!text.trim()) return [];
  const matched: string[] = [];
  for (const category of compiled) {
    if (category.patterns.some((pattern) => pattern.test(text))) matched.push(category.label);
  }
  return matched;
}

export function isRestrictedDescription(description: unknown): boolean {
  return findRestrictedCategories(description).length > 0;
}
