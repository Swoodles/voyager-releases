// src/sources/google-places.js
const { BaseAdapter } = require('./base-adapter');

class GooglePlacesAdapter extends BaseAdapter {
  constructor() {
    super('google_places');
    this.apiKey  = process.env.GOOGLE_PLACES_API_KEY || '';
    this.baseUrl = 'https://places.googleapis.com/v1/places:searchText';
  }

  async fetch(query, geoMeta, options = {}) {
    if (!this.apiKey) {
      console.warn('[google_places] No API key — skipping');
      return [];
    }

    const body = {
      textQuery:           query,
      languageCode:        geoMeta.lang || 'en',
      regionCode:          (geoMeta.countryCode || 'US').toLowerCase(),
      maxResultCount:      options.limit || 10,
      includedType:        options.placeType || undefined,
    };

    try {
      const res = await this.fetchWithTimeout(this.baseUrl, {
        method:  'POST',
        headers: {
          'Content-Type':     'application/json',
          'X-Goog-Api-Key':   this.apiKey,
          'X-Goog-FieldMask': [
            'places.id', 'places.displayName', 'places.formattedAddress',
            'places.rating', 'places.userRatingCount', 'places.priceLevel',
            'places.types', 'places.websiteUri', 'places.internationalPhoneNumber',
            'places.currentOpeningHours', 'places.regularOpeningHours',
            'places.location', 'places.primaryType', 'places.editorialSummary',
            'places.photos',
          ].join(','),
        },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        console.error(`[google_places] HTTP ${res.status}`);
        return [];
      }

      const data = await res.json();
      return (data.places || []).map(p => this.normalise(p, geoMeta));
    } catch (err) {
      console.error('[google_places] Error:', err.message);
      return [];
    }
  }

  normalise(p, geoMeta) {
    const priceMap = { PRICE_LEVEL_INEXPENSIVE: '$', PRICE_LEVEL_MODERATE: '$$',
                       PRICE_LEVEL_EXPENSIVE: '$$$', PRICE_LEVEL_VERY_EXPENSIVE: '$$$$' };
    return {
      id:               this.buildId(p.id),
      name:             p.displayName?.text || 'Unknown',
      category:         p.primaryType || p.types?.[0] || 'place',
      sourceId:         this.sourceId,
      rating:           p.rating || null,
      reviewCount:      p.userRatingCount || 0,
      localReviewRatio: this.meta.localSignal, // Google doesn't expose language distribution
      address:          p.formattedAddress || null,
      lat:              p.location?.latitude  || null,
      lng:              p.location?.longitude || null,
      priceRange:       priceMap[p.priceLevel] || null,
      website:          p.websiteUri || null,
      phone:            p.internationalPhoneNumber || null,
      description:      p.editorialSummary?.text || null,
      imageUrl:         p.photos?.[0] ? this.buildPhotoUrl(p.photos[0].name) : null,
      isOpen:           p.currentOpeningHours?.openNow ?? null,
      authorityBadges:  [],
    };
  }

  buildPhotoUrl(name) {
    return `https://places.googleapis.com/v1/${name}/media?maxWidthPx=400&key=${this.apiKey}`;
  }
}

module.exports = GooglePlacesAdapter;
