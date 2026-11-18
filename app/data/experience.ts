import collectionBundle from "./collections.json";
import matchingBundle from "./matching-rules.json";

export const STAGES = ["ENTRY", "INTRO", "SELECT", "MIX", "SCULPT", "MATCH", "DISCOVER"];

export type ObjectId = "cocoon" | "cloud" | "metal" | "flower" | "wood" | "branch" | "stone" | "water" | "mushroom" | "light" | "crystal" | "fabric" | "fruit" | "moss" | "leaf" | "chrome" | "feather" | "ribbon" | "sand" | "ice" | "lily" | "rose";
export type CollectionId = "HARVEST" | "BLUE HINOKI" | "COCOON" | "BOTTARI" | "SUNSHINE" | "SHOWERY BODY" | "EVENING GLOW" | "SUMMER TAILS";
export type VisualObject = { id: ObjectId; name: string; subtitle: string; color: string; geometry: ObjectId };

export const VISUAL_OBJECTS: VisualObject[] = [
  { id: "cocoon", name: "SALT", subtitle: "CRYSTAL / GRAIN", color: "#e8d7bc", geometry: "cocoon" },
  { id: "cloud", name: "CLOUD COTTON", subtitle: "AIR / SOFT", color: "#f3eee5", geometry: "cloud" },
  { id: "metal", name: "METAL FRAGMENT", subtitle: "METAL / LIQUID", color: "#aeb2ae", geometry: "metal" },
  { id: "flower", name: "FLOWER", subtitle: "FLORAL / PETAL", color: "#eee0ca", geometry: "flower" },
  { id: "wood", name: "SOIL", subtitle: "EARTH / GRAIN", color: "#79502f", geometry: "wood" },
  { id: "branch", name: "BRANCH", subtitle: "WOOD / LINE", color: "#65472f", geometry: "branch" },
  { id: "stone", name: "STONE", subtitle: "MINERAL / WEIGHT", color: "#8d8170", geometry: "stone" },
  { id: "water", name: "WATER DROP", subtitle: "WATER / CLEAR", color: "#b8e6ef", geometry: "water" },
  { id: "mushroom", name: "MUSHROOM", subtitle: "SPORE / ORGANIC", color: "#b8794f", geometry: "mushroom" },
  { id: "light", name: "BUBBLE", subtitle: "AIR / IRIDESCENT", color: "#7b73ff", geometry: "light" },
  { id: "crystal", name: "SHARP CRYSTAL", subtitle: "SHARP / TRANSPARENT", color: "#8d65df", geometry: "crystal" },
  { id: "fabric", name: "THIN FABRIC", subtitle: "FABRIC / FLOW", color: "#e7dfd0", geometry: "fabric" },
  { id: "fruit", name: "SEED FRUIT", subtitle: "SEED / VIVID", color: "#d73524", geometry: "fruit" },
  { id: "moss", name: "MOSS", subtitle: "GREEN / SOFT", color: "#657c28", geometry: "moss" },
  { id: "leaf", name: "LEAF", subtitle: "LEAF / NATURAL", color: "#c79535", geometry: "leaf" },
  { id: "chrome", name: "GLASS", subtitle: "CLEAR / SMOOTH", color: "#bdc1c7", geometry: "chrome" },
  { id: "feather", name: "FEATHER", subtitle: "LIGHT / SOFT", color: "#e9e4db", geometry: "feather" },
  { id: "ribbon", name: "RIBBON", subtitle: "FLOW / CURVE", color: "#dcaaa8", geometry: "ribbon" },
  { id: "sand", name: "SAND", subtitle: "DRY / GRAIN", color: "#c9ac7c", geometry: "sand" },
  { id: "ice", name: "ICE", subtitle: "COLD / CLEAR", color: "#c8e5ed", geometry: "ice" },
  { id: "lily", name: "LILY OF THE VALLEY", subtitle: "FLORAL / GREEN", color: "#eef0df", geometry: "lily" },
  { id: "rose", name: "ROSE", subtitle: "FLORAL / WARM", color: "#d88789", geometry: "rose" },
];

