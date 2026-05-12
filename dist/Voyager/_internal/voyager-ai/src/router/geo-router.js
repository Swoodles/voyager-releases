// src/router/geo-router.js
// Reads sources.json config — zero country logic hardcoded here.
// To add a new region, add it to sources.json only.

const sourcesConfig = require('../config/sources.json');

// City/region → country code lookup table
// Add cities here; the source routing is handled entirely by sources.json
const CITY_TO_COUNTRY = {
  // Japan
  tokyo: 'JP', osaka: 'JP', kyoto: 'JP', sapporo: 'JP', fukuoka: 'JP',
  yokohama: 'JP', nagoya: 'JP', kobe: 'JP', nara: 'JP', hiroshima: 'JP',
  // Korea
  seoul: 'KR', busan: 'KR', incheon: 'KR', jeju: 'KR', daegu: 'KR',
  // China
  beijing: 'CN', shanghai: 'CN', shenzhen: 'CN', chengdu: 'CN',
  guangzhou: 'CN', hangzhou: 'CN', xian: 'CN', chongqing: 'CN',
  // France
  paris: 'FR', lyon: 'FR', marseille: 'FR', bordeaux: 'FR', nice: 'FR',
  toulouse: 'FR', strasbourg: 'FR', nantes: 'FR', lille: 'FR',
  // Italy
  rome: 'IT', milan: 'IT', florence: 'IT', venice: 'IT', naples: 'IT',
  bologna: 'IT', turin: 'IT', amalfi: 'IT', sicily: 'IT',
  // Spain
  madrid: 'ES', barcelona: 'ES', seville: 'ES', valencia: 'ES',
  bilbao: 'ES', granada: 'ES', malaga: 'ES', ibiza: 'ES',
  // Germany
  berlin: 'DE', munich: 'DE', hamburg: 'DE', frankfurt: 'DE',
  cologne: 'DE', stuttgart: 'DE', dusseldorf: 'DE',
  // UK
  london: 'GB', edinburgh: 'GB', manchester: 'GB', birmingham: 'GB',
  liverpool: 'GB', bristol: 'GB', glasgow: 'GB', oxford: 'GB',
  // Mexico
  'mexico city': 'MX', cdmx: 'MX', guadalajara: 'MX', monterrey: 'MX',
  cancun: 'MX', oaxaca: 'MX', tulum: 'MX',
  // Thailand
  bangkok: 'TH', 'chiang mai': 'TH', phuket: 'TH', pattaya: 'TH',
  // US cities
  'new york': 'US', 'new york city': 'US', nyc: 'US',
  'los angeles': 'US', la: 'US',
  chicago: 'US', 'san francisco': 'US', sf: 'US',
  miami: 'US', boston: 'US', seattle: 'US', portland: 'US',
  austin: 'US', nashville: 'US', denver: 'US', atlanta: 'US',
  'las vegas': 'US', 'new orleans': 'US', washington: 'US',
  // Australia
  sydney: 'AU', melbourne: 'AU', brisbane: 'AU', perth: 'AU',
  adelaide: 'AU', 'gold coast': 'AU',
};

// Country name/demonym → country code
const COUNTRY_TO_CODE = {
  japan: 'JP', japanese: 'JP',
  korea: 'KR', 'south korea': 'KR', korean: 'KR',
  china: 'CN', chinese: 'CN',
  france: 'FR', french: 'FR',
  italy: 'IT', italian: 'IT',
  spain: 'ES', spanish: 'ES',
  germany: 'DE', german: 'DE',
  uk: 'GB', 'united kingdom': 'GB', england: 'GB', british: 'GB',
  mexico: 'MX', mexican: 'MX',
  thailand: 'TH', thai: 'TH',
  usa: 'US', 'united states': 'US', america: 'US', american: 'US',
  australia: 'AU', australian: 'AU',
};

/**
 * Detect country code from a query string + optional IP country fallback.
 *
 * @param {string}  query
 * @param {string}  [ipCountry]   ISO-2 from ipapi
 * @returns {{ countryCode, countryName, lang, localSources, searchLangFilter }}
 */
function detectGeo(query, ipCountry = null) {
  const q = query.toLowerCase();

  // 1. Direct city match
  for (const [city, code] of Object.entries(CITY_TO_COUNTRY)) {
    if (q.includes(city)) return buildResult(code);
  }

  // 2. Country name/demonym match
  for (const [name, code] of Object.entries(COUNTRY_TO_CODE)) {
    if (q.includes(name)) return buildResult(code);
  }

  // 3. IP country fallback
  if (ipCountry) {
    const code = ipCountry.toUpperCase();
    if (sourcesConfig.regions[code]) return buildResult(code);
  }

  // 4. Default US
  return buildResult('US');
}

/**
 * Get the ordered source list for a country + category combination.
 *
 * @param {string} countryCode   ISO-2
 * @param {string} category      e.g. 'restaurants', 'cafes', 'all'
 * @returns {string[]}           ordered source IDs
 */
function getSourcesForRegion(countryCode, category = 'all') {
  const region = sourcesConfig.regions[countryCode];
  if (!region) return sourcesConfig.defaults.all;

  const cat = normaliseCategory(category);
  return region[cat] || region.all || sourcesConfig.defaults.all;
}

/**
 * Get authority and signal metadata for a source.
 */
function getSourceMetadata(sourceId) {
  return sourcesConfig.sourceMetadata[sourceId] || {
    authority: 0.50, localSignal: 0.50, touristSignal: 0.50,
  };
}

// ── Internal helpers ──────────────────────────────────────────────────────────

function buildResult(code) {
  const region = sourcesConfig.regions[code] || {};
  const lang   = (region.languages || ['en'])[0];
  return {
    countryCode:      code,
    countryName:      region.label || code,
    lang,
    searchLangFilter: lang !== 'en' ? lang : null,
  };
}

function normaliseCategory(cat) {
  const MAP = {
    restaurant: 'restaurants', restaurants: 'restaurants',
    cafe: 'cafes', cafes: 'cafes', coffee: 'cafes',
    bar: 'bars', bars: 'bars', pub: 'bars', pubs: 'bars', nightlife: 'bars',
    hotel: 'hotels', hotels: 'hotels', accommodation: 'hotels',
    attraction: 'attractions', attractions: 'attractions',
    museum: 'attractions', museums: 'attractions',
    bakery: 'bakeries', bakeries: 'bakeries', pastry: 'bakeries',
    event: 'events', events: 'events',
    general: 'all',
  };
  return MAP[cat?.toLowerCase()] || 'all';
}

module.exports = { detectGeo, getSourcesForRegion, getSourceMetadata, normaliseCategory };
