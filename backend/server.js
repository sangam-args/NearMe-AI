const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");

dotenv.config();

const app = express();

// =====================================================================
// CORS CONFIGURATION (Production & Local Ready)
// =====================================================================
const allowedOrigins = [
  "http://localhost:5173", // Vite default
  "http://localhost:3000", // React default
  "https://near-me-ai.vercel.app"
];

app.use(cors({
  origin: function (origin, callback) {
    // allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);
    if (allowedOrigins.indexOf(origin) === -1) {
      const msg = 'CORS policy does not allow access from this origin.';
      return callback(new Error(msg), false);
    }
    return callback(null, true);
  },
  credentials: true
}));

app.use(express.json());

const PORT = process.env.PORT || 5000;
const API_KEY = process.env.GEOAPIFY_API_KEY;
const CODE_VERSION = "5.0-production-ready";

const DEFAULT_RADIUS_KM = 10;
const REQUEST_TIMEOUT_MS = 10000;
const MAX_DETAIL_LOOKUPS = 6;
const GEOAPIFY = "https://api.geoapify.com";

// =====================================================================
// HEALTH / DEBUG
// =====================================================================

app.get("/", (req, res) => {
  res.json({ success: true, message: "NearMe AI backend is running!", version: CODE_VERSION });
});

app.get("/api/health", (req, res) => {
  res.json({
    success: true,
    message: "NearMe AI API is healthy",
    version: CODE_VERSION,
    apiKeyConfigured: Boolean(API_KEY),
  });
});

app.get("/api/debug", (req, res) => {
  const q = String(req.query.q || "");
  if (!q) return res.json({ error: "Add ?q=your+search" });

  const normalized = normalizeSearchQuery(q);
  const detected = detectCategories(normalized, null);
  const nameCandidate = extractNameCandidate(normalized);

  res.json({
    input: q,
    normalized,
    tokens: tokenize(normalized),
    categoriesDetected: detected?.cats || null,
    filterDetected: detected?.filter || null,
    nameCandidateDetected: nameCandidate,
  });
});

app.get("/api/validate-categories", async (req, res) => {
  if (!API_KEY) return res.json({ error: "GEOAPIFY_API_KEY is missing" });

  const all = new Set();
  for (const entry of KEYWORD_MAP) for (const c of entry.cats) all.add(c);
  for (const arr of Object.values(FRONTEND_CATEGORY_MAP)) for (const c of arr) all.add(c);

  const lat = Number(req.query.lat || 28.6139);
  const lon = Number(req.query.lon || 77.2090);

  const results = [];
  for (const cat of all) {
    const params = new URLSearchParams({
      categories: cat,
      filter: `circle:${lon},${lat},1000`,
      limit: "1",
      apiKey: API_KEY,
    });
    try {
      const r = await fetchJson(`${GEOAPIFY}/v2/places?${params}`);
      results.push({ category: cat, status: r.status, ok: r.ok });
    } catch (e) {
      results.push({ category: cat, status: "error", ok: false, error: e.message });
    }
  }

  const invalid = results.filter((r) => !r.ok);
  res.json({
    total: results.length,
    valid: results.length - invalid.length,
    invalid: invalid.length,
    invalidCategories: invalid.map((b) => b.category),
    details: results,
  });
});

// =====================================================================
// LINGUISTIC HELPERS (Hindi / Hinglish Normalization)
// =====================================================================

function tokenize(text) {
  return String(text).toLowerCase().split(/[^\w\u0900-\u097F]+/).filter(Boolean);
}

function stem(word) {
  if (!word || word.length < 4) return word;
  if (word.endsWith("ies")) return word.slice(0, -3) + "y";
  if (word.endsWith("es") && word.length > 4) return word.slice(0, -2);
  if (word.endsWith("s")) return word.slice(0, -1);
  return word;
}

function levenshtein(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const curr = [i];
    for (let j = 1; j <= b.length; j++) {
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = curr;
  }
  return prev[b.length];
}

function tokenMatchesKeyword(token, keyword) {
  const t = token.toLowerCase();
  const k = keyword.toLowerCase();
  if (t === k) return true;
  if (stem(t) === stem(k)) return true;
  if (k.length >= 4) {
    const maxDist = k.length >= 7 ? 2 : 1;
    if (Math.abs(t.length - k.length) <= maxDist && levenshtein(t, k) <= maxDist) return true;
  }
  return false;
}

