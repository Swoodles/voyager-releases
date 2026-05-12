// frontend/components/ScoreCard.jsx
// Displays a Voyager AI result card with:
//  - Local score / Tourist score split
//  - Authority badges (Michelin, etc.)
//  - Trending flag
//  - Pros / cons preview
//  - One-line summary

import React, { useState } from 'react';

// ── Colour helpers ────────────────────────────────────────────────────────────
function scoreColor(score) {
  if (score >= 90) return '#4ade80';   // green
  if (score >= 80) return '#a3e635';   // lime
  if (score >= 70) return '#facc15';   // yellow
  if (score >= 60) return '#fb923c';   // orange
  return '#f87171';                    // red
}

function recommendationLabel(rec) {
  const MAP = {
    must_visit:         { label: 'Must Visit',        bg: '#14532d', color: '#4ade80' },
    highly_recommended: { label: 'Highly Recommended', bg: '#1e3a5f', color: '#60a5fa' },
    recommended:        { label: 'Recommended',        bg: '#2d2d2d', color: '#d1d5db' },
    decent:             { label: 'Decent',             bg: '#292524', color: '#a8a29e' },
    skip:               { label: 'Skip It',            bg: '#3b0000', color: '#fca5a5' },
  };
  return MAP[rec] || MAP['recommended'];
}

// ── Sub-components ────────────────────────────────────────────────────────────

function ScorePill({ label, score }) {
  return (
    <div style={{ textAlign: 'center', minWidth: 70 }}>
      <div style={{
        fontSize: 28, fontWeight: 700,
        color: scoreColor(score), lineHeight: 1,
      }}>
        {score}
      </div>
      <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 2, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
        {label}
      </div>
    </div>
  );
}

function AuthorityBadge({ label }) {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      padding: '2px 8px', borderRadius: 99,
      background: '#1c1c1c', border: '1px solid #374151',
      fontSize: 11, color: '#e5e7eb', fontWeight: 500,
    }}>
      {label}
    </span>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

/**
 * @param {{ result: VoyagerResult, onClick?: Function }} props
 */
export default function ScoreCard({ result, onClick }) {
  const [expanded, setExpanded] = useState(false);
  if (!result) return null;

  const {
    place_name, place_type, one_line,
    local_score, tourist_score, score_gap, score_gap_explanation,
    recommendation, trending, trending_reason,
    authority_signals = [],
    local_sentiment, tourist_sentiment,
    what_makes_it_good,
    price_range,
  } = result;

  const recStyle = recommendationLabel(recommendation);

  return (
    <div
      onClick={() => { setExpanded(e => !e); onClick?.(); }}
      style={{
        background: '#111827', borderRadius: 12,
        border: '1px solid #1f2937',
        padding: '16px 18px', cursor: 'pointer',
        transition: 'border-color 0.15s',
        userSelect: 'none',
      }}
    >
      {/* ── Header ─────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
        <div style={{ flex: 1 }}>
          {place_name && (
            <div style={{ fontSize: 16, fontWeight: 600, color: '#f9fafb', marginBottom: 2 }}>
              {place_name}
            </div>
          )}
          {place_type && (
            <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 6 }}>
              {place_type}{price_range ? ` · ${price_range}` : ''}
            </div>
          )}
          <div style={{ fontSize: 13, color: '#9ca3af', lineHeight: 1.45 }}>{one_line}</div>
        </div>

        {/* Scores */}
        <div style={{ display: 'flex', gap: 16, flexShrink: 0 }}>
          <ScorePill label="Local"   score={local_score}   />
          <ScorePill label="Tourist" score={tourist_score} />
        </div>
      </div>

      {/* ── Score gap callout ───────────────────────────────────────── */}
      {Math.abs(score_gap) >= 8 && score_gap_explanation && (
        <div style={{
          marginTop: 10, padding: '7px 10px', borderRadius: 6,
          background: '#0f172a', border: '1px solid #1e3a5f',
          fontSize: 12, color: '#93c5fd',
        }}>
          {score_gap > 0 ? '🏠 Locals love it more: ' : '✈️ Tourists rate it higher: '}
          {score_gap_explanation}
        </div>
      )}

      {/* ── Badges row ──────────────────────────────────────────────── */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 10 }}>
        {/* Recommendation badge */}
        <span style={{
          padding: '2px 9px', borderRadius: 99,
          background: recStyle.bg, color: recStyle.color,
          fontSize: 11, fontWeight: 600,
        }}>
          {recStyle.label}
        </span>

        {/* Trending */}
        {trending && (
          <span style={{
            padding: '2px 9px', borderRadius: 99,
            background: '#3b1f00', color: '#fb923c',
            fontSize: 11, fontWeight: 600,
          }}>
            🔥 Trending
          </span>
        )}

        {/* Authority */}
        {authority_signals.slice(0, 3).map(sig => (
          <AuthorityBadge key={sig} label={sig} />
        ))}
      </div>

      {/* ── Expanded details ────────────────────────────────────────── */}
      {expanded && (
        <div style={{ marginTop: 14, borderTop: '1px solid #1f2937', paddingTop: 12 }}>

          {what_makes_it_good && (
            <p style={{ fontSize: 13, color: '#d1d5db', marginBottom: 10 }}>
              {what_makes_it_good}
            </p>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            {/* Local sentiment */}
            {local_sentiment && (
              <SentimentColumn
                title="Local Take"
                sentiment={local_sentiment}
                accent="#4ade80"
              />
            )}
            {/* Tourist sentiment */}
            {tourist_sentiment && (
              <SentimentColumn
                title="Tourist Take"
                sentiment={tourist_sentiment}
                accent="#60a5fa"
              />
            )}
          </div>

          {trending_reason && (
            <div style={{ marginTop: 10, fontSize: 12, color: '#fb923c' }}>
              🔥 {trending_reason}
            </div>
          )}
        </div>
      )}

      {/* Expand hint */}
      <div style={{ marginTop: 8, fontSize: 11, color: '#374151', textAlign: 'right' }}>
        {expanded ? '▲ less' : '▼ more'}
      </div>
    </div>
  );
}

function SentimentColumn({ title, sentiment, accent }) {
  return (
    <div>
      <div style={{ fontSize: 12, fontWeight: 600, color: accent, marginBottom: 6 }}>{title}</div>
      {(sentiment.pros || []).slice(0, 3).map(p => (
        <div key={p} style={{ fontSize: 12, color: '#d1d5db', marginBottom: 2 }}>✓ {p}</div>
      ))}
      {(sentiment.cons || []).slice(0, 2).map(c => (
        <div key={c} style={{ fontSize: 12, color: '#9ca3af', marginBottom: 2 }}>✗ {c}</div>
      ))}
      {sentiment.translated_from && (
        <div style={{ fontSize: 11, color: '#6b7280', marginTop: 4 }}>
          Translated from {sentiment.translated_from}
        </div>
      )}
    </div>
  );
}
