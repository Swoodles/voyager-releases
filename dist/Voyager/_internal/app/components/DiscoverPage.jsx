// frontend/components/DiscoverPage.jsx
// Drop-in integration example for the Voyager Discover page.
// Shows "Discovering in: Paris, France" with category tabs
// and auto-populates with AI-scored ScoreCards.
//
// Merge this logic into your existing Discover page component.

import React, { useState } from 'react';
import { useDiscover } from '../hooks/useDiscover';
import ScoreCard       from './ScoreCard';

const CATEGORIES = ['Restaurants', 'Cafés', 'Attractions', 'Bars', 'Bakeries', 'Museums'];

/**
 * @param {{ location: string }} props
 *   location — passed from your app state, e.g. 'Paris, France'
 */
export default function DiscoverPage({ location = 'Paris, France' }) {
  const [activeCategory, setActiveCategory] = useState(CATEGORIES[0]);

  const { items, loading, error, refresh } = useDiscover({
    location,
    category: activeCategory,
    limit:    6,
  });

  return (
    <div style={{ padding: '0 16px' }}>

      {/* ── Header ─────────────────────────────────────────────────── */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 13, color: '#6b7280' }}>Discovering in:</div>
        <div style={{ fontSize: 18, fontWeight: 700, color: '#f9fafb' }}>{location}</div>
      </div>

      {/* ── Category tabs ───────────────────────────────────────────── */}
      <div style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 8, marginBottom: 16 }}>
        {CATEGORIES.map(cat => (
          <button
            key={cat}
            onClick={() => setActiveCategory(cat)}
            style={{
              padding: '6px 14px', borderRadius: 20, border: 'none',
              cursor: 'pointer', whiteSpace: 'nowrap', fontSize: 13,
              background: activeCategory === cat ? '#3b82f6' : '#1f2937',
              color:      activeCategory === cat ? '#fff'    : '#9ca3af',
              fontWeight: activeCategory === cat ? 600       : 400,
              transition: 'background 0.15s',
            }}
          >
            {cat}
          </button>
        ))}
      </div>

      {/* ── Content ─────────────────────────────────────────────────── */}
      {loading && (
        <div style={{ color: '#6b7280', fontSize: 13, textAlign: 'center', padding: 32 }}>
          <div style={{ marginBottom: 8 }}>✦ Voyager AI is analysing sources…</div>
          <LoadingPulse />
        </div>
      )}

      {error && !loading && (
        <div style={{
          padding: 16, borderRadius: 8,
          background: '#1f0000', border: '1px solid #7f1d1d',
          color: '#fca5a5', fontSize: 13,
        }}>
          {error}
          <button
            onClick={refresh}
            style={{ marginLeft: 12, color: '#93c5fd', background: 'none', border: 'none', cursor: 'pointer' }}
          >
            Retry
          </button>
        </div>
      )}

      {!loading && !error && items.length === 0 && (
        <div style={{ color: '#4b5563', fontSize: 13, textAlign: 'center', padding: 32 }}>
          No results yet — AI backend may be starting up.
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {items.map((item, i) => (
          <ScoreCard key={item.place_name || i} result={item} />
        ))}
      </div>
    </div>
  );
}

function LoadingPulse() {
  return (
    <div style={{ display: 'flex', justifyContent: 'center', gap: 6 }}>
      {[0, 1, 2].map(i => (
        <div
          key={i}
          style={{
            width: 8, height: 8, borderRadius: '50%', background: '#3b82f6',
            animation: `pulse 1.2s ease-in-out ${i * 0.2}s infinite`,
          }}
        />
      ))}
      <style>{`@keyframes pulse { 0%,100%{opacity:.3;transform:scale(.8)} 50%{opacity:1;transform:scale(1)} }`}</style>
    </div>
  );
}