function normalizeSearchQuery(raw = "") {
  let text = String(raw).toLowerCase().trim();

  const noise = [
    /\bplease\b/g, /\bplz\b/g, /\bnear me\b/g, /\bnearby\b/g,
    /\bmere paas\b/g, /\bmere pass\b/g, /\bdhundo\b/g, /\bdhundho\b/g,
    /\bkhojo\b/g, /\bchahiye\b/g, /\bbatao\b/g, /\bbataye\b/g,
    /\bfind\b/g, /\bsearch\b/g, /\bshow me\b/g, /\bacha\b/g,
    /\bachha\b/g, /\baccha\b/g, /\bbest\b/g, /\bgood\b/g, /\bnear\b/g,
    /नियर\s*मी/g, /नियरबाय/g, /के\s*पास/g, /आस\s*पास/g, /आस-पास/g,
    /मेरे\s*पास/g, /पास\s*में/g, /कृपया/g, /बताओ/g, /बताइए/g,
    /चाहिए/g, /ढूंढो/g, /खोजो/g, /नज़दीक/g, /नजदीक/g,
  ];
  for (const p of noise) text = text.replace(p, " ");

  const hindi = [
    [/रेस्टोरेंट|रेस्तरां|खाना खाने की जगह/g, "restaurant"],
    [/कैफे|कॉफी की दुकान/g, "cafe"],
    [/जिम|व्यायामशाला/g, "gym"],
    [/हॉस्टल|छात्रावास/g, "hostel"],
    [/किराए का कमरा|कमरा किराए पर|रूम किराया/g, "room for rent"],
    [/कमरा|रूम/g, "room"],
    [/ऑटोमोबाइल|गाड़ी की मरम्मत|कार रिपेयर/g, "car repair"],
    [/मैकेनिक|मोटर मैकेनिक/g, "car repair"],
    [/टूरिस्ट प्लेस|घूमने की जगह|पर्यटन स्थल/g, "tourist attraction"],
    [/पार्क|बगीचा|गार्डन/g, "park"],
    [/दर्जी|कपड़े सिलने वाला/g, "tailor"],
    [/अस्पताल|हॉस्पिटल/g, "hospital"],
    [/डॉक्टर|चिकित्सक/g, "doctor"],
    [/दवा की दुकान|मेडिकल स्टोर|फार्मेसी/g, "pharmacy"],
    [/स्कूल|विद्यालय/g, "school"],
    [/कॉलेज|महाविद्यालय/g, "college"],
    [/विश्वविद्यालय|यूनिवर्सिटी/g, "university"],
    [/कोचिंग|ट्यूशन सेंटर/g, "coaching"],
    [/सैलून|नाई की दुकान|हेयर कटिंग/g, "hair salon"],
    [/बैंक/g, "bank"],
    [/एटीएम|ए टी एम/g, "atm"],
    [/किराना|किराने की दुकान/g, "grocery store"],
    [/दुकान|शॉपिंग/g, "shop"],
    [/होटल/g, "hotel"],
    [/मंदिर/g, "temple"],
    [/पेट्रोल पंप/g, "fuel station"],
    [/मोबाइल रिपेयर|मोबाइल की मरम्मत/g, "mobile phone repair"],
    [/बस स्टैंड/g, "bus station"],
    [/रेलवे स्टेशन/g, "train station"],
    [/टैक्सी/g, "taxi"],
    [/पशु चिकित्सक|पशु अस्पताल/g, "veterinary"],
    [/लाइब्रेरी|पुस्तकालय/g, "library"],
  ];
  for (const [re, sub] of hindi) text = text.replace(re, sub);

  const hinglish = [
    [/\brestorent\b/g, "restaurant"], [/\brestro\b/g, "restaurant"],
    [/\bkhaana\b/g, "food"], [/\bkhana\b/g, "food"],
    [/\bkaife\b/g, "cafe"], [/\bjim\b/g, "gym"],
    [/\broom rent\b/g, "room for rent"], [/\brent room\b/g, "room for rent"],
    [/\bdawai\b/g, "pharmacy"], [/\bdawa\b/g, "pharmacy"],
    [/\bmedical\b/g, "pharmacy"], [/\baspatal\b/g, "hospital"],
    [/\bvidyalaya\b/g, "school"], [/\bpathshala\b/g, "school"],
    [/\bbagicha\b/g, "park"], [/\bdarji\b/g, "tailor"],
    [/\bbarber\b/g, "hair salon"], [/\bkirana\b/g, "grocery store"],
    [/\bdukan\b/g, "shop"], [/\bdokan\b/g, "shop"],
    [/\bmandir\b/g, "temple"],
    [/\bmechanic\b/g, "car repair"], [/\bgaadi repair\b/g, "car repair"],
    [/\bpetrol pump\b/g, "fuel station"],
    [/\bbus stand\b/g, "bus station"],
    [/\brailway station\b/g, "train station"],
    [/\bghumne ki jagah\b/g, "tourist attraction"],
  ];
  for (const [re, sub] of hinglish) text = text.replace(re, sub);

  return text.replace(/\s+/g, " ").trim();
}

