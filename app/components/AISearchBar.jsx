// frontend/components/AISearchBar.jsx
// The bottom Voyager AI search bar with expandable Params panel.
// Params sliders feed directly into the pipeline as scoring weight overrides.
//
// Merge / replace your existing bottom search bar component with this.

import React, { useState } from 'react';
import { useAISearch } from '../hooks/useAISearch';
import ScoreCard       from './ScoreCard';

const PRIORITIES = ['Balanced', 'Quality', 'Budget', 'Trending', 'Local Pick'];

export default function AISearchBar() {
  const {
    query, setQuery,
    weights, setWeight,
    priority, setPriority,
    result, loading, error,
    search, clear,
  } = useAISearch();

  const [paramsOpen, setParamsOpen] = useState(false);

  function handleKeyDown(e) {
    if (e.key === 'Enter') search();
  }

  return (
    <div style={{ position: 'relative' }}>

      {/* ── Result card (floats above the bar) ─────────────────────── */}
      {result && (
        <div style={{ marginBottom: 12 }}>
          <ScoreCard result={result} />
          <button
            onClick={clear}
            style={{ marginTop: 6, fontSize: 11, color: '#6b7280', background: 'none', border: 'none', cursor: 'pointer' }}
          >
            ✕ Clear result
          </button>
        </div>
      )}

      {/* ── Error ──────────────────────────────────────────────────── */}
      {error && (
        <div style={{
          marginBottom: 8, padding: '8px 12px', borderRadius: 8,
          background: '#1f0000', border: '1px solid #7f1d1d',
          color: '#fca5a5', fontSize: 12,
        }}>
          {error}
        </div>
      )}

      {/* ── Params panel ───────────────────────────────────────────── */}
      {paramsOpen && (
        <div style={{
          marginBottom: 8, padding: 14, borderRadius: 10,
          background: '#111827', border: '1px solid #1f2937',
        }}>
          <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 10 }}>Scoring weights</div>

          {Object.entries(weights).map(([key, val]) => (
            <SliderRow
              key={key}
              label={`${key.charAt(0).toUpperCase() + key.slice(1)} ${Math.round(val * 100)}%`}
              value={val}
              onChange={v => setWeight(key, v)}
            />
          ))}

          <div style={{ marginTop: 12 }}>
            <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 6 }}>Priority</div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {PRIORITIES.map(p => (
                <button
                  key={p}
                  onClick={() => setPriority(p)}
                  style={{
                    padding: '4px 10px', borderRadius: 16, border: 'none',
                    cursor: 'pointer', fontSize: 12,
                    background: priority === p ? '#3b82f6' : '#1f2937',
                    color:      priority === p ? '#fff'    : '#9ca3af',
                  }}
                >
                  {p}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── Search bar ─────────────────────────────────────────────── */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8,
        background: '#111827', borderRadius: 12,
        border: '1px solid #1f2937', padding: '8px 12px',
      }}>
        {/* Params toggle */}
        <button
          onClick={() => setParamsOpen(o => !o)}
          title="Scoring parameters"
          style={{
            width: 32, height: 32, borderRadius: 8, border: 'none',
            background: paramsOpen ? '#1d4ed8' : '#1f2937',
            color: paramsOpen ? '#fff' : '#9ca3af',
            cursor: 'pointer', fontSize: 14, flexShrink: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
        >
          ⚙
        </button>

        {/* Input */}
        <input
          type="text"
          placeholder="Voyager AI — Ask anything or search: best ramen in Tokyo..."
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          style={{
            flex: 1, background: 'transparent', border: 'none', outline: 'none',
            color: '#f9fafb', fontSize: 13,
          }}
        />

        {/* Search / loading button */}
        <button
          onClick={() => search()}
          disabled={loading || !query.trim()}
          style={{
            padding: '6px 14px', borderRadius: 8, border: 'none',
            background: loading ? '#1f2937' : '#3b82f6',
            color: '#fff', fontSize: 13, fontWeight: 600,
            cursor: loading ? 'default' : 'pointer',
            opacity: !query.trim() ? 0.5 : 1,
            flexShrink: 0,
          }}
        >
          {loading ? '…' : 'Search'}
        </button>
      </div>
    </div>
  );
}

// ── Slider row ────────────────────────────────────────────────────────────────
function SliderRow({ label, value, onChange }) {
  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
        <span style={{ fontSize: 12, color: '#d1d5db' }}>{label}</span>
      </div>
      <input
        type="range" min="0" max="1" step="0.05"
        value={value}
        onChange={e => onChange(parseFloat(e.target.value))}
        style={{ width: '100%', accentColor: '#3b82f6' }}
      />
    </div>
  );
}
