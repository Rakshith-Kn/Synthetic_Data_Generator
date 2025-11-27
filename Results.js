// src/Results.js
import React, { useMemo, useState } from "react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
} from "recharts";

/**
 * Results.js (synthetic-only view)
 * - Shows only synthetic dataset table (first N rows)
 * - Shows distribution chart (smooth area / mountain) for a chosen numeric feature from synthetic data
 * - Computes basic overlap/quality heuristic IF originalData is provided (but does NOT display original table)
 * - Compact privacy stats area (re-identification heuristic if original available)
 */

function downloadCSV(rows = [], filename = "synthetic_data.csv") {
  if (!rows || !rows.length) {
    const blob = new Blob([""], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
    return;
  }
  const header = Object.keys(rows[0]);
  const csv = [
    header.join(","),
    ...rows.map((r) =>
      header
        .map((h) => {
          const v = r[h] === null || r[h] === undefined ? "" : String(r[h]).replace(/"/g, '""');
          return `"${v}"`;
        })
        .join(",")
    ),
  ].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function computeHistogramPercent(rows, key, bins = 40, globalRange = null) {
  const vals = rows
    .map((r) => {
      const v = r[key];
      const n = Number(v);
      return Number.isFinite(n) ? n : null;
    })
    .filter((v) => v !== null);

  if (!vals.length) return [];

  const min = globalRange ? globalRange.min : Math.min(...vals);
  const max = globalRange ? globalRange.max : Math.max(...vals);
  const range = max - min || 1;
  const binWidth = range / bins;
  const counts = new Array(bins).fill(0);

  vals.forEach((v) => {
    let idx = Math.floor((v - min) / binWidth);
    if (idx < 0) idx = 0;
    if (idx >= bins) idx = bins - 1;
    counts[idx]++;
  });

  const total = vals.length;
  const result = counts.map((count, i) => {
    const center = min + (i + 0.5) * binWidth;
    const percent = (count / total) * 100;
    return { binIndex: i, x: Number(center.toFixed(3)), percent: Number(percent.toFixed(3)) };
  });

  return result;
}

function smoothSeries(series, window = 5) {
  if (!series || series.length <= 1) return series;
  const out = [];
  const n = series.length;
  for (let i = 0; i < n; i++) {
    let start = Math.max(0, i - Math.floor(window / 2));
    let end = Math.min(n - 1, i + Math.floor(window / 2));
    let sum = 0;
    let cnt = 0;
    for (let j = start; j <= end; j++) {
      sum += series[j].percent;
      cnt++;
    }
    out.push({ ...series[i], percent: Number((sum / cnt).toFixed(3)) });
  }
  return out;
}

export default function Results({ username, originalData = [], syntheticData = [], setSyntheticData, goBack }) {
  const [selectedFeature, setSelectedFeature] = useState("Hemoglobin");
  const [bins, setBins] = useState(50);
  const [showOverlapHighlight, setShowOverlapHighlight] = useState(true);

  // candidates for numeric features common in Thalassemia dataset
  const numericFeatures = useMemo(() => {
    // derive from syntheticData keys if possible
    if (syntheticData && syntheticData.length) {
      const sample = syntheticData[0];
      const numKeys = Object.keys(sample).filter((k) => {
        const v = sample[k];
        return typeof v === "number" || (!Number.isNaN(Number(v)) && String(v).trim() !== "");
      });
      // prefer known features
      const preferred = ["Hemoglobin", "MCV", "MCH", "RBC", "Ferritin"];
      const ordered = preferred.filter((p) => numKeys.includes(p)).concat(numKeys.filter((k) => !preferred.includes(k)));
      return ordered.length ? ordered : ["Hemoglobin", "MCV", "MCH"];
    }
    return ["Hemoglobin", "MCV", "MCH", "RBC", "Ferritin"];
  }, [syntheticData]);

  // ensure selectedFeature valid
  const feature = useMemo(() => (numericFeatures.includes(selectedFeature) ? selectedFeature : numericFeatures[0]), [selectedFeature, numericFeatures]);

  // compute histograms for synthetic data (and original if available to compute overlap)
  const { synthHist, origHistAligned, globalRange } = useMemo(() => {
    // compute global range across both datasets if original provided
    const allVals = [];
    if (originalData && originalData.length) {
      originalData.forEach((r) => {
        const n = Number(r[feature]);
        if (Number.isFinite(n)) allVals.push(n);
      });
    }
    if (syntheticData && syntheticData.length) {
      syntheticData.forEach((r) => {
        const n = Number(r[feature]);
        if (Number.isFinite(n)) allVals.push(n);
      });
    }
    const range = allVals.length ? { min: Math.min(...allVals), max: Math.max(...allVals) } : null;

    const sHist = computeHistogramPercent(syntheticData || [], feature, bins, range);
    const oHist = range ? computeHistogramPercent(originalData || [], feature, bins, range) : [];

    return { synthHist: smoothSeries(sHist, 5), origHistAligned: smoothSeries(oHist, 5), globalRange: range };
  }, [originalData, syntheticData, feature, bins]);

  // heuristic quality score: overlap percent between synthetic and original histograms
  const qualityScore = useMemo(() => {
    if (!origHistAligned || !origHistAligned.length || !synthHist || !synthHist.length) return null;
    let overlap = 0;
    for (let i = 0; i < Math.min(origHistAligned.length, synthHist.length); i++) {
      overlap += Math.min(origHistAligned[i].percent, synthHist[i].percent);
    }
    return Math.round(overlap); // percent
  }, [origHistAligned, synthHist]);

  // simple privacy heuristic (nearest-neighbor fraction) - only if original present
  const privacyRisk = useMemo(() => {
    if (!originalData || !originalData.length || !syntheticData || !syntheticData.length) return null;

    // quick z-score normalization on numeric features used as quasi-identifiers
    const keys = ["Hemoglobin", "MCV", "MCH", "RBC", "Ferritin"].filter((k) => syntheticData[0] && k in syntheticData[0]);
    if (!keys.length) return null;

    const stats = {};
    keys.forEach((k) => {
      const vals = originalData.map((r) => Number(r[k])).filter((v) => Number.isFinite(v));
      const mean = vals.reduce((s, v) => s + v, 0) / Math.max(1, vals.length);
      const std = Math.sqrt(vals.reduce((s, v) => s + (v - mean) * (v - mean), 0) / Math.max(1, vals.length)) || 1;
      stats[k] = { mean, std };
    });

    const toVec = (row) => keys.map((k) => (Number.isFinite(Number(row[k])) ? (Number(row[k]) - stats[k].mean) / stats[k].std : 0));

    const origVecs = originalData.map((r) => toVec(r));
    const synthVecs = syntheticData.map((r) => toVec(r));

    const dist = (a, b) => {
      let s = 0;
      for (let i = 0; i < a.length; i++) {
        const d = (a[i] || 0) - (b[i] || 0);
        s += d * d;
      }
      return Math.sqrt(s);
    };

    // compute nearest original distance for each synthetic row
    const dists = synthVecs.map((sv) => {
      let minD = Infinity;
      for (const ov of origVecs) {
        const dd = dist(sv, ov);
        if (dd < minD) minD = dd;
      }
      return minD;
    });

    // choose threshold from original-original nearest neighbor distances (median)
    const origNearest = origVecs.map((ov, i) => {
      let best = Infinity;
      for (let j = 0; j < origVecs.length; j++) {
        if (i === j) continue;
        const dd = dist(ov, origVecs[j]);
        if (dd < best) best = dd;
      }
      return best === Infinity ? 0 : best;
    }).filter((v) => v > 0);

    const baseline = origNearest.length ? origNearest.sort((a,b)=>a-b)[Math.floor(origNearest.length/2)] : 1.0;
    // risk: fraction of synthetic rows whose nearest-original distance < baseline * 0.6 (tunable)
    const threshold = Math.max(0.0001, baseline * 0.6);
    const flagged = dists.filter((d) => d < threshold).length;
    const riskPercent = Math.round((flagged / dists.length) * 100);
    return { riskPercent, threshold: Number(threshold.toFixed(3)), flagged };
  }, [originalData, syntheticData]);

  const previewSynthetic = useMemo(() => (syntheticData && syntheticData.length ? syntheticData.slice(0, 100) : []), [syntheticData]);

  const renderValue = (v) => (v === null || v === undefined || v === "" ? "-" : String(v));

  return (
    <div style={{ padding: 26, fontFamily: "Poppins, sans-serif", color: "#0b2239" }}>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
        <div>
          <h1 style={{ margin: 0 }}>Synthetic Data — Preview</h1>
          <div style={{ color: "#475569", marginTop: 6 }}>User: <strong>{username || "Researcher"}</strong></div>
        </div>

        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: 14, color: "#475569" }}>
            Synthetic rows: <strong>{(syntheticData || []).length}</strong>
          </div>
          <div style={{ marginTop: 8 }}>
            <button
              onClick={() => downloadCSV(syntheticData || [], "synthetic_data.csv")}
              style={{ padding: "8px 12px", background: "#05668d", color: "#fff", border: "none", borderRadius: 6 }}
            >
              Download Synthetic CSV
            </button>
            {goBack && (
              <button onClick={goBack} style={{ marginLeft: 8, padding: "8px 12px", background: "#e2e8f0", border: "none", borderRadius: 6 }}>
                Back
              </button>
            )}
          </div>
        </div>
      </header>

      <section style={{ display: "grid", gridTemplateColumns: "1fr 360px", gap: 20 }}>
        {/* Left: Distribution Chart */}
        <div style={{ background: "#fff", padding: 16, borderRadius: 12, boxShadow: "0px 6px 20px rgba(8,32,50,0.06)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <h3 style={{ margin: 0 }}>Distribution — Synthetic ({feature})</h3>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <label style={{ color: "#475569", fontSize: 13 }}>Bins</label>
              <input type="number" min="10" max="200" value={bins} onChange={(e) => setBins(Number(e.target.value || 50))} style={{ width: 70, padding: 6 }} />
            </div>
          </div>

          <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 12 }}>
            <label style={{ color: "#475569" }}>Feature:</label>
            <select value={feature} onChange={(e) => setSelectedFeature(e.target.value)} style={{ padding: 8, borderRadius: 6 }}>
              {numericFeatures.map((f) => (
                <option value={f} key={f}>{f}</option>
              ))}
            </select>

            <label style={{ marginLeft: 8, color: "#475569" }}>
              <input type="checkbox" checked={showOverlapHighlight} onChange={(e) => setShowOverlapHighlight(e.target.checked)} style={{ marginRight: 6 }} />
              Show overlap highlight (if original provided)
            </label>
          </div>

          <div style={{ height: 360 }}>
            {(!synthHist || !synthHist.length) ? (
              <div style={{ display: "flex", height: "100%", alignItems: "center", justifyContent: "center", color: "#94a3b8" }}>
                <div>No numeric data available in synthetic dataset for the selected feature.</div>
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart
                  data={synthHist.map((d) => ({ x: d.x, synthetic: d.percent }))}
                  margin={{ top: 10, right: 30, left: 0, bottom: 0 }}
                >
                  <defs>
                    <linearGradient id="colorSynthOnly" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#00A3FF" stopOpacity={0.9}/>
                      <stop offset="95%" stopColor="#00A3FF" stopOpacity={0.18}/>
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#edf2f7" />
                  <XAxis dataKey="x" tickFormatter={(v) => Number(v).toFixed(1)} />
                  <YAxis unit="%" />
                  <Tooltip formatter={(value) => `${value}%`} />
                  <Legend />
                  <Area type="monotone" dataKey="synthetic" stroke="#0077b6" fill="url(#colorSynthOnly)" strokeWidth={2} />
                  {/* If original present and overlay requested, draw faded original outline for internal comparison (not table) */}
                  {origHistAligned && origHistAligned.length && showOverlapHighlight && (
                    <Area
                      type="monotone"
                      dataKey={(d, i) => (origHistAligned[i] ? origHistAligned[i].percent : 0)}
                      stroke="#00C49F"
                      fill="#00C49F"
                      fillOpacity={0.12}
                      strokeDasharray="3 3"
                      isAnimationActive={false}
                    />
                  )}
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>

          <div style={{ marginTop: 12, color: "#475569", fontSize: 13 }}>
            The chart shows the percentage distribution of the selected feature across synthetic rows.
            {originalData && originalData.length ? " A faint overlay of the original distribution is shown if available (internal only)." : ""}
          </div>
        </div>

        {/* Right: Quality & Privacy */}
        <aside style={{ background: "#fff", padding: 16, borderRadius: 12, boxShadow: "0px 6px 20px rgba(8,32,50,0.06)" }}>
          <h3 style={{ marginTop: 0 }}>Quality & Privacy</h3>

          <div style={{ marginTop: 8 }}>
            <div style={{ fontSize: 13, color: "#64748b" }}>Similarity (distribution overlap)</div>
            <div style={{ fontSize: 22, fontWeight: 700, color: "#0b6e6a", marginTop: 6 }}>
              {qualityScore === null ? "N/A" : `${qualityScore}%`}
            </div>
            <div style={{ color: "#94a3b8", fontSize: 12, marginTop: 6 }}>
              Overlap % between original & synthetic histograms for the selected feature (higher = more similar).
            </div>
          </div>

          <div style={{ marginTop: 14 }}>
            <div style={{ fontSize: 13, color: "#64748b" }}>Privacy (re-identification heuristic)</div>
            {privacyRisk === null ? (
              <div style={{ marginTop: 8, color: "#94a3b8" }}>No original data available — cannot compute privacy risk.</div>
            ) : (
              <div style={{ marginTop: 8 }}>
                <div style={{ fontWeight: 700, fontSize: 18 }}>{privacyRisk.riskPercent}%</div>
                <div style={{ color: "#94a3b8", fontSize: 12, marginTop: 6 }}>
                  Fraction of synthetic rows flagged as unusually close to an original row (quick NN heuristic).
                </div>
                <div style={{ marginTop: 8, fontSize: 12 }}>
                  <div>Threshold used: <strong>{privacyRisk.threshold}</strong></div>
                  <div>Flagged rows: <strong>{privacyRisk.flagged}</strong> / {syntheticData.length}</div>
                </div>
              </div>
            )}
          </div>

          <div style={{ marginTop: 14 }}>
            <button
              onClick={() => {
                // small client-side reset of synthetic data if setter provided
                if (typeof setSyntheticData === "function") {
                  setSyntheticData([]);
                }
              }}
              style={{ padding: "8px 12px", background: "#e6f6f4", border: "none", borderRadius: 6, marginRight: 8 }}
            >
              Reset Synthetic Preview
            </button>
            <button
              onClick={() => downloadCSV(syntheticData || [], "synthetic_data.csv")}
              style={{ padding: "8px 12px", background: "#05668d", color: "#fff", border: "none", borderRadius: 6 }}
            >
              Download CSV
            </button>
          </div>
        </aside>
      </section>

      {/* Synthetic table */}
      <section style={{ marginTop: 26 }}>
        <div style={{ textAlign: "center", marginBottom: 12 }}>
          <h3 style={{ margin: 0 }}>Synthetic Data Preview — first {Math.min(100, previewSynthetic.length)} rows</h3>
          <div style={{ color: "#64748b", marginTop: 6 }}>Only synthetic data is shown here.</div>
        </div>

        <div style={{ overflowX: "auto", display: "flex", justifyContent: "center" }}>
          <table style={{ borderCollapse: "collapse", width: "90%", maxWidth: 1200, background: "#fff", borderRadius: 8, overflow: "hidden" }}>
            <thead>
              <tr style={{ background: "#f1f5f9", textAlign: "left" }}>
                {previewSynthetic.length ? Object.keys(previewSynthetic[0]).map((c) => (
                  <th key={c} style={{ padding: "12px 10px", borderBottom: "1px solid #e6eef6", fontSize: 13 }}>{c}</th>
                )) : <th style={{ padding: 12 }}>No synthetic data</th>}
              </tr>
            </thead>
            <tbody>
              {previewSynthetic.map((row, i) => (
                <tr key={i} style={{ background: i % 2 === 0 ? "#ffffff" : "#fbfdff" }}>
                  {Object.keys(row).map((k) => (
                    <td key={k} style={{ padding: "10px 8px", borderBottom: "1px solid #f1f5f9", fontSize: 13 }}>{renderValue(row[k])}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