// =====================================================================
// KEYWORD MAP (Only verified Geoapify categories)
// =====================================================================

const KEYWORD_MAP = [
  { kw: ["pizza"], cats: ["catering.fast_food.pizza", "catering.fast_food", "catering.restaurant"] },
  { kw: ["burger", "mcdonald", "kfc"], cats: ["catering.fast_food", "catering.restaurant"] },
  { kw: ["ice cream", "icecream", "gelato"], cats: ["catering.ice_cream", "catering.fast_food"] },
  { kw: ["sweets", "mithai", "bakery", "cake"], cats: ["commercial.food_and_drink", "catering.cafe"] },
  { kw: ["restaurant", "dine", "eatery"], cats: ["catering.restaurant"] },
  { kw: ["cafe", "coffee"], cats: ["catering.cafe"] },
  { kw: ["bar", "pub"], cats: ["catering.bar", "catering.pub"] },
  { kw: ["food", "khana"], cats: ["catering"] },
  { kw: ["gym", "fitness", "workout", "crossfit"], cats: ["sport.fitness"], filter: ["fitness", "gym", "workout", "crossfit", "yoga"] },
  { kw: ["yoga"], cats: ["sport.fitness"], filter: ["yoga", "fitness", "gym"] },
  { kw: ["stadium"], cats: ["sport.stadium", "sport"] },
  { kw: ["sports centre", "sports center"], cats: ["sport.sports_centre", "sport"] },
  { kw: ["playground"], cats: ["leisure.playground"] },
  { kw: ["spa"], cats: ["leisure.spa"] },
  { kw: ["hotel", "resort", "lodge"], cats: ["accommodation.hotel", "accommodation"] },
  { kw: ["pg", "paying guest", "hostel"], cats: ["accommodation.hostel", "accommodation"] },
  { kw: ["guest house", "guesthouse"], cats: ["accommodation.guest_house", "accommodation"] },
  { kw: ["room", "rent", "flat", "apartment"], cats: ["accommodation"] },
  { kw: ["accommodation", "stay"], cats: ["accommodation"] },
  { kw: ["hospital"], cats: ["healthcare.hospital"] },
  { kw: ["pharmacy", "medical", "chemist", "medicine"], cats: ["healthcare.pharmacy"] },
  { kw: ["doctor", "clinic", "physician"], cats: ["healthcare.clinic_or_praxis", "healthcare.doctor", "healthcare"] },
  { kw: ["dentist", "dental"], cats: ["healthcare.dentist"] },
  { kw: ["veterinary", "vet"], cats: ["healthcare.veterinary"] },
  { kw: ["healthcare", "health"], cats: ["healthcare"] },
  { kw: ["school"], cats: ["education.school"] },
  { kw: ["college"], cats: ["education.college"] },
  { kw: ["university"], cats: ["education.university"] },
  { kw: ["library"], cats: ["education.library"] },
  { kw: ["coaching", "tuition", "tutoring"], cats: ["education"] },
  { kw: ["salon", "beauty", "parlour", "parlor"], cats: ["commercial.health_and_beauty"] },
  { kw: ["barber", "haircut"], cats: ["commercial.health_and_beauty"] },
  { kw: ["shopping mall", "mall"], cats: ["commercial.shopping_mall"] },
  { kw: ["supermarket", "grocery", "groceries", "kirana"], cats: ["commercial.supermarket", "commercial.convenience"] },
  { kw: ["market", "bazaar"], cats: ["commercial.marketplace"] },
  { kw: ["tailor", "alteration", "stitching", "darzi"], cats: ["commercial.clothing"] },
  { kw: ["shop", "store"], cats: ["commercial"] },
  { kw: ["petrol", "fuel", "gas station", "petrol pump"], cats: ["service.vehicle.fuel", "service.vehicle"] },
  { kw: ["car repair", "garage", "mechanic", "bike repair", "automobile repair", "car service"], cats: ["service.vehicle.repair", "service.vehicle"] },
  { kw: ["car wash"], cats: ["service.vehicle.car_wash", "service.vehicle"] },
  { kw: ["car dealer", "automobile", "showroom"], cats: ["commercial.vehicle.car", "commercial.vehicle"] },
  { kw: ["bank"], cats: ["service.financial.bank", "service.financial"] },
  { kw: ["atm", "cash machine"], cats: ["service.financial.atm", "service.financial"] },
  { kw: ["park", "garden"], cats: ["leisure.park", "leisure.park.garden"] },
  { kw: ["tourist", "attraction", "sightseeing"], cats: ["tourism.attraction", "tourism.sights"] },
  { kw: ["temple", "mandir"], cats: ["religion.place_of_worship.hindu", "religion"] },
  { kw: ["mosque", "masjid"], cats: ["religion.place_of_worship.muslim", "religion"] },
  { kw: ["church"], cats: ["religion.place_of_worship.christian", "religion"] },
  { kw: ["bus station", "bus stand", "bus stop"], cats: ["public_transport"] },
  { kw: ["train station", "railway"], cats: ["public_transport"] },
  { kw: ["airport"], cats: ["airport"] },
  { kw: ["cinema", "movie", "theatre"], cats: ["entertainment.cinema"] },
  { kw: ["laundry", "dry clean"], cats: ["service"] },
  { kw: ["plumber", "electrician"], cats: ["service"] },
];

