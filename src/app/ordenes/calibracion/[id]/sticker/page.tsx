"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";

type CalibRecord = {
  _id: string;
  numeroCertificado: string;
  tag: string;
  descripcionInstrumento: string;
  tipoVariable: string;
  unidad?: string;
  patronCodigo: string;
  tecnicoNombre: string;
  supervisorNombre?: string;
  fecha: string;
  puntos: { aprueba: boolean }[];
  resultadoGeneral: "APROBADO" | "RECHAZADO" | "AJUSTADO";
};

function fmtDate(d?: string) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("es-BO", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "UTC" });
}

const STICKER_COLORS = {
  APROBADO: { bg: "#dcfce7", border: "#16a34a", text: "#15803d" },
  RECHAZADO: { bg: "#fee2e2", border: "#dc2626", text: "#b91c1c" },
  AJUSTADO: { bg: "#fef3c7", border: "#d97706", text: "#b45309" },
};

export default function StickerPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id;

  const [record, setRecord] = useState<CalibRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [copies, setCopies] = useState(3);

  useEffect(() => {
    if (!id) return;
    fetch(`/api/calibracion/${id}`)
      .then(r => r.ok ? r.json() : Promise.reject("No encontrado"))
      .then(d => setRecord(d))
      .catch(e => setError(String(e)))
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "100vh" }}>
        <div style={{ color: "#64748b", fontFamily: "Arial, sans-serif" }}>Cargando sticker...</div>
      </div>
    );
  }

  if (error || !record) {
    return (
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minHeight: "100vh", gap: 12, fontFamily: "Arial, sans-serif" }}>
        <div style={{ color: "#dc2626" }}>{error || "No encontrado"}</div>
        <Link href="/ordenes/calibracion" style={{ color: "#2563eb", fontSize: 13 }}>← Volver</Link>
      </div>
    );
  }

  const colors = STICKER_COLORS[record.resultadoGeneral];
  const stickers = Array.from({ length: copies });

  return (
    <>
      {/* Controls */}
      <div
        id="sticker-controls"
        style={{
          background: "#0f2847",
          padding: "10px 20px",
          display: "flex",
          alignItems: "center",
          gap: 16,
          justifyContent: "space-between",
          fontFamily: "Arial, sans-serif",
        }}
      >
        <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
          <Link
            href={`/ordenes/calibracion/${id}/certificado`}
            style={{ color: "white", fontSize: 13, textDecoration: "none" }}
          >
            ← Certificado
          </Link>
          <Link
            href="/ordenes/calibracion"
            style={{ color: "rgba(255,255,255,0.6)", fontSize: 12, textDecoration: "none" }}
          >
            Lista
          </Link>
        </div>
        <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
          <label style={{ color: "rgba(255,255,255,0.8)", fontSize: 12, display: "flex", alignItems: "center", gap: 8 }}>
            Copias:
            <select
              value={copies}
              onChange={e => setCopies(Number(e.target.value))}
              style={{ padding: "3px 8px", borderRadius: 4, border: "none", fontSize: 12, background: "white", color: "#0f2847" }}
            >
              {[1, 2, 3, 4, 6, 8, 10].map(n => (
                <option key={n} value={n}>{n}</option>
              ))}
            </select>
          </label>
          <button
            onClick={() => window.print()}
            style={{
              background: "white",
              color: "#0f2847",
              border: "none",
              borderRadius: 6,
              padding: "6px 18px",
              fontWeight: 700,
              fontSize: 13,
              cursor: "pointer",
            }}
          >
            Imprimir Stickers
          </button>
        </div>
      </div>

      {/* Preview area */}
      <div
        style={{
          padding: 24,
          background: "#f1f5f9",
          minHeight: "calc(100vh - 48px)",
          fontFamily: "Arial, sans-serif",
        }}
      >
        <div style={{ fontSize: 12, color: "#64748b", marginBottom: 16, textAlign: "center" }}>
          Vista previa · Tamaño real: 7 × 4 cm · {copies} sticker{copies !== 1 ? "s" : ""}
        </div>

        <div
          id="stickers-area"
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 16,
            justifyContent: "center",
          }}
        >
          {stickers.map((_, i) => (
            <div
              key={i}
              className="sticker-card"
              style={{
                width: "280px",
                border: `2px solid ${colors.border}`,
                borderRadius: 8,
                background: "white",
                boxShadow: "0 2px 10px rgba(0,0,0,0.13)",
                display: "flex",
                flexDirection: "column",
                fontFamily: "Arial, Helvetica, sans-serif",
              }}
            >
              {/* Header */}
              <div style={{
                background: "#0f2847",
                padding: "5px 10px",
                borderRadius: "6px 6px 0 0",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}>
                <div style={{ color: "white", fontWeight: 800, fontSize: 10, letterSpacing: "0.05em" }}>
                  MSC · LAB. INSTRUMENTACIÓN
                </div>
              </div>

              {/* Body */}
              <div style={{ padding: "8px 10px 6px", display: "flex", gap: 8 }}>
                {/* Left */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  {/* TAG */}
                  <div style={{ fontSize: 20, fontWeight: 900, color: "#0f2847", lineHeight: 1, marginBottom: 3 }}>
                    {record.tag}
                  </div>
                  {/* Descripción — truncada con ellipsis, no corta borde */}
                  <div style={{ fontSize: 9, color: "#64748b", marginBottom: 7, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "100%" }}>
                    {record.descripcionInstrumento}
                  </div>

                  {/* Certificado */}
                  <div style={{ fontSize: 7, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.06em" }}>Certificado N°</div>
                  <div style={{ fontSize: 9, fontWeight: 700, color: "#1e293b", marginBottom: 6, wordBreak: "break-all" }}>
                    {record.numeroCertificado}
                  </div>

                  {/* Fecha + Técnico */}
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 6px" }}>
                    <div>
                      <div style={{ fontSize: 7, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.05em" }}>Calibrado</div>
                      <div style={{ fontSize: 9, fontWeight: 600, color: "#1e293b" }}>{fmtDate(record.fecha)}</div>
                    </div>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 7, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.05em" }}>Técnico</div>
                      <div style={{ fontSize: 8, color: "#1e293b", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {record.tecnicoNombre.split(" ").slice(0, 2).join(" ")}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Right: badge + QR */}
                <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 5, width: 68, flexShrink: 0 }}>
                  <div style={{
                    background: colors.bg,
                    border: `1.5px solid ${colors.border}`,
                    color: colors.text,
                    fontWeight: 900,
                    fontSize: 9,
                    padding: "3px 6px",
                    borderRadius: 4,
                    textAlign: "center" as const,
                    letterSpacing: "0.05em",
                    width: "100%",
                  }}>
                    {record.resultadoGeneral}
                  </div>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={`/api/qr?url=${encodeURIComponent(`${typeof window !== "undefined" ? window.location.origin : "https://sync-msc-production.up.railway.app"}/pub/cal/${encodeURIComponent(record.numeroCertificado)}`)}&size=128`}
                    alt="QR"
                    width={60}
                    height={60}
                    style={{ borderRadius: 4, border: "1px solid #e2e8f0", display: "block" }}
                  />
                  <div style={{ fontSize: 6, color: "#94a3b8", textAlign: "center" as const, lineHeight: 1.3 }}>
                    Escanear<br />para verificar
                  </div>
                </div>
              </div>

              {/* Footer */}
              <div style={{
                background: colors.bg,
                padding: "3px 10px",
                borderTop: `1px solid ${colors.border}`,
                borderRadius: "0 0 6px 6px",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}>
                <div style={{ fontSize: 8, color: colors.text, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "70%" }}>
                  {record.tipoVariable} · Patrón: {record.patronCodigo}
                </div>
                <div style={{ fontSize: 8, color: colors.text, flexShrink: 0 }}>
                  MSC
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <style>{`
        @media print {
          #sticker-controls { display: none !important; }
          body { margin: 0; background: white; }
          #stickers-area {
            padding: 6mm;
            gap: 4mm !important;
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
        @page { margin: 8mm; size: A4; }
      `}</style>
    </>
  );
}
