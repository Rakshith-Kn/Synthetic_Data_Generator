// src/PrivacyReport.js
import React, { useRef } from "react";
import jsPDF from "jspdf";
import html2canvas from "html2canvas";

/**
 * PrivacyReport
 * Props:
 * - open (bool)
 * - onClose (fn)
 * - metrics: { similarityScore, privacyMetrics: { reidRiskPercent, attrRiskPercent, threshold }, distributionData }
 * - originalData (array)
 * - syntheticData (array)
 */
export default function PrivacyReport({
  open,
  onClose,
  metrics = {},
  originalData = [],
  syntheticData = [],
}) {
  const { similarityScore = 0, privacyMetrics = {}, distributionData = {} } = metrics;
  const { reidRiskPercent = 0, attrRiskPercent = 0, threshold = 0 } = privacyMetrics;
  const containerRef = useRef();

  if (!open) return null;

  // small helper to build rare combos sample
  const computeRareCombos = () => {
    try {
      const orig = originalData || [];
      if (!orig.length) return [];

      // find categorical columns (heuristic: treat non-numeric as categorical)
      const keys = Object.keys(orig[0] || {});
      const numericKeys = keys.filter((k) => typeof orig[0][k] === "number" || !isNaN(Number(orig[0][k])));
      const categoricalKeys = keys.filter((k) => !numericKeys.includes(k));

      const comboCounts = {};
      orig.forEach((r) => {
        const combo = categoricalKeys.map((c) => String(r[c] ?? "")).join("||");
        comboCounts[combo] = (comboCounts[combo] || 0) + 1;
      });

      const rare = Object.entries(comboCounts)
        .filter(([_, cnt]) => cnt / Math.max(1, orig.length) < 0.05)
        .slice(0, 12)
        .map(([combo, cnt]) => ({ combo: combo.split("||").join(" | "), count: cnt }));

      return rare;
    } catch (e) {
      return [];
    }
  };

  const rareCombos = computeRareCombos();

  const downloadPDF = async () => {
    const el = containerRef.current;
    if (!el) return;
    // increase scale for better resolution
    const canvas = await html2canvas(el, { scale: 2, useCORS: true, logging: false });
    const imgData = canvas.toDataURL("image/png");

    const pdf = new jsPDF({
      orientation: "portrait",
      unit: "pt",
      format: "a4",
    });

    const pageW = pdf.internal.pageSize.getWidth();
    const pageH = pdf.internal.pageSize.getHeight();

    const imgProps = pdf.getImageProperties(imgData);
    const imgW = pageW - 40;
    const imgH = (imgProps.height * imgW) / imgProps.width;

    pdf.addImage(imgData, "PNG", 20, 20, imgW, imgH);
    pdf.save("privacy_report.pdf");
  };

  return (
    <div className="popup-overlay" role="dialog" aria-modal="true">
      <div className="popup-box" style={{ maxWidth: 960, width: "96%" }} ref={containerRef}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
          <h3 style={{ margin: 0 }}>Full Privacy Report</h3>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={downloadPDF} style={{ padding: "6px 10px", borderRadius: 8, background: "#0b74ff", color: "white" }}>
              ⬇ Download PDF
            </button>
            <button onClick={onClose} style={{ padding: "6px 10px", borderRadius: 8 }}>Close</button>
          </div>
        </div>

        <section style={{ marginTop: 8 }}>
          <strong>Executive summary</strong>
          <p style={{ marginTop: 6 }}>
            Similarity (utility): <strong>{similarityScore}%</strong>.
            Re-identification and attribute disclosure percentages indicate the level of privacy risk.
          </p>
        </section>

        <section style={{ display: "flex", gap: 12, marginTop: 12 }}>
          <div style={{ flex: 1, padding: 12, background: "#fbfdff", borderRadius: 8 }}>
            <div style={{ color: "#6b7280", fontSize: 13 }}>Re-identification Risk</div>
            <div style={{ fontWeight: 700, fontSize: 22, color: reidRiskPercent <= 5 ? "#0b8a4e" : "#b87a00" }}>
              {reidRiskPercent}%
            </div>
            <div style={{ color: "#718096", fontSize: 12 }}>Threshold ≈ {threshold}</div>
            <p style={{ marginTop: 8, fontSize: 12 }}>
              Percentage of synthetic rows that are unusually close to a real row (nearest-neighbor heuristic).
            </p>
          </div>

          <div style={{ flex: 1, padding: 12, background: "#fbfdff", borderRadius: 8 }}>
            <div style={{ color: "#6b7280", fontSize: 13 }}>Attribute Disclosure Risk</div>
            <div style={{ fontWeight: 700, fontSize: 22, color: attrRiskPercent <= 5 ? "#0b8a4e" : "#b87a00" }}>
              {attrRiskPercent}%
            </div>
            <div style={{ color: "#718096", fontSize: 12 }}>Rare combos leaked</div>
            <p style={{ marginTop: 8, fontSize: 12 }}>
              Fraction of synthetic rows that reproduce rare categorical combinations from the original dataset.
            </p>
          </div>
        </section>

        <section style={{ marginTop: 12 }}>
          <strong>Detected rare attribute combinations (sample)</strong>
          <div style={{ marginTop: 8, maxHeight: 120, overflow: "auto", background: "#fff", padding: 8, borderRadius: 8 }}>
            {rareCombos.length === 0 ? (
              <div style={{ color: "#6b7280" }}>No rare combos detected (or insufficient data).</div>
            ) : (
              <ul style={{ margin: 0, paddingLeft: 14 }}>
                {rareCombos.map((r, idx) => (
                  <li key={idx}><strong>{r.combo}</strong> — {r.count} row(s)</li>
                ))}
              </ul>
            )}
          </div>
        </section>

        <section style={{ marginTop: 12 }}>
          <strong>Recommendations</strong>
          <ol style={{ marginTop: 8 }}>
            <li>Apply k-anonymity (k ≥ 5) on quasi-identifiers (Age bucket, Sex, Genotype).</li>
            <li>If re-identification risk is high, add calibrated noise to sensitive numeric columns (DP or Gaussian noise).</li>
            <li>Remove or transform synthetic rows with NN distance below threshold.</li>
            <li>Annotate shared datasets with metadata: generation model, quality score, privacy score.</li>
          </ol>
        </section>

        <section style={{ marginTop: 12 }}>
          <strong>Snapshot — synthetic data (top columns)</strong>
          <div style={{ marginTop: 8, background: "#fff", padding: 8, borderRadius: 8, maxHeight: 160, overflow: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
              <thead>
                <tr>
                  {(syntheticData[0] ? Object.keys(syntheticData[0]).slice(0, 8) : ["Patient_ID"]).map((h) => (
                    <th key={h} style={{ textAlign: "left", padding: 6, borderBottom: "1px solid #eef2ff" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(syntheticData || []).slice(0, 6).map((r, i) => (
                  <tr key={i}>
                    {Object.keys(syntheticData[0] || {}).slice(0, 8).map((c) => (
                      <td key={c} style={{ padding: 6, borderBottom: "1px solid #fbfdff" }}>{String(r[c] ?? "")}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <footer style={{ marginTop: 12, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ color: "#6b7280", fontSize: 12 }}>
            Note: This is an in-browser privacy report. For production-grade verification, run server-side privacy validations with DP/K-anonymity enforced.
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={downloadPDF} style={{ padding: "8px 12px", borderRadius: 8, background: "#0b74ff", color: "white" }}>
              Download PDF
            </button>
            <button onClick={onClose} style={{ padding: "8px 12px", borderRadius: 8 }}>Close</button>
          </div>
        </footer>
      </div>
    </div>
  );
}
