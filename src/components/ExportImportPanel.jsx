import React, { useState, useMemo } from "react";
import { formatCharacterSheet, parseCharacterSheet } from "../engine/sheet.js";
import { validate, validityReasons } from "../engine/validate.js";
import Overlay from "./ui/Overlay.jsx";

export default function ExportImportPanel({ character, report, onImport, onClose }) {
  const exported = useMemo(() => formatCharacterSheet(character, report), [character, report]);
  const [draft, setDraft] = useState("");
  const [copied, setCopied] = useState(false);
  const [xlsx, setXlsx] = useState(null);  // { parsed } | { error } | null

  const onFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const buf = await file.arrayBuffer();
      const { parseXlsxCharacter } = await import('../engine/xlsx-import.js');
      setXlsx({ parsed: parseXlsxCharacter(buf) });
    } catch (err) {
      setXlsx({ error: String(err.message || err) });
    }
  };

  const preview = useMemo(() => {
    if (xlsx?.error) return { error: xlsx.error };
    if (xlsx?.parsed) return { parsed: xlsx.parsed, report: validate(xlsx.parsed) };
    const text = draft.trim();
    if (!text) return null;
    try {
      const parsed = parseCharacterSheet(text);
      return { parsed, report: validate(parsed) };
    } catch (e) {
      return { error: String(e) };
    }
  }, [draft, xlsx]);

  const copy = () => {
    navigator.clipboard?.writeText(exported);
    setCopied(true); setTimeout(() => setCopied(false), 1500);
  };
  const [xlsxError, setXlsxError] = useState(null);
  const safeName = (ext) => `${(character.name || character.archetypeName || "character").replace(/[^\w]+/g, "-")}.${ext}`;
  const downloadBlob = (data, type, ext) => {
    const url = URL.createObjectURL(new Blob([data], { type }));
    const a = document.createElement("a");
    a.href = url; a.download = safeName(ext); a.click();
    URL.revokeObjectURL(url);
  };
  const download = () => downloadBlob(exported, "text/plain", "txt");
  const downloadXlsx = async () => {
    try {
      setXlsxError(null);
      const { buildXlsxCharacter } = await import('../engine/xlsx-import.js');
      downloadBlob(buildXlsxCharacter(character, report),
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "xlsx");
    } catch (err) {
      setXlsxError(String(err.message || err));
    }
  };

  return (
    <Overlay onClose={onClose} panelClassName="b-export">
        <header className="b-picker-head">
          <h2 className="b-picker-title">Export / Import</h2>
          <button className="b-picker-x" aria-label="Close" onClick={onClose}>×</button>
        </header>
        <div className="b-export-cols">
          <div className="b-export-half">
            <div className="b-export-head">
              <h3 className="b-export-label">Export</h3>
              <div className="b-export-actions">
                <button className="b-topbar-btn" onClick={copy}>{copied ? "Copied!" : "Copy"}</button>
                <button className="b-topbar-btn" onClick={download}>Download .txt</button>
                <button className="b-topbar-btn" onClick={downloadXlsx}>Download .xlsx</button>
              </div>
            </div>
            {xlsxError && <p className="b-export-err">Couldn’t build .xlsx: {xlsxError}</p>}
            <textarea className="b-export-text" readOnly aria-label="Exported character sheet" value={exported} />
          </div>
          <div className="b-export-half">
            <div className="b-export-head">
              <h3 className="b-export-label">Import</h3>
              {preview && !preview.error && (
                <span className={`b-export-status ${preview.report.valid ? "is-valid" : "is-invalid"}`}>
                  {preview.report.valid ? "✓ legal" : "⚠ check"} · BP {preview.report.spend.net}/{preview.report.budget} · L{preview.report.level}
                </span>
              )}
            </div>
            {preview && !preview.error && !preview.report.valid && (
              <ul className="b-import-reasons">
                {validityReasons(preview.report).map((r, i) => <li key={i}>{r}</li>)}
              </ul>
            )}
            <label className="b-import-file">
              <input type="file" accept=".xlsx" onChange={onFile} />
              ⬆ Upload an .xlsx character sheet
            </label>
            {xlsx?.parsed && <p className="b-import-filenote">Loaded from spreadsheet — clear the field below to re-upload.</p>}
            <textarea className="b-export-text" placeholder="…or paste a character sheet — plain text, the HTML export, or a spreadsheet copy…"
                      value={draft} onChange={(e) => { setDraft(e.target.value); if (xlsx) setXlsx(null); }} />
            {preview?.error && <p className="b-export-err">Couldn’t parse: {preview.error}</p>}
            <button className="b-read-choose" disabled={!preview || preview.error}
                    onClick={() => onImport(preview.parsed)}>
              Load this character
            </button>
          </div>
        </div>
    </Overlay>
  );
}
