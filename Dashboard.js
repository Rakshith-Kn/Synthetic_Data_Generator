import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useDropzone } from "react-dropzone";
import Papa from "papaparse";
import * as XLSX from "xlsx";

/**
 * Dashboard.js (updated)
 * - Detects likely Thalassemia per-row
 * - Generates synthetic data and preserves Thalassemia signature when detected
 * - Keeps Patient_ID ordering, CSV/XLSX parsing, training simulation
 */

export default function Dashboard({
  username,
  originalData,
  setOriginalData,
  syntheticData,
  setSyntheticData,
}) {
  const navigate = useNavigate();

  const [file, setFile] = useState(null);
  const [rowsToGenerate, setRowsToGenerate] = useState(100);
  const [trainingProgress, setTrainingProgress] = useState(0);
  const [isTraining, setIsTraining] = useState(false);

  // Keep only necessary Thalassemia columns
  const COLUMN_CANDIDATES = {
    Patient_ID: ["patient_id", "patient id", "id", "patientid", "sampleid", "Patient_ID", "PatientID"],
    Gender: ["gender", "sex", "Gender", "Sex"],
    Genotype: ["genotype", "mutation", "Genotype", "Mutation", "phenotype", "Phenotype"],
    Hemoglobin: ["hemoglobin", "hb", "hgb", "Hemoglobin", "Hb", "HGB"],
    MCV: ["mcv", "MCV", "mean corpuscular volume", "m.c.v"],
    MCH: ["mch", "MCH", "mean corpuscular hemoglobin", "m.c.h"],
    RBC: ["rbc", "rbc_count", "rbc count", "RBC", "RBC Count"],
    Ferritin: ["ferritin", "Ferritin", "serum ferritin"],
  };

  // normalize row values
  const normalizeRow = (row) => {
    const out = {};
    Object.keys(row).forEach((k) => {
      const v = row[k];
      if (v === null || v === undefined) {
        out[k] = v;
        return;
      }
      if (typeof v === "string") {
        const t = v.trim();
        if (t === "") out[k] = "";
        else if (!Number.isNaN(Number(t))) out[k] = Number(t);
        else out[k] = t;
      } else {
        out[k] = v;
      }
    });
    return out;
  };

  const parseCSVFile = (fileBlob) =>
    new Promise((resolve) => {
      Papa.parse(fileBlob, {
        header: true,
        dynamicTyping: false,
        skipEmptyLines: true,
        complete: (res) => {
          const rows = (res.data || []).map((r) => normalizeRow(r));
          resolve(rows);
        },
      });
    });

  const parseXLSXFile = (fileBlob) =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const data = e.target.result;
          const workbook = XLSX.read(data, { type: "array" });
          const sheetName = workbook.SheetNames[0];
          const worksheet = workbook.Sheets[sheetName];
          const json = XLSX.utils.sheet_to_json(worksheet, { defval: "" });
          const rows = json.map((r) => normalizeRow(r));
          resolve(rows);
        } catch (err) {
          reject(err);
        }
      };
      reader.onerror = (err) => reject(err);
      reader.readAsArrayBuffer(fileBlob);
    });

  // improved column mapping; logs mapping for debug
  const mapColumns = (headerFields) => {
    const lowerMap = {};
    headerFields.forEach((h) => {
      if (h == null) return;
      lowerMap[h.toString().toLowerCase()] = h;
    });

    const mapping = {};
    Object.entries(COLUMN_CANDIDATES).forEach(([std, candidates]) => {
      // exact match
      for (const cand of candidates) {
        const key = cand.toString().toLowerCase();
        if (key in lowerMap) {
          mapping[std] = lowerMap[key];
          break;
        }
      }
      // substring fallback
      if (!mapping[std]) {
        for (const cand of candidates) {
          const key = cand.toString().toLowerCase();
          const foundHeader = Object.keys(lowerMap).find((h) => h.includes(key));
          if (foundHeader) {
            mapping[std] = lowerMap[foundHeader];
            break;
          }
        }
      }
    });

    console.info("Column mapping detected:", mapping);
    return mapping;
  };

  // select and clean, and add Likely_Thalassemia flag
  const selectAndClean = (rows) => {
    if (!rows || !rows.length) return [];

    const header = Object.keys(rows[0]);
    const mapping = mapColumns(header);

    const standardized = rows.map((r) => {
      const out = {};
      Object.keys(COLUMN_CANDIDATES).forEach((std) => {
        if (mapping[std]) {
          const val = r[mapping[std]];
          if (val === null || val === undefined || String(val).trim() === "" || String(val).toLowerCase() === "na") {
            out[std] = "";
          } else {
            out[std] = val;
          }
        } else {
          out[std] = "";
        }
      });
      if (!out["Patient_ID"] || String(out["Patient_ID"]).trim() === "") out["Patient_ID"] = null;
      return out;
    });

    const filtered = standardized.filter((row) =>
      Object.values(row).some((v) => v !== null && v !== undefined && String(v).trim() !== "")
    );

    const final = filtered.map((r, i) => {
      const copy = { ...r };
      if (!copy["Patient_ID"]) copy["Patient_ID"] = `P${String(i + 1).padStart(3, "0")}`;

      // categorical defaults
      const categorical = ["Gender", "Genotype"];
      categorical.forEach((c) => {
        if (!copy[c] || String(copy[c]).trim() === "") copy[c] = "Unknown";
      });

      // numeric normalization
      const numericKeys = ["Hemoglobin", "MCV", "MCH", "RBC", "Ferritin"];
      numericKeys.forEach((k) => {
        if (copy[k] === "" || copy[k] === null || copy[k] === undefined) {
          copy[k] = "";
        } else {
          const n = Number(copy[k]);
          copy[k] = Number.isFinite(n) ? n : String(copy[k]).trim();
        }
      });

      // detect likely thalassemia for this row
      copy["Likely_Thalassemia"] = isLikelyThalassemia(copy);

      return copy;
    });

    console.info(`Cleaned ${final.length} rows. Sample:`, final.slice(0, 5));
    return final;
  };

  // Rule-based detector: returns true if row matches Thalassemia signature
  // This is intentionally conservative: requires multiple signals.
  const isLikelyThalassemia = (row) => {
    // if numeric missing, treat as not matching
    const hb = Number(row["Hemoglobin"]);
    const mcv = Number(row["MCV"]);
    const mch = Number(row["MCH"]);
    const rbc = Number(row["RBC"]);
    const ferritin = Number(row["Ferritin"]);

    let score = 0;

    // typical thalassemia trait signatures (tunable)
    if (!Number.isNaN(mcv) && mcv > 0 && mcv <= 80) score += 1;        // microcytosis
    if (!Number.isNaN(mch) && mch > 0 && mch <= 27) score += 1;        // hypochromia
    if (!Number.isNaN(hb) && hb > 0 && hb <= 12) score += 1;          // mild anemia (trait ranges)
    if (!Number.isNaN(rbc) && rbc > 4.0) score += 1;                  // relatively high RBC common in traits
    // low ferritin strongly suggests iron deficiency instead — decrease score if ferritin very low
    if (!Number.isNaN(ferritin) && ferritin < 15) score -= 1;

    // require at least 2 positive signals and non-negative net score
    return score >= 2;
  };

  // medical-aware noise (Thal-aware when requested)
  const applyMedicalNoise = (key, value, preserveThal = false) => {
    if (value === "" || value === null || value === undefined || value === "NA") return value;
    const num = Number(value);
    if (Number.isNaN(num)) return value;

    // default ranges and noise
    const commonRanges = {
      Hemoglobin: { min: 5, max: 18, noisePct: 0.08 },
      MCV: { min: 50, max: 110, noisePct: 0.06 },
      MCH: { min: 15, max: 40, noisePct: 0.07 },
      RBC: { min: 2.5, max: 8.0, noisePct: 0.06 },
      Ferritin: { min: 5, max: 5000, noisePct: 0.12 },
    };

    // If we want to strongly preserve thalassemia signature, shrink noise and clip to narrower thal ranges
    const thalRanges = {
      Hemoglobin: { min: 7.0, max: 13.0, noisePct: 0.06 },
      MCV: { min: 55, max: 80, noisePct: 0.04 },
      MCH: { min: 18, max: 27, noisePct: 0.05 },
      RBC: { min: 4.0, max: 7.5, noisePct: 0.05 },
      Ferritin: { min: 10, max: 2000, noisePct: 0.10 },
    };

    const config = preserveThal ? (thalRanges[key] || commonRanges[key]) : (commonRanges[key] || null);

    let newVal = num;
    if (config) {
      const pct = config.noisePct;
      const noise = (Math.random() * 2 - 1) * pct * Math.max(1, num);
      newVal = num + noise;
      // small jitter for low values
      if (num < 10) newVal = num + (Math.random() * 0.5 - 0.25);
      newVal = Math.max(config.min, Math.min(config.max, newVal));
      if (key === "Hemoglobin") newVal = Math.round(newVal * 100) / 100;
      else if (key === "Ferritin") newVal = Math.round(newVal * 10) / 10;
      else newVal = Math.round(newVal * 1000) / 1000;
    } else {
      // fallback small noise
      const noise = (Math.random() * 0.1 - 0.05) * num;
      newVal = Math.round((num + noise) * 1000) / 1000;
    }

    return newVal;
  };

  // generate synthetic rows; if base row is likely thal, preserve thal signature
  const generateSyntheticFromOriginal = (origRows, numRows) => {
    const numericKeys = ["Hemoglobin", "MCV", "MCH", "RBC", "Ferritin"];
    const categoricalKeys = ["Gender", "Genotype"];

    // categorical distributions
    const catChoices = {};
    categoricalKeys.forEach((k) => {
      const map = {};
      origRows.forEach((r) => {
        const v = r[k] ?? "Unknown";
        map[v] = (map[v] || 0) + 1;
      });
      const entries = Object.entries(map).map(([key, weight]) => ({ key, weight }));
      catChoices[k] = entries.length ? entries : [{ key: "Unknown", weight: 1 }];
    });

    // numeric bases (means)
    const numericBases = {};
    numericKeys.forEach((k) => {
      const vals = origRows
        .map((r) => {
          const v = r[k];
          const n = Number(v);
          return Number.isFinite(n) ? n : null;
        })
        .filter((v) => v !== null);
      if (vals.length) {
        const mean = vals.reduce((s, x) => s + x, 0) / vals.length;
        numericBases[k] = { mean, vals };
      } else {
        numericBases[k] = { mean: 0, vals: [] };
      }
    });

    const synth = [];
    for (let i = 0; i < numRows; i++) {
      const base = origRows[i % origRows.length] || origRows[0];
      const preserveThal = !!base["Likely_Thalassemia"];

      const row = {};
      row["Patient_ID"] = `P${String(i + 1).padStart(3, "0")}`;

      // numeric: if preserveThal true then narrower thal-aware noise+clip
      numericKeys.forEach((k) => {
        const baseVal = base[k];
        const raw = baseVal === "" || baseVal === null || baseVal === undefined ? numericBases[k].mean : Number(baseVal);
        row[k] = applyMedicalNoise(k, raw, preserveThal);
      });

      // categorical: sample from global distribution but bias to base when preserveThal
      categoricalKeys.forEach((k) => {
        const choices = catChoices[k] || [{ key: base[k] ?? "Unknown", weight: 1 }];
        // If preserving thal, increase weight of the base's category slightly (to keep genotype link)
        const weighted = choices.map(c => ({ key: c.key, weight: c.weight }));
        if (preserveThal && base[k]) {
          const baseKey = base[k];
          const found = weighted.find(w => w.key === baseKey);
          if (found) found.weight = found.weight * 1.4;
          else weighted.push({ key: baseKey, weight: 1.4 });
        }

        const total = weighted.reduce((s, c) => s + c.weight, 0);
        let pick = Math.random() * total;
        let selected = weighted[weighted.length - 1].key;
        for (const ch of weighted) {
          pick -= ch.weight;
          if (pick <= 0) {
            selected = ch.key;
            break;
          }
        }
        row[k] = selected;
      });

      // keep a flag so Results can show why this was generated as Thal
      row["Likely_Thalassemia"] = preserveThal;

      synth.push(row);
    }

    return synth;
  };

  // handle file drop
  const onDrop = async (acceptedFiles) => {
    const f = acceptedFiles[0];
    if (!f) return;
    setFile(f);

    const name = (f.name || "").toLowerCase();
    try {
      let rows = [];
      if (name.endsWith(".csv")) rows = await parseCSVFile(f);
      else if (name.endsWith(".xlsx") || name.endsWith(".xls")) rows = await parseXLSXFile(f);
      else rows = await parseCSVFile(f);

      const cleaned = selectAndClean(rows);

      if (cleaned.length === 0) {
        alert("Parsed file contains no usable rows. Please check the file format/contents.");
        setOriginalData([]);
        return;
      }

      setOriginalData(cleaned);
      setSyntheticData([]);
    } catch (err) {
      console.error("File parse error:", err);
      alert("Failed to parse uploaded file. Make sure it's a valid CSV/XLSX file.");
      setOriginalData([]);
    }
  };

  const { getRootProps, getInputProps } = useDropzone({
    onDrop,
    accept: {
      "text/csv": [".csv"],
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [".xlsx"],
      "application/vnd.ms-excel": [".xls"],
    },
    multiple: false,
  });

  const simulateTraining = () => {
    setIsTraining(true);
    setTrainingProgress(0);
    const total = 60;
    let step = 0;
    const timer = setInterval(() => {
      step++;
      setTrainingProgress(Math.min(100, Math.round((step / total) * 100)));
      if (step >= total) {
        clearInterval(timer);
        setIsTraining(false);
        setTrainingProgress(100);
      }
    }, 50);
  };

  const handleGenerate = async () => {
    if (!file) return alert("Please upload a CSV/XLSX file first.");
    if (!rowsToGenerate || rowsToGenerate <= 0) return alert("Enter how many rows to generate.");

    // re-parse to ensure latest file content
    let parseResult = [];
    try {
      const name = (file.name || "").toLowerCase();
      if (name.endsWith(".csv")) parseResult = await parseCSVFile(file);
      else if (name.endsWith(".xlsx") || name.endsWith(".xls")) parseResult = await parseXLSXFile(file);
      else parseResult = await parseCSVFile(file);
    } catch (err) {
      console.error(err);
    }

    const cleaned = selectAndClean(parseResult || []);
    setOriginalData(cleaned);

    if (!cleaned.length) {
      alert("No usable rows found after cleaning. Check your file and try again.");
      return;
    }

    simulateTraining();

    setTimeout(async () => {
      // try backend first (if available)
      try {
        const resp = await fetch("http://localhost:5000/generate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ rows: rowsToGenerate, original: cleaned }),
        });
        if (resp.ok) {
          const json = await resp.json();
          if (json.syntheticData) {
            const synth = json.syntheticData.map((r, i) => ({
              Patient_ID: r.Patient_ID || `P${String(i + 1).padStart(3, "0")}`,
              ...r,
            }));
            setSyntheticData(synth);
            navigate("/results");
            return;
          }
        }
      } catch (e) {
        // backend not available -> fallback
      }

      // frontend fallback generation (Thal-aware)
      const synth = generateSyntheticFromOriginal(cleaned, rowsToGenerate);
      setSyntheticData(synth);
      navigate("/results");
    }, 3200);
  };

  const handleLogout = () => navigate("/");

  return (
    <div className="dashboard-page">
      <header className="dashboard-header">
        <div>
          <h1 className="title">Welcome, <span className="username">{username || "Researcher"}</span> 👋</h1>
          <p className="subtitle">Ready to generate privacy-preserving synthetic Thalassemia data?</p>
        </div>
        <div className="header-actions">
          <button className="ghost-btn" onClick={handleLogout}>Logout</button>
        </div>
      </header>

      <main className="dashboard-body">
        <section className="card glass upload-card">
          <h2>1. Upload Dataset</h2>
          <div {...getRootProps({ className: "dropzone area" })}>
            <input {...getInputProps()} />
            {file ? <p>📂 {file.name}</p> : <p>Drag & Drop or Click to upload CSV / Excel (.csv, .xlsx, .xls)</p>}
          </div>
          <p className="muted">Accepted: CSV or Excel. First sheet of Excel will be used. We'll automatically select Thalassemia-relevant columns (Gender, Genotype, Hemoglobin, MCV, MCH, RBC, Ferritin).</p>
        </section>

        <section className="card glass options-card">
          <h2>2. Generate Options</h2>
          <label>Rows to generate</label>
          <input
            type="number"
            min="1"
            value={rowsToGenerate}
            onChange={(e) => setRowsToGenerate(Number(e.target.value))}
            className="input-small"
          />
          <div style={{ marginTop: 12 }}>
            <button className="primary-btn" onClick={() => simulateTraining()} disabled={isTraining}>Train Model</button>
            <button className="primary-btn" onClick={handleGenerate} disabled={isTraining} style={{ marginLeft: 10 }}>
              {isTraining ? "Training..." : "Train & Generate"}
            </button>
          </div>

          {isTraining && (
            <div className="progress-wrap">
              <div className="progress-bar" style={{ width: `${trainingProgress}%` }} />
              <div className="progress-text">Training: {trainingProgress}%</div>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