const STOP_WORDS = new Set(["and", "or", "the", "a", "an", "for", "with", "at", "in", "of", "to", "on", "by", "from"]);
const CATEGORY_ONLY_WORDS = new Set([
  "gym", "hotel", "hostel", "hospital", "clinic", "doctor", "salon", "restaurant", "cafe", "coffee", "park", "garden",
  "school", "college", "university", "bank", "atm", "grocery", "supermarket", "shop", "store", "mall", "market", "temple",
  "pharmacy", "medical", "mechanic", "garage", "tailor", "spa", "beauty", "barber", "library", "airport", "taxi", "petrol",
  "fuel", "laundry", "cinema", "theatre", "playground", "stadium", "coaching", "tuition", "resort", "lodge", "dhaba", "bar",
  "pub", "pg", "room", "rent", "flat", "apartment", "accommodation", "repair", "service", "services", "showroom",
]);

// =====================================================================
// CATEGORY DETECTION
// =====================================================================

const FRONTEND_CATEGORY_MAP = {
  "gyms & fitness": ["sport.fitness"],
  "rooms & rentals": ["accommodation"],
  automobile: ["commercial.vehicle", "service.vehicle.repair"],
  "tourist places": ["tourism.attraction", "tourism.sights"],
  "parks & gardens": ["leisure.park", "leisure.park.garden"],
  tailors: ["commercial.clothing"],
  cafes: ["catering.cafe"],
  restaurants: ["catering.restaurant"],
  healthcare: ["healthcare.hospital", "healthcare.pharmacy", "healthcare.clinic_or_praxis"],
  shopping: ["commercial"],
  education: ["education"],
  salons: ["commercial.health_and_beauty"],
  "banks & atms": ["service.financial"],
  groceries: ["commercial.supermarket", "commercial.convenience"],
  "home services": ["service"],
  transport: ["public_transport"],
};

