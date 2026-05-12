// src/sources/foursquare.js
const { BaseAdapter } = require('./base-adapter');

class FoursquareAdapter extends BaseAdapter {
  constructor() {
    super('foursquare');
    this.apiKey  = process.env.FOURSQUARE_API_KEY || '';
    this.baseUrl = 'https://api.foursquare.com/v3/places/search';
  }

  async fetch(query, geoMeta, options = {}) {
    if (!this.apiKey) { console.warn('[foursquare] No API key'); return []; }

    const params = new URLSearchParams({
      query, limit: options.limit || 10,
      ...(geoMeta.countryCode ? { near: geoMeta.countryName } : {}),
    });

    try {
      const res = await this.fetchWithTimeout(`${this.baseUrl}?${params}`, {
        headers: { Authorization: this.apiKey, Accept: 'application/json' },
      });
      if (!res.ok) return [];
      const data = await res.json();
      return (data.results || []).map(p => this.normalise(p));
    } catch (e) { console.error('[foursquare]', e.message); return []; }
  }

  normalise(p) {
    const priceMap = { 1:'$', 2:'$$', 3:'$$$', 4:'$$$$' };
    return {
      id:               this.buildId(p.fsq_id),
      name:             p.name,
      category:         p.categories?.[0]?.name || 'place',
      sourceId:         this.sourceId,
      rating:           p.rating ? p.rating / 2 : null, // Foursquare is 0–10
      reviewCount:      p.stats?.total_ratings || 0,
      localReviewRatio: this.meta.localSignal,
      address:          [p.location?.address, p.location?.locality].filter(Boolean).join(', '),
      lat:              p.geocodes?.main?.latitude  || null,
      lng:              p.geocodes?.main?.longitude || null,
      priceRange:       priceMap[p.price] || null,
      website:          p.website || null,
      phone:            p.tel || null,
      description:      p.description || null,
      imageUrl:         null,
      isOpen:           p.hours?.open_now ?? null,
      authorityBadges:  [],
    };
  }
}

module.exports = FoursquareAdapter;
