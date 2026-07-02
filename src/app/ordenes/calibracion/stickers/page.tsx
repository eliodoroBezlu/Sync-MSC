"use client";

import { useEffect, useState, useRef, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";

type CalibRecord = {
  _id: string;
  numeroCertificado: string;
  tag: string;
  descripcionInstrumento: string;
  tipoVariable: string;
  patronCodigo: string;
  tecnicoNombre: string;
  fecha: string;
  resultadoGeneral: "APROBADO" | "RECHAZADO" | "AJUSTADO";
};

const COLORS = {
  APROBADO:  { bg: "#dcfce7", border: "#16a34a", text: "#15803d" },
  RECHAZADO: { bg: "#fee2e2", border: "#dc2626", text: "#b91c1c" },
  AJUSTADO:  { bg: "#fef3c7", border: "#d97706", text: "#b45309" },
};

function fmtDate(d: string) {
  return new Date(d).toLocaleDateString("es-BO", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "UTC" });
}

function Sticker({ r, copies }: { r: CalibRecord; copies: number }) {
  const colors = COLORS[r.resultadoGeneral];
  const qrUrl = typeof window !== "undefined"
    ? `/api/qr?url=${encodeURIComponent(`${window.location.origin}/pub/cal/${encodeURIComponent(r.numeroCertificado)}`)}&size=128`
    : `/api/qr?url=${encodeURIComponent(`https://sync-msc-production.up.railway.app/pub/cal/${encodeURIComponent(r.numeroCertificado)}`)}&size=128`;

  return (
    <>
      {Array.from({ length: copies }).map((_, i) => (
        <div key={i} className="sticker-card" style={{
          width: "280px",
          border: `2px solid ${colors.border}`,
          borderRadius: 8,
          background: "white",
          display: "flex",
          flexDirection: "column",
          fontFamily: "Arial, Helvetica, sans-serif",
          boxShadow: "0 2px 8px rgba(0,0,0,0.10)",
        }}>
          <div style={{ background: "#0f2847", padding: "5px 10px", borderRadius: "6px 6px 0 0" }}>
            <div style={{ color: "white", fontWeight: 800, fontSize: 10, letterSpacing: "0.05em" }}>
              MSC · LAB. INSTRUMENTACIÓN
            </div>
          </div>

          <div style={{ padding: "8px 10px 6px", display: "flex", gap: 8 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 20, fontWeight: 900, color: "#0f2847", lineHeight: 1, marginBottom: 3 }}>
                {r.tag}
              </div>
              <div style={{ fontSize: 9, color: "#64748b", marginBottom: 7, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {r.descripcionInstrumento}
              </div>
              <div style={{ fontSize: 7, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.06em" }}>Certificado N°</div>
              <div style={{ fontSize: 9, fontWeight: 700, color: "#1e293b", marginBottom: 6, wordBreak: "break-all" }}>
                {r.numeroCertificado}
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 6px" }}>
                <div>
                  <div style={{ fontSize: 7, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.05em" }}>Calibrado</div>
                  <div style={{ fontSize: 9, fontWeight: 600, color: "#1e293b" }}>{fmtDate(r.fecha)}</div>
                </div>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 7, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.05em" }}>Técnico</div>
                  <div style={{ fontSize: 8, color: "#1e293b", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {r.tecnicoNombre.split(" ").slice(0, 2).join(" ")}
                  </div>
                </div>
              </div>
            </div>

            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 5, width: 68, flexShrink: 0 }}>
              <div style={{
                background: colors.bg, border: `1.5px solid ${colors.border}`, color: colors.text,
                fontWeight: 900, fontSize: 9, padding: "3px 6px", borderRadius: 4,
                textAlign: "center", letterSpacing: "0.05em", width: "100%",
              }}>
                {r.resultadoGeneral}
              </div>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={qrUrl} alt="QR" width={60} height={60}
                style={{ borderRadius: 4, border: "1px solid #e2e8f0", display: "block" }} />
              <div style={{ fontSize: 6, color: "#94a3b8", textAlign: "center", lineHeight: 1.3 }}>
                Escanear<br />para verificar
              </div>
            </div>
          </div>

          <div style={{
            background: colors.bg, padding: "3px 10px",
            borderTop: `1px solid ${colors.border}`, borderRadius: "0 0 6px 6px",
            display: "flex", justifyContent: "space-between", alignItems: "center",
          }}>
            <div style={{ fontSize: 8, color: colors.text, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "75%" }}>
              {r.tipoVariable} · Patrón: {r.patronCodigo}
            </div>
            <div style={{ fontSize: 8, color: colors.text, flexShrink: 0 }}>MSC</div>
          </div>
        </div>
      ))}
    </>
  );
}

function MultiStickerContent() {
  const searchParams = useSearchParams();
  const ids = (searchParams.get("ids") ?? "").split(",").filter(Boolean);

  const [records, setRecords] = useState<CalibRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [copies, setCopies] = useState(3);
  const printedRef = useRef(false);

  useEffect(() => {
    if (ids.length === 0) { setLoading(false); return; }
    Promise.all(ids.map(id => fetch(`/api/calibracion/${id}`).then(r => r.ok ? r.json() : null)))
      .then(results => setRecords(results.filter(Boolean)))
      .catch(() => {})
      .finally(() => setLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handlePrint = () => {
    if (!printedRef.current) {
      document.title = `Stickers-calibracion-${new Date().toISOString().slice(0, 10)}`;
      printedRef.current = true;
    }
    window.print();
  };

  return (
    <>
      {/* Controls */}
      <div id="print-controls" style={{
        background: "#0f2847", padding: "10px 20px",
        display: "flex", alignItems: "center", gap: 16,
        justifyContent: "space-between", fontFamily: "Arial, sans-serif",
      }}>
        <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
          <Link href="/ordenes/calibracion" style={{ color: "white", fontSize: 13, textDecoration: "none" }}>
            ← Lista
          </Link>
          <span style={{ color: "rgba(255,255,255,0.5)", fontSize: 12 }}>
            {loading ? "Cargando..." : `${records.length} certificado${records.length !== 1 ? "s" : ""} · ${records.length * copies} sticker${records.length * copies !== 1 ? "s" : ""} total`}
          </span>
        </div>
        <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
          <label style={{ color: "rgba(255,255,255,0.8)", fontSize: 12, display: "flex", alignItems: "center", gap: 8 }}>
            Copias por certificado:
            <select value={copies} onChange={e => setCopies(Number(e.target.value))}
              style={{ padding: "3px 8px", borderRadius: 4, border: "none", fontSize: 12, background: "white", color: "#0f2847" }}>
              {[1, 2, 3, 4, 5, 6].map(n => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>
          <button onClick={handlePrint} disabled={loading || records.length === 0}
            style={{ background: "white", color: "#0f2847", border: "none", borderRadius: 6, padding: "6px 18px", fontWeight: 700, fontSize: 13, cursor: "pointer" }}>
            Imprimir todo
          </button>
        </div>
      </div>

      {/* Preview */}
      <div style={{ padding: 24, background: "#f1f5f9", minHeight: "calc(100vh - 48px)", fontFamily: "Arial, sans-serif" }}>
        {loading ? (
          <div style={{ textAlign: "center", padding: "60px 0", color: "#64748b" }}>Cargando stickers...</div>
        ) : records.length === 0 ? (
          <div style={{ textAlign: "center", padding: "60px 0", color: "#94a3b8" }}>No se encontraron certificados.</div>
        ) : (
          <>
            <div style={{ fontSize: 12, color: "#64748b", marginBottom: 16, textAlign: "center" }}>
              Vista previa · {records.length} certificado{records.length !== 1 ? "s" : ""} · {copies} copia{copies !== 1 ? "s" : ""} c/u · Tamaño real: 7 × 4 cm
            </div>
            <div id="stickers-area" style={{ display: "flex", flexWrap: "wrap", gap: 16, justifyContent: "flex-start" }}>
              {records.map(r => <Sticker key={r._id} r={r} copies={copies} />)}
            </div>
          </>
        )}
      </div>

      <style>{`
        @media print {
          #print-controls { display: none !important; }
          body { margin: 0; background: white; }
          #stickers-area {
            padding: 4mm;
            gap: 3mm !important;
            justify-content: flex-start !important;
          }
          .sticker-card {
            width: 74mm !important;
            box-shadow: none !important;
            break-inside: avoid;
            page-break-inside: avoid;
          }
          * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
        }
        @page { margin: 6mm; size: A4; }
      `}</style>
    </>
  );
}

export default function MultiStickerPage() {
  return (
    <Suspense fallback={<div style={{ padding: 40, textAlign: "center", color: "#64748b" }}>Cargando...</div>}>
      <MultiStickerContent />
    </Suspense>
  );
}