function detectCategories(normalizedQuery, selectedCategory) {
  const key = String(selectedCategory || "").toLowerCase().trim();
  if (key && FRONTEND_CATEGORY_MAP[key]) {
    return { cats: FRONTEND_CATEGORY_MAP[key], filter: null };
  }

  const tokens = tokenize(normalizedQuery);
  if (tokens.length === 0) return null;

  for (const entry of KEYWORD_MAP) {
    for (const word of entry.kw) {
      const keywordTokens = tokenize(word);
      if (keywordTokens.length > 1) {
        if (normalizedQuery.includes(word)) {
          return { cats: entry.cats, filter: entry.filter || null };
        }
        continue;
      }
      const kw = keywordTokens[0];
      if (tokens.some((t) => tokenMatchesKeyword(t, kw))) {
        return { cats: entry.cats, filter: entry.filter || null };
      }
    }
  }

  return null;
}

function extractNameCandidate(normalizedQuery) {
  const tokens = tokenize(normalizedQuery);
  if (tokens.length === 0) return null;
  const content = tokens.filter((t) => !STOP_WORDS.has(t));
  if (content.length === 0) return null;
  const nonCategory = content.filter((t) => !CATEGORY_ONLY_WORDS.has(stem(t)));
  if (nonCategory.length === 0) return null;
  return nonCategory.join(" ");
}

// =====================================================================
// DISTANCE / FETCH HELPERS
// =====================================================================

function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(lat2 - lat1);
  const dLon = rad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