export type CollectionProduct = { name: string; type: string; detail: string };
export type CollectionProfile = {
  displayName: string;
  description: string;
  accent: string;
  keyNotes: string[];
  characteristics: string[];
  scentNotes: string[];
  products: CollectionProduct[];
  heroImage: string;
  productImages: string[];
  productLabel: string;
  collectionUrl?: string;
};

const LEGACY_COLLECTIONS = {
  HARVEST: {
    description: "A surreal rural world of cultivated earth, ripened seeds, and the quiet abundance of harvest.",
    accent: "#d8bb63", keyNotes: ["Crop", "Soil", "Seed", "Harvest"],
    characteristics: ["Dry earth and ripe fruit", "Textured rural warmth", "Quiet, grounded abundance"],
    scentNotes: ["Earth", "Seed Skin", "Ripe Fruit"],
    productLabel: "EXPERIENCE PRODUCT PALETTE",
    products: [
      { type: "PERFUME", name: "Harvest World Perfume", detail: "Earthy signature format" },
      { type: "BALM", name: "Perfume Balm", detail: "Compact tactile scent" },
      { type: "HAND", name: "Perfumed Hand", detail: "Soft skin ritual" },
      { type: "HOME", name: "Perfume Candle", detail: "Warm field atmosphere" },
    ],
  },
  "BLUE HINOKI": {
    description: "Hinoki adrift between ocean air, pale sunlight, cool waves, and weathered wood.",
    accent: "#9adbea", keyNotes: ["Ocean", "Wood", "Breeze", "Natural"],
    characteristics: ["Cool aromatic freshness", "Clean blue woodland", "Calm driftwood finish"],
    scentNotes: ["Fresh Pine Oil", "Blue Hinoki", "Driftwood"],
    productLabel: "OFFICIAL COLLECTION PRODUCTS",
    collectionUrl: "https://www.tamburins.com/en/shop/collection/collection-bluehinoki/",
    products: [
      { type: "PERFUME", name: "Perfume 50mL", detail: "Blue Hinoki" },
      { type: "PERFUME", name: "Perfume 11mL", detail: "Portable size" },
      { type: "OIL", name: "Perfume Oil", detail: "Layered scent ritual" },
      { type: "BODY", name: "Showery Body Wash", detail: "Blue Hinoki" },
      { type: "BODY", name: "Showery Body Lotion", detail: "Blue Hinoki" },
      { type: "SET", name: "Wash & Lotion Set", detail: "Showery Body duo" },
    ],
  },
  COCOON: {
    description: "A tactile archive of cocoons, fibers, embrace, and memories held close to the body.",
    accent: "#e0a35f", keyNotes: ["Cocoon", "Fiber", "Embrace", "Memory"],
    characteristics: ["Soft enveloping texture", "Skin-close warmth", "Protected intimate mood"],
    scentNotes: ["Soft Fiber", "Skin Musk", "Warm Amber"],
    productLabel: "EXPERIENCE PRODUCT PALETTE",
    products: [
      { type: "PERFUME", name: "Cocoon World Perfume", detail: "Soft enveloping scent" },
      { type: "BALM", name: "Perfume Balm", detail: "Skin-close texture" },
      { type: "OIL", name: "Perfume Oil", detail: "Warm layered finish" },
      { type: "HAND", name: "Perfumed Hand", detail: "Comforting hand ritual" },
    ],
  },
  BOTTARI: {
    description: "A damp, organic forest world where mushrooms, moss, spores, and new life keep unfolding.",
    accent: "#879b55", keyNotes: ["Mushroom", "Moss", "Spore", "Organic"],
    characteristics: ["Damp mossy forest", "Unusual woody freshness", "Deep amber-musk trail"],
    scentNotes: ["Akigalawood", "Soft Moss & Mushroom", "Amber Musk"],
    productLabel: "OFFICIAL COLLECTION PRODUCTS",
    collectionUrl: "https://www.tamburins.com/en/shop/bottari/bottaris/",
    products: [
      { type: "PERFUME", name: "Perfume Bottari", detail: "Signature edition" },
      { type: "PERFUME", name: "Bottari Black", detail: "Sculptural edition" },
      { type: "PERFUME", name: "Bottari White", detail: "Sculptural edition" },
      { type: "OIL", name: "Perfume Oil", detail: "Bottari" },
      { type: "BALM", name: "Perfume Balm", detail: "Bottari" },
      { type: "HOME", name: "Perfume Candle", detail: "Bottari" },
    ],
  },
  SUNSHINE: {
    description: "A bold futuristic world shaped by polished metal, concentrated light, and physical strength.",
    accent: "#dfff3f", keyNotes: ["Metal", "Light", "Strength", "Futuristic"],
    characteristics: ["Bright metallic clarity", "Floral light beam", "Clean armored softness"],
    scentNotes: ["Angelica", "Muguet", "Cloud Armor"],
    productLabel: "OFFICIAL COLLECTION PRODUCTS",
    collectionUrl: "https://www.tamburins.com/en/shop/collection/collection-sunshine/",
    products: [
      { type: "PERFUME", name: "Limited Sunshine", detail: "Limited edition" },
      { type: "PERFUME", name: "Perfume 50mL", detail: "Sunshine" },
      { type: "PERFUME", name: "Perfume 11mL", detail: "Portable size" },
      { type: "OIL", name: "Perfume Oil", detail: "Sunshine" },
      { type: "HOME", name: "Perfume Candle", detail: "Sunshine" },
    ],
  },
  "SHOWERY BODY": {
    description: "A fluid daydream of water, mist, clouds, rain, and forms that move like a passing shower.",
    accent: "#b6c3df", keyNotes: ["Water", "Mist", "Cloud", "Fluid"],
    characteristics: ["Watery transparent motion", "Clean skin after rain", "Soft cloud-like finish"],
    scentNotes: ["Water", "Mist", "Cloud"],
    productLabel: "OFFICIAL BODY COLLECTION PRODUCTS",
    collectionUrl: "https://www.tamburins.com/en/shop/body/showery-body/",
    products: [
      { type: "BODY", name: "Showery Body Wash", detail: "Multiple scents" },
      { type: "BODY", name: "Showery Body Lotion", detail: "Multiple scents" },
      { type: "SET", name: "Wash & Lotion Set", detail: "Body ritual duo" },
      { type: "SCENT", name: "Blue Hinoki", detail: "Fresh woody variant" },
      { type: "SCENT", name: "Early Morning Dew", detail: "Dewy variant" },
      { type: "SCENT", name: "Fog / Nimbus", detail: "Atmospheric variants" },
    ],
  },
  "EVENING GLOW": {
    description: "A sensual world of roses and soft forms maturing beneath the last glow of sunset.",
    accent: "#bd7b75", keyNotes: ["Rose", "Sunset", "Sensual", "Soft"],
    characteristics: ["Warm sunset rose", "Juicy raspberry contrast", "Soft lingering musk"],
    scentNotes: ["Rose Tinted by Sunset", "Raspberry", "Musk"],
    productLabel: "OFFICIAL COLLECTION PRODUCTS",
    collectionUrl: "https://www.tamburins.com/en/shop/collection/collection-eveningglow/",
    products: [
      { type: "PERFUME", name: "Perfume 50mL", detail: "Evening Glow" },
      { type: "PERFUME", name: "Perfume 11mL", detail: "Portable size" },
      { type: "PERFUME", name: "Egg Perfume", detail: "Sculptural edition" },
      { type: "BALM", name: "Perfume Balm", detail: "Evening Glow" },
      { type: "HAND", name: "Shell Perfume Hand", detail: "Fragrant hand cream" },
      { type: "OIL", name: "Perfume Oil", detail: "Evening Glow" },
    ],
  },
  "SUMMER TAILS": {
    description: "An airy floral world carried by green leaves, delicate movement, and an early-summer breeze.",
    accent: "#b5cb85", keyNotes: ["Green", "Floral", "Airy", "Flowing"],
    characteristics: ["Pale-green honey breeze", "Clean lily-of-the-valley", "Soft cedarwood warmth"],
    scentNotes: ["Light Green Honey Wind", "Lily of the Valley", "Cedarwood"],
    productLabel: "OFFICIAL COLLECTION PRODUCTS",
    collectionUrl: "https://www.tamburins.com/en/shop/collection/collection-summertails/",
    products: [
      { type: "HAIR", name: "Hair Perfume", detail: "Summer Tails" },
      { type: "HAIR", name: "Hair Oil", detail: "Summer Tails" },
      { type: "PERFUME", name: "Perfume 50mL", detail: "Summer Tails" },
      { type: "PERFUME", name: "Perfume 11mL", detail: "Portable size" },
      { type: "HAND", name: "Shell Perfume Hand", detail: "Fragrant hand cream" },
      { type: "HAND", name: "Perfumed Hand Wash", detail: "Summer Tails" },
    ],
  },
} as const;

