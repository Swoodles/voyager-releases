// src/sources/reddit.js
const { BaseAdapter } = require('./base-adapter');

class RedditAdapter extends BaseAdapter {
  constructor() {
    super('reddit');
    this.clientId  = process.env.REDDIT_CLIENT_ID  || '';
    this.secret    = process.env.REDDIT_SECRET      || '';
    this._token    = null;
    this._tokenExp = 0;
  }

  async fetch(query, geoMeta, options = {}) {
    const token = await this._getToken();
    if (!token) { console.warn('[reddit] No credentials'); return []; }

    const params = new URLSearchParams({
      q: `${query} recommendation OR review OR best`,
      sort: 'top', t: 'year', limit: 8, type: 'link',
    });

    try {
      const res = await this.fetchWithTimeout(
        `https://oauth.reddit.com/search?${params}`,
        { headers: { Authorization: `Bearer ${token}`, 'User-Agent': 'VoyagerAI/2.0' } }
      );
      if (!res.ok) return [];
      const data = await res.json();
      const posts = (data.data?.children || []).map(c => c.data);
      return this._extractMentions(posts, query);
    } catch (e) { console.error('[reddit]', e.message); return []; }
  }

  // Convert Reddit posts into light candidate signals (not full place records)
  _extractMentions(posts, query) {
    return [{
      id:               this.buildId(`reddit_signal_${Date.now()}`),
      name:             `Reddit community signal: ${query}`,
      category:         'signal',
      sourceId:         this.sourceId,
      rating:           null,
      reviewCount:      posts.length,
      localReviewRatio: 0.5,
      trendScore:       Math.min(posts.reduce((s, p) => s + p.score, 0) / 5000, 1),
      redditPosts:      posts.slice(0, 5).map(p => ({
        title:    p.title,
        score:    p.score,
        comments: p.num_comments,
        url:      `https://reddit.com${p.permalink}`,
        snippet:  (p.selftext || '').slice(0, 300),
      })),
      authorityBadges: [],
    }];
  }

  async _getToken() {
    if (this._token && Date.now() < this._tokenExp) return this._token;
    if (!this.clientId || !this.secret) return null;
    const creds = Buffer.from(`${this.clientId}:${this.secret}`).toString('base64');
    try {
      const res  = await fetch('https://www.reddit.com/api/v1/access_token', {
        method: 'POST',
        headers: { Authorization: `Basic ${creds}`, 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'VoyagerAI/2.0' },
        body: 'grant_type=client_credentials',
      });
      const d = await res.json();
      this._token    = d.access_token;
      this._tokenExp = Date.now() + (d.expires_in - 60) * 1000;
      return this._token;
    } catch { return null; }
  }
}

module.exports = RedditAdapter;
