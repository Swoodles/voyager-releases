// src/sources/base-adapter.js
// Abstract base class for all data source adapters.
// Each adapter normalises its output to the standard CandidateSchema.

const config = require('../config/sources.json');

/**
 * Standard candidate schema — every source returns this shape.
 *
 * @typedef {Object} Candidate
 * @property {string}   id              - Unique identifier (source:external_id)
 * @property {string}   name            - Place name
 * @property {string}   category        - Normalised category
 * @property {string}   sourceId        - Which adapter produced this
 * @property {number}   rating          - 0–5 normalised rating
 * @property {number}   reviewCount     - Total review count
 * @property {number}   localReviewRatio - 0–1 estimate of local-language reviews
 * @property {string}   [address]
 * @property {string}   [city]
 * @property {number}   [lat]
 * @property {number}   [lng]
 * @property {string}   [priceRange]    - '$' | '$$' | '$$$' | '$$$$'
 * @property {string[]} [features]      - e.g. ['outdoor seating', 'dog-friendly']
 * @property {string}   [description]   - Short description from source
 * @property {string}   [imageUrl]
 * @property {string}   [website]
 * @property {string}   [phone]
 * @property {object}   [hours]
 * @property {string[]} [authorityBadges] - e.g. ['michelin_1_star', 'tabelog_gold']
 * @property {boolean}  [isOpen]
 * @property {string}   [lastReviewDate] - ISO date string
 * @property {number}   [trendScore]    - 0–1 trending signal
 * @property {object}   [rawData]       - Original source data (debug only)
 */

class BaseAdapter {
  constructor(sourceId) {
    if (new.target === BaseAdapter) {
      throw new Error('BaseAdapter is abstract');
    }
    this.sourceId = sourceId;
    this.meta     = config.sourceMetadata[sourceId] || {
      authority: 0.50, localSignal: 0.50, touristSignal: 0.50,
    };
    this.timeout  = parseInt(process.env.SOURCE_TIMEOUT_MS || 8000);
  }

  /**
   * Main fetch method — must be implemented by subclass.
   * @param {string}  query
   * @param {object}  geoMeta   - { countryCode, lang, ... }
   * @param {object}  [options]
   * @returns {Promise<Candidate[]>}
   */
  async fetch(query, geoMeta, options = {}) {
    throw new Error(`${this.sourceId}.fetch() not implemented`);
  }

  /**
   * Normalise a rating to 0–5 scale.
   * @param {number} raw      - Raw rating from source
   * @param {number} maxRaw   - Max possible rating (default 5)
   */
  normaliseRating(raw, maxRaw = 5) {
    if (raw == null) return null;
    return Math.round((raw / maxRaw) * 5 * 10) / 10;
  }

  /**
   * Normalise price to $–$$$$ string.
   * @param {number|string} price  - Could be 1–4 int, ¥range, $range, etc.
   */
  normalisePrice(price) {
    if (!price) return null;
    if (typeof price === 'number') {
      return ['$', '$$', '$$$', '$$$$'][Math.min(price - 1, 3)] || '$$';
    }
    const p = String(price);
    if (p.includes('$$$$') || p.includes('4')) return '$$$$';
    if (p.includes('$$$') || p.includes('3'))  return '$$$';
    if (p.includes('$$') || p.includes('2'))   return '$$';
    return '$';
  }

  /**
   * Build a standard candidate ID.
   */
  buildId(externalId) {
    return `${this.sourceId}:${externalId}`;
  }

  /**
   * Estimate local review ratio from language distribution metadata.
   * Falls back to source metadata signal weight.
   *
   * @param {object} languageData  - e.g. { ja: 0.80, en: 0.20 }
   * @param {string} localLang     - Expected local language code
   */
  estimateLocalRatio(languageData, localLang) {
    if (languageData && localLang && languageData[localLang] != null) {
      return languageData[localLang];
    }
    return this.meta.localSignal; // fallback to source-level signal
  }

  /**
   * Timeout-wrapped fetch.
   */
  async fetchWithTimeout(url, options = {}) {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), this.timeout);
    try {
      return await fetch(url, { ...options, signal: controller.signal });
    } finally {
      clearTimeout(id);
    }
  }
}

module.exports = { BaseAdapter };