const COLLECTION_ID_MAP: Record<string, CollectionId> = {
  harvest: "HARVEST",
  blue_hinoki: "BLUE HINOKI",
  cocoon: "COCOON",
  bottari: "BOTTARI",
  sunshine: "SUNSHINE",
  showerybody: "SHOWERY BODY",
  evening_glow: "EVENING GLOW",
  summer_tails: "SUMMER TAILS",
};
const COLLECTION_ACCENTS: Record<CollectionId, string> = {
  HARVEST: "#d8bb63", "BLUE HINOKI": "#9adbea", COCOON: "#e0a35f",
  BOTTARI: "#879b55", SUNSHINE: "#dfff3f", "SHOWERY BODY": "#b6c3df",
  "EVENING GLOW": "#bd7b75", "SUMMER TAILS": "#b5cb85",
};
const PRODUCT_IMAGE_COUNTS: Record<string, number> = {
  harvest: 4, blue_hinoki: 1, cocoon: 2, bottari: 1,
  showerybody: 1, evening_glow: 1, sunshine: 1, summer_tails: 2,
};

export const COLLECTIONS = Object.fromEntries(collectionBundle.map((item) => {
  const collectionId = COLLECTION_ID_MAP[item.id];
  const productImages = Array.from(
    { length: PRODUCT_IMAGE_COUNTS[item.id] ?? 0 },
    (_, index) => `/assets/${item.id}/product-${String(index + 1).padStart(2, "0")}.png`,
  );
  return [collectionId, {
    displayName: item.name,
    description: item.concept,
    accent: COLLECTION_ACCENTS[collectionId],
    keyNotes: item.conceptKeywords,
    characteristics: item.scentMood,
    scentNotes: item.scentKeywords,
    products: item.products.map((name, index) => ({
      name,
      type: name.split(" ")[0].toUpperCase(),
      detail: item.scentMood[index % item.scentMood.length],
    })),
    heroImage: `/assets/${item.id}/hero.jpg`,
    productImages,
    productLabel: "OFFICIAL PRODUCT LINEUP",
    collectionUrl: item.imageSources.hero,
  } satisfies CollectionProfile];
})) as Record<CollectionId, CollectionProfile>;