async function fetchJson(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function resolveLocation(input) {
  const value = String(input || "").trim();
  if (!value) throw new Error("Location required.");

  const m = value.match(/^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/);
  if (m) {
    const lat = Number(m[1]);
    const lon = Number(m[2]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
      throw new Error("Invalid coordinates.");
    }
    return { latitude: lat, longitude: lon, displayName: value };
  }

  const params = new URLSearchParams({ text: value, format: "json", limit: "1", apiKey: API_KEY });
  const res = await fetchJson(`${GEOAPIFY}/v1/geocode/search?${params}`);
  if (!res.ok) throw new Error(`Location lookup failed (HTTP ${res.status}).`);
  const data = await res.json();
  const r = data.results?.[0];
  if (!r) throw new Error(`Could not find "${value}".`);
  return { latitude: Number(r.lat), longitude: Number(r.lon), displayName: r.formatted || value };
}

// =====================================================================
// GEOAPIFY SEARCH STRATEGIES
// =====================================================================

async function searchByCategories(categories, lat, lon, radiusMeters, depth = 0) {
  const params = new URLSearchParams({
    categories: categories.join(","),
    filter: `circle:${lon},${lat},${radiusMeters}`, 
    bias: `proximity:${lon},${lat}`,
    limit: "40",
    apiKey: API_KEY,
  });

  const res = await fetchJson(`${GEOAPIFY}/v2/places?${params}`);
  if (res.ok) {
    const data = await res.json();
    const features = Array.isArray(data.features) ? data.features : [];
    console.log(`[cat-OK] ${categories.join(",")} → ${features.length}`);
    return features;
  }

  const errBody = await res.text().catch(() => "");
  console.warn(`[cat-ERR] ${res.status} ${categories.join(",")} ${errBody.slice(0, 100)}`);

  if (depth >= 2) return [];

  if (categories.length > 1) {
    const combined = [];
    for (const cat of categories) {
      const single = await searchByCategories([cat], lat, lon, radiusMeters, depth + 1); 
      combined.push(...single);
    }
    return combined;
  }

  const parts = categories[0].split(".");
  if (parts.length > 1) {
    const parent = parts.slice(0, -1).join(".");
    console.log(`[cat] retrying parent "${parent}"`);
    return searchByCategories([parent], lat, lon, radiusMeters, depth + 1);
  }

  return [];
}

async function searchByName(name, categories, lat, lon, radiusMeters) {
  const cats = categories && categories.length ? categories : null;
  const params = new URLSearchParams({
    name,
    filter: `circle:${lon},${lat},${radiusMeters}`, 
    bias: `proximity:${lon},${lat}`,
    limit: "20",
    apiKey: API_KEY,
  });
  if (cats) params.set("categories", cats.join(","));

  const res = await fetchJson(`${GEOAPIFY}/v2/places?${params}`);
  if (!res.ok) {
    const errBody = await res.text().catch(() => "");
    console.warn(`[name-ERR] ${res.status} "${name}" ${errBody.slice(0, 100)}`);
    if (cats) {
      const fb = new URLSearchParams({
        name,
        filter: `circle:${lon},${lat},${radiusMeters}`, 
        bias: `proximity:${lon},${lat}`,
        limit: "20",
        apiKey: API_KEY,
      });
      const r2 = await fetchJson(`${GEOAPIFY}/v2/places?${fb}`);
      if (!r2.ok) return [];
      const d2 = await r2.json();
      return filterByName(Array.isArray(d2.features) ? d2.features : [], name);
    }
    return [];
  }

  const data = await res.json();
  const features = Array.isArray(data.features) ? data.features : [];
  console.log(`[name-OK] "${name}" → ${features.length}`);
  return filterByName(features, name);
}

function filterByName(features, name) {
  const q = name.toLowerCase().trim();
  const words = q.split(/\s+/).filter((w) => w.length > 1);
  return features.filter((f) => {
    const nm = (f.properties?.name || "").toLowerCase();
    if (!nm) return false;
    if (nm.includes(q)) return true;
    return words.length > 0 && words.every((w) => nm.includes(w));
  });
}

async function searchByText(text, lat, lon, radiusMeters) {
  const params = new URLSearchParams({
    name: text,
    filter: `circle:${lon},${lat},${radiusMeters}`, 
    bias: `proximity:${lon},${lat}`,
    limit: "40",
    apiKey: API_KEY,
  });
  const res = await fetchJson(`${GEOAPIFY}/v2/places?${params}`);
  if (!res.ok) {
    console.warn(`[text-ERR] ${res.status} "${text}"`);
    return [];
  }
  const data = await res.json();
  const features = Array.isArray(data.features) ? data.features : [];
  console.log(`[text-OK] "${text}" → ${features.length}`);
  return features;
}

// =====================================================================
// NORMALIZE / RANK / FILTER
// =====================================================================

function humanCategory(rawCategories, fallback = "Nearby place") {
  if (!Array.isArray(rawCategories) || rawCategories.length === 0) return fallback;
  return rawCategories.slice(0, 3).map((c) => String(c).split(".").pop().replace(/_/g, " ")).join(" · ");
}

function normalizeFeature(feature, userLat, userLon, source) {
  const props = feature.properties || {};
  const coords = feature.geometry?.coordinates || [];
  const lon = Number(coords[0]);
  const lat = Number(coords[1]);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;

  const distance = haversineKm(userLat, userLon, lat, lon);
  const raw = props.datasource?.raw || {};

  let sourceUrl = null;
  if (raw.osm_type && raw.osm_id) {
    const type = raw.osm_type === "node" ? "node" : raw.osm_type === "way" ? "way" : "relation";
    sourceUrl = `https://www.openstreetmap.org/${type}/${raw.osm_id}`;
  }

  const name = props.name || props.address_line1 || props.formatted || "Unnamed place";
  const address = props.formatted || props.address_line2 || props.address_line1 || "Address not available";

  return {
    id: props.place_id || `${lat},${lon},${name}`,
    placeId: props.place_id || null,
    name,
    category: humanCategory(props.categories),
    address,
    latitude: lat,
    longitude: lon,
    distanceKm: Number(distance.toFixed(2)),
    distance: Number(distance.toFixed(2)),
    phone: raw.phone || props.contact?.phone || props.phone || null,
    website: raw.website || props.website || null,
    openingHours: raw.opening_hours || props.opening_hours || null,
    photoUrl: null,
    directionsUrl: `https://www.google.com/maps/dir/?api=1&destination=${lat},${lon}`,
    sourceUrl,
    source: "Geoapify",
    _fromNameSearch: source === "name",
    _fromTextSearch: source === "text",
    _nameScore: 0,
  };
}

function rankAndDedupe(places, nameCandidate) {
  const byKey = new Map();
  for (const p of places) {
    const key = p.placeId || `${p.name.toLowerCase()}::${p.latitude.toFixed(4)}::${p.longitude.toFixed(4)}`;
    if (!byKey.has(key)) byKey.set(key, p);
  }

  const nc = (nameCandidate || "").toLowerCase().trim();
  const list = Array.from(byKey.values());

  for (const p of list) {
    const pn = p.name.toLowerCase();
    let score = 0;
    if (nc) {
      if (pn === nc) score += 200;
      else if (pn.startsWith(nc)) score += 140;
      else if (pn.includes(nc)) score += 100;
      else {
        const words = nc.split(/\s+/).filter((w) => w.length > 1);
        score += words.filter((w) => pn.includes(w)).length * 30;
      }
    }
    if (p._fromNameSearch) score += 15;
    if (p._fromTextSearch) score += 5;
    score += Math.max(0, 50 - p.distanceKm * 5);
    p._nameScore = score;
  }

  return list.sort((a, b) => b._nameScore - a._nameScore);
}

function applyCategoryFilter(places, filterTerms) {
  if (!filterTerms || filterTerms.length === 0) return places;
  const filtered = places.filter((p) => {
    const text = `${p.category || ""} ${p.name || ""}`.toLowerCase();
    return filterTerms.some((f) => text.includes(f));
  });
  return filtered.length > 0 ? filtered : places;
}

// =====================================================================
// PLACE DETAILS ENRICHMENT
// =====================================================================

async function enrichPlaceDetails(place) {
  if (!place.placeId) return place;
  try {
    const params = new URLSearchParams({ id: place.placeId, apiKey: API_KEY });
    const res = await fetchJson(`${GEOAPIFY}/v2/place-details?${params}`);
    if (!res.ok) return place;
    const data = await res.json();
    const props = data.features?.[0]?.properties || {};
    const raw = props.datasource?.raw || {};

    return {
      ...place,
      phone: props.phone || props.contact?.phone || raw.phone || place.phone || null,
      website: props.website || raw.website || place.website || null,
      openingHours: props.opening_hours || raw.opening_hours || place.openingHours || null,
      photoUrl: props.wiki_and_media?.image || raw.image || place.photoUrl || null,
    };
  } catch (e) {
    console.warn(`[details-ERR] ${place.placeId}: ${e.message}`);
    return place;
  }
}

async function enrichTopPlaces(places, count = MAX_DETAIL_LOOKUPS) {
  const top = places.slice(0, count);
  const rest = places.slice(count);
  const enriched = await Promise.all(top.map(enrichPlaceDetails));
  console.log(`[details] enriched ${top.length} places, ${enriched.filter(p => p.phone || p.website || p.openingHours).length} got extra info`);
  return [...enriched, ...rest];
}

// =====================================================================
// MAIN SEARCH ROUTE
// =====================================================================

app.post("/api/search", async (req, res) => {
  try {
    const { query, location, category, radius } = req.body || {};

    if (!query || !String(query).trim()) {
      return res.status(400).json({ success: false, message: "Please enter what you want to find." });
    }
    if (!location || !String(location).trim()) {
      return res.status(400).json({ success: false, message: "Please share a location or use your current location." });
    }
    if (!API_KEY) {
      return res.status(500).json({ success: false, message: "Geoapify API key is missing in backend .env." });
    }

    // Dynamic Radius Calculation (1km - 100km)
    const safeRadiusKm = Math.min(Math.max(Number(radius) || DEFAULT_RADIUS_KM, 1), 100);
    const radiusMeters = safeRadiusKm * 1000;

    const resolved = await resolveLocation(location);
    const { latitude, longitude } = resolved;

    const normalized = normalizeSearchQuery(query);
    const detected = detectCategories(normalized, category);
    const categories = detected?.cats || null;
    const filterTerms = detected?.filter || null;
    const nameCandidate = extractNameCandidate(normalized);

    console.log("\n========== SEARCH ==========");
    console.log("[input]", JSON.stringify({
      raw: query, normalized, categories, filterTerms, nameCandidate, radius: `${safeRadiusKm}km`
    }));

    // Fallback if nothing detected
    if (!categories && !nameCandidate) {
      const textFeatures = await searchByText(normalized, latitude, longitude, radiusMeters);
      const textPlaces = textFeatures.map((f) => normalizeFeature(f, latitude, longitude, "text")).filter(Boolean);

      if (textPlaces.length === 0) {
        return res.json({
          success: true, query, normalizedQuery: normalized,
          nameCandidate, category: category || null,
          location: resolved.displayName, count: 0, results: [],
          message: "I couldn't find anything for that search. Try being specific.",
          _debug: { categoriesDetected: null, nameCandidateDetected: null, codeVersion: CODE_VERSION },
        });
      }

      const ranked = rankAndDedupe(textPlaces, null);
      const enriched = await enrichTopPlaces(ranked);
      const cleaned = enriched.map(({ _fromNameSearch, _fromTextSearch, _nameScore, ...rest }) => rest);

      return res.json({
        success: true, query, normalizedQuery: normalized,
        nameCandidate, category: category || null,
        location: resolved.displayName, count: cleaned.length, results: cleaned,
        _debug: { fallbackUsed: "text-only", codeVersion: CODE_VERSION },
      });
    }

    // Main search (Category + Name)
    const [categoryFeatures, nameFeatures] = await Promise.all([
      categories ? searchByCategories(categories, latitude, longitude, radiusMeters) : Promise.resolve([]),
      nameCandidate ? searchByName(nameCandidate, categories, latitude, longitude, radiusMeters) : Promise.resolve([]),
    ]);

    let all = [
      ...categoryFeatures.map((f) => normalizeFeature(f, latitude, longitude, "category")),
      ...nameFeatures.map((f) => normalizeFeature(f, latitude, longitude, "name")),
    ].filter(Boolean);

    // Final Fallback if both returned 0
    if (all.length === 0) {
      console.log("[fallback] category + name both returned 0 → trying text search");
      const textFeatures = await searchByText(normalized, latitude, longitude, radiusMeters);
      all = textFeatures.map((f) => normalizeFeature(f, latitude, longitude, "text")).filter(Boolean);
    }

    let ranked = rankAndDedupe(all, nameCandidate);

    // Strict Name matching filter
    if (nameCandidate) {
      const nc = nameCandidate.toLowerCase();
      const exact = ranked.filter((p) => p.name.toLowerCase().includes(nc));
      if (exact.length > 0) ranked = exact;
    }

    // Apply category filters (e.g., for gyms)
    if (filterTerms) {
      ranked = applyCategoryFilter(ranked, filterTerms);
    }

    // Enrich top places with phone/web/hours
    ranked = await enrichTopPlaces(ranked, MAX_DETAIL_LOOKUPS);

    const finalPlaces = ranked.map(({ _fromNameSearch, _fromTextSearch, _nameScore, ...rest }) => rest);

    console.log("[result]", finalPlaces.length, "places");
    console.log("============================\n");

    return res.json({
      success: true,
      query, normalizedQuery: normalized, nameCandidate,
      category: category || null,
      location: resolved.displayName,
      count: finalPlaces.length,
      results: finalPlaces,
      message: finalPlaces.length === 0 ? "No matching places found nearby. Try a different search or a larger area." : undefined,
      _debug: {
        categoriesDetected: categories,
        filterDetected: filterTerms,
        nameCandidateDetected: nameCandidate,
        categoryFeaturesCount: categoryFeatures.length,
        nameFeaturesCount: nameFeatures.length,
        radiusKm: safeRadiusKm,
        codeVersion: CODE_VERSION,
      },
    });
  } catch (error) {
    if (error.name === "AbortError") {
      return res.status(504).json({ success: false, message: "The request took too long. Please try again." });
    }
    console.error("Search error:", error.message);
    return res.status(500).json({ success: false, message: error.message || "Something went wrong." });
  }
});

// =====================================================================
// FALLBACK HANDLERS & START SERVER
// =====================================================================

app.use((req, res) => {
  res.status(404).json({ success: false, message: "API route not found." });
});

app.use((err, req, res, next) => {
  console.error("Unhandled error:", err);
  res.status(500).json({ success: false, message: "Unexpected server error." });
});

app.listen(PORT, () => {
  console.log(`NearMe AI backend running at http://localhost:${PORT}`);
  console.log(`Code version: ${CODE_VERSION}`);
  console.log(`Geoapify API key configured: ${Boolean(API_KEY)}`);
});