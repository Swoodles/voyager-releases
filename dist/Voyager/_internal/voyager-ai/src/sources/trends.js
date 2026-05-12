// src/sources/trends.js
const { BaseAdapter } = require('./base-adapter');

class TrendsAdapter extends BaseAdapter {
  constructor() {
    super('trends');
    this.serpApiKey = process.env.SERP_API_KEY || '';
  }

  async fetch(query, geoMeta, options = {}) {
    if (!this.serpApiKey) { console.warn('[trends] No SerpAPI key'); return []; }

    const params = new URLSearchParams({
      engine: 'google_trends', q: query, api_key: this.serpApiKey,
      geo: geoMeta.countryCode || 'US', data_type: 'TIMESERIES', date: 'now 3-m',
    });

    try {
      const res  = await this.fetchWithTimeout(`https://serpapi.com/search.json?${params}`);
      if (!res.ok) return [];
      const data = await res.json();
      const timeline = data.interest_over_time?.timeline_data || [];
      if (!timeline.length) return [];

      const values  = timeline.map(t => t.values?.[0]?.extracted_value || 0);
      const last4   = values.slice(-4);
      const prev4   = values.slice(-8, -4);
      const avgLast = avg(last4);
      const avgPrev = avg(prev4) || 1;
      const momentum = avgLast / avgPrev;

      return [{
        id:               this.buildId(`trend_${query.replace(/\s+/g,'_')}`),
        name:             `Trend signal: ${query}`,
        category:         'signal',
        sourceId:         this.sourceId,
        rating:           null,
        reviewCount:      0,
        localReviewRatio: 0.5,
        trendScore:       Math.min(avgLast / 100, 1),
        trending:         momentum > 1.2,
        momentum:         Math.round(momentum * 100) / 100,
        authorityBadges:  [],
      }];
    } catch (e) { console.error('[trends]', e.message); return []; }
  }
}

function avg(arr) {
  return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
}

module.exports = TrendsAdapter;