// Edit this single object to tune the object-to-collection matching.
// fruit=seedFruit, fabric=thinFabric, cloud=cloudCotton, water=waterDrop,
// metal=metalFragment, chrome=chromeSphere, crystal=sharpCrystal, light=glowingSphere.
const LEGACY_COLLECTION_RULES: Record<ObjectId, Partial<Record<CollectionId, number>>> = {
  flower: { "SUMMER TAILS": 3, "EVENING GLOW": 3, HARVEST: 1, COCOON: 1 },
  leaf: { "SUMMER TAILS": 3, HARVEST: 3, "BLUE HINOKI": 1 },
  branch: { "BLUE HINOKI": 3, BOTTARI: 2, HARVEST: 2 },
  wood: { "BLUE HINOKI": 4, HARVEST: 2, BOTTARI: 1 },
  mushroom: { BOTTARI: 5, COCOON: 1 },
  moss: { BOTTARI: 4, COCOON: 2, "BLUE HINOKI": 1 },
  stone: { "BLUE HINOKI": 2, BOTTARI: 2, HARVEST: 1 },
  fruit: { HARVEST: 4, "EVENING GLOW": 3 },
  fabric: { "SUMMER TAILS": 3, COCOON: 3, "SHOWERY BODY": 1 },
  cloud: { COCOON: 4, "SHOWERY BODY": 4, "SUMMER TAILS": 1 },
  water: { "SHOWERY BODY": 5, "BLUE HINOKI": 3 },
  cocoon: { COCOON: 6 },
  metal: { SUNSHINE: 5 },
  chrome: { SUNSHINE: 5 },
  crystal: { SUNSHINE: 4, "SHOWERY BODY": 1 },
  light: { SUNSHINE: 3, "EVENING GLOW": 2 },
};

const OBJECT_BUNDLE_IDS: Record<ObjectId, string> = {
  flower: "flower", leaf: "leaf", branch: "branch", wood: "wood",
  mushroom: "mushroom", moss: "moss", stone: "stone", fruit: "seedFruit",
  fabric: "thinFabric", cloud: "cottonCloud", water: "waterDrop", cocoon: "cocoon",
  metal: "metalFragment", chrome: "chromeSphere", crystal: "sharpCrystal", light: "glowingSphere",
  feather: "feather", ribbon: "ribbon", sand: "sand", ice: "ice", lily: "lily", rose: "rose",
};
const BUNDLE_OBJECT_IDS = Object.fromEntries(
  Object.entries(OBJECT_BUNDLE_IDS).map(([internalId, bundleId]) => [bundleId, internalId]),
) as Record<string, ObjectId>;

export const COLLECTION_RULES = Object.fromEntries(
  (Object.keys(OBJECT_BUNDLE_IDS) as ObjectId[]).map((objectId) => {
    const raw = matchingBundle.objectScores[OBJECT_BUNDLE_IDS[objectId] as keyof typeof matchingBundle.objectScores] ?? {};
    return [objectId, Object.fromEntries(
      Object.entries(raw).map(([collectionId, points]) => [COLLECTION_ID_MAP[collectionId], points]),
    )];
  }),
) as Record<ObjectId, Partial<Record<CollectionId, number>>>;

export type CombinationBonus = { objects: ObjectId[]; collection: CollectionId; points: number };
const LEGACY_COMBINATION_BONUSES: CombinationBonus[] = [
  { objects: ["mushroom", "moss"], collection: "BOTTARI", points: 5 },
  { objects: ["wood", "water"], collection: "BLUE HINOKI", points: 4 },
  { objects: ["flower", "fruit"], collection: "EVENING GLOW", points: 4 },
  { objects: ["flower", "leaf", "fabric"], collection: "SUMMER TAILS", points: 5 },
  { objects: ["cocoon", "cloud"], collection: "COCOON", points: 5 },
  { objects: ["metal", "chrome"], collection: "SUNSHINE", points: 5 },
  { objects: ["water", "cloud"], collection: "SHOWERY BODY", points: 5 },
  { objects: ["fruit", "leaf"], collection: "HARVEST", points: 4 },
];

export const COMBINATION_BONUSES: CombinationBonus[] = matchingBundle.combinationBonuses.map((bonus) => ({
  objects: bonus.when.map((id) => BUNDLE_OBJECT_IDS[id]),
  collection: COLLECTION_ID_MAP[bonus.collection],
  points: bonus.bonus,
}));

void LEGACY_COLLECTIONS;
void LEGACY_COLLECTION_RULES;
void LEGACY_COMBINATION_BONUSES;
