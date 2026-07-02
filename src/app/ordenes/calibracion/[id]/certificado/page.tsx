"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";

// ─── Types ───────────────────────────────────────────────────────────────────

type Punto = {
  lecturaPatron: number;
  lecturaInstrumento: number;
  error: number;
  tolerancia: number;
  aprueba: boolean;
  incertidumbre?: number;
  incertidumbrePatron?: number;
};

type CalibRecord = {
  _id: string;
  numeroCertificado: string;
  tag: string;
  descripcionInstrumento: string;
  tipoVariable: string;
  unidad?: string;
  // multi-patrón (nuevo) — fallback a campos legacy
  patronIds?: string[];
  patronCodigos?: string[];
  patronId?: string;
  patronCodigo?: string;
  tecnicoNombre: string;
  supervisorNombre?: string;
  fecha: string;
  turno?: string;
  temperatura?: number;
  humedad?: number;
  puntos: Punto[];
  puntosAntes?: Punto[];
  resultadoGeneral: "APROBADO" | "RECHAZADO" | "AJUSTADO";
  observaciones?: string;
  otAsociada?: string;
  areaCodigo?: string;
  tecnicoFirma?: string;
  supervisorFirma?: string;
};

type PatronDoc = {
  _id: string;
  codigo: string;
  descripcion: string;
  tipo: string;
  marca: string;
  modelo: string;
  numeroSerie: string;
  precision?: string;
  fechaUltimaCalibracion?: string;
  fechaVencimiento: string;
  rangoMin?: number;
  rangoMax?: number;
};

type EquipoDoc = {
  tag: string;
  descripcion: string;
  fabricante?: string;
  modelo?: string;
  serie?: string;
  descripcionArea?: string;
  areaCodigo?: string;
  descripcion2?: string;
  descripcion3?: string;
  subtipo?: string;
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmtDate(d?: string | null) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("es-BO", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "UTC" });
}
function fmt(n: number, dec = 4) { return (n >= 0 ? "+" : "") + n.toFixed(dec); }

/**
 * Incertidumbre expandida estimada (GUM simplificado, k=2, 95%).
 * Si el punto ya trae el valor calculado, lo usa directamente.
 * Si no, estima con: U = 2 × √(u_rep² + u_pat²)
 *   u_rep = |error| / √3  (distribución rectangular, sin repeticiones)
 *   u_pat = u_patron declarada del punto, o tol/√3 como fallback
 */
function calcU(p: Punto): number {
  if (p.incertidumbre != null) return p.incertidumbre;
  const uRep = Math.abs(p.error) / Math.sqrt(3);
  const uPat = p.incertidumbrePatron != null ? p.incertidumbrePatron : p.tolerancia / Math.sqrt(3);
  return 2 * Math.sqrt(uRep ** 2 + uPat ** 2);
}

// ─── Logo MSC ────────────────────────────────────────────────────────────────

function LogoMSC({ width = 90 }: { width?: number }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src="/logo-msc.png" alt="Minera San Cristóbal S.A." width={width} style={{ display: "block" }} />
  );
}

// ─── Gráfico de error ─────────────────────────────────────────────────────────

function ErrorChart({ puntos, puntosAntes, unidad }: { puntos: Punto[]; puntosAntes?: Punto[]; unidad: string }) {
  const W = 300, H = 185;
  const padL = 46, padR = 12, padT = 14, padB = 32;
  const cW = W - padL - padR, cH = H - padT - padB;

  type CP = { err: number; tol: number; aprueba: boolean };
  const antes: CP[] = (puntosAntes ?? []).map(p => ({ err: p.error, tol: p.tolerancia, aprueba: p.aprueba }));
  const desp: CP[] = puntos.map(p => ({ err: p.error, tol: p.tolerancia, aprueba: p.aprueba }));
  const all = [...antes, ...desp];
  if (all.length === 0) return null;

  const tolRef = Math.max(...all.map(p => p.tol), 0.001);
  const yExt = Math.max(tolRef * 1.5, Math.max(...all.map(p => Math.abs(p.err)), 0.001) * 1.4);
  const mag = Math.pow(10, Math.floor(Math.log10(yExt)));
  const yMax = Math.ceil(yExt / mag) * mag;

  const toX = (i: number) => padL + (all.length <= 1 ? cW / 2 : (i / (all.length - 1)) * cW);
  const toY = (v: number) => padT + cH * (1 - (v + yMax) / (2 * yMax));
  const fmtY = (v: number) => Math.abs(v) < 1e-9 ? "0" : v.toFixed(Math.abs(v) < 0.1 ? 3 : 2);
  const path = (pts: CP[], start: number) =>
    pts.map((p, i) => `${i === 0 ? "M" : "L"}${toX(start + i).toFixed(1)},${toY(p.err).toFixed(1)}`).join(" ");

  const tY1 = toY(tolRef), tY2 = toY(-tolRef);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "auto", display: "block" }}>
      <rect x={padL} y={padT} width={cW} height={cH} fill="white" stroke="#d1d5db" strokeWidth={0.5} />
      {[-yMax, -yMax / 2, 0, yMax / 2, yMax].map((v, i) => (
        <g key={i}>
          <line x1={padL} x2={padL + cW} y1={toY(v)} y2={toY(v)}
            stroke={v === 0 ? "#94a3b8" : "#e5e7eb"} strokeWidth={v === 0 ? 0.8 : 0.4} strokeDasharray={v === 0 ? undefined : "3,2"} />
          <text x={padL - 3} y={toY(v) + 3} textAnchor="end" fontSize={6.5} fill="#6b7280">{fmtY(v)}</text>
        </g>
      ))}
      <rect x={padL} y={tY1} width={cW} height={tY2 - tY1} fill="#fef9c3" fillOpacity={0.6} />
      <line x1={padL} x2={padL + cW} y1={tY1} y2={tY1} stroke="#ca8a04" strokeWidth={1.1} />
      <line x1={padL} x2={padL + cW} y1={tY2} y2={tY2} stroke="#ca8a04" strokeWidth={1.1} />
      {antes.length > 0 && (
        <g>
          <path d={path(antes, 0)} fill="none" stroke="#ef4444" strokeWidth={1.4} />
          {antes.map((p, i) => <circle key={i} cx={toX(i)} cy={toY(p.err)} r={2.8} fill="#3b82f6" stroke="white" strokeWidth={0.7} />)}
        </g>
      )}
      <g>
        <path d={path(desp, antes.length)} fill="none" stroke="#16a34a" strokeWidth={1.4} />
        {desp.map((p, i) => (
          <rect key={i} x={toX(antes.length + i) - 2.8} y={toY(p.err) - 2.8} width={5.6} height={5.6}
            fill={p.aprueba ? "#16a34a" : "#dc2626"} stroke="white" strokeWidth={0.7} />
        ))}
      </g>
      <line x1={padL} x2={padL + cW} y1={padT + cH} y2={padT + cH} stroke="#9ca3af" strokeWidth={0.7} />
      {all.map((_, i) => (
        <g key={i}>
          <line x1={toX(i)} x2={toX(i)} y1={padT + cH} y2={padT + cH + 3} stroke="#9ca3af" strokeWidth={0.5} />
          <text x={toX(i)} y={padT + cH + 11} textAnchor="middle" fontSize={6.5} fill="#6b7280">{i + 1}</text>
        </g>
      ))}
      <text x={9} y={padT + cH / 2} textAnchor="middle" fontSize={6.5} fill="#6b7280"
        transform={`rotate(-90,9,${padT + cH / 2})`}>Error {unidad}</text>
      {antes.length > 0 && (
        <g transform={`translate(${padL + 4},${padT + 4})`}>
          <line x1={0} x2={11} y1={4} y2={4} stroke="#ef4444" strokeWidth={1.4} />
          <circle cx={5.5} cy={4} r={2.5} fill="#3b82f6" />
          <text x={14} y={7} fontSize={6.5} fill="#374151">Antes</text>
          <line x1={42} x2={53} y1={4} y2={4} stroke="#16a34a" strokeWidth={1.4} />
          <rect x={45} y={1} width={5} height={5} fill="#16a34a" />
          <text x={56} y={7} fontSize={6.5} fill="#374151">Calibrado</text>
        </g>
      )}
    </svg>
  );
}

// ─── Sub-componentes de layout ────────────────────────────────────────────────

function SecTitle({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 7, marginTop: 12 }}>
      <div style={{ width: 3, height: 14, background: "#0d2f5e", borderRadius: 2, flexShrink: 0 }} />
      <span style={{ fontSize: 8.5, fontWeight: 800, color: "#0d2f5e", textTransform: "uppercase", letterSpacing: "0.09em" }}>
        {children}
      </span>
      <div style={{ flex: 1, height: 1, background: "#e2e8f0" }} />
    </div>
  );
}

function KV({ label, value, mono }: { label: string; value?: string | null; mono?: boolean }) {
  return (
    <div style={{ display: "flex", borderBottom: "1px solid #f1f5f9", padding: "2px 0" }}>
      <span style={{ fontSize: 7.5, fontWeight: 700, color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.04em", minWidth: 86, flexShrink: 0 }}>
        {label}
      </span>
      <span style={{ fontSize: 9.5, color: "#111827", lineHeight: 1.3, fontFamily: mono ? "monospace" : undefined }}>
        {value || "—"}
      </span>
    </div>
  );
}

// Tarjeta compacta de patrón
function PatronCard({ p, num }: { p: PatronDoc; num: number }) {
  return (
    <div style={{ border: "1px solid #e2e8f0", borderRadius: 6, padding: "7px 9px", background: "#f9fafb" }}>
      <div style={{ fontSize: 8, fontWeight: 800, color: "#0d2f5e", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 5 }}>
        Patrón {num} — <span style={{ fontFamily: "monospace" }}>{p.codigo}</span>
      </div>
      <KV label="Descripción" value={p.descripcion} />
      <KV label="Tipo" value={p.tipo} />
      <KV label="Marca / Modelo" value={`${p.marca} ${p.modelo}`} />
      <KV label="N° Serie" value={p.numeroSerie} mono />
      {p.precision && <KV label="Precisión" value={p.precision} />}
      {(p.rangoMin != null || p.rangoMax != null) && (
        <KV label="Rango" value={`${p.rangoMin ?? "—"} … ${p.rangoMax ?? "—"}`} />
      )}
      <KV label="Últ. Calibración" value={fmtDate(p.fechaUltimaCalibracion)} />
      <KV label="Vencimiento" value={fmtDate(p.fechaVencimiento)} />
    </div>
  );
}

// ─── Página principal ─────────────────────────────────────────────────────────

export default function CertificadoPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id;

  const [record, setRecord] = useState<CalibRecord | null>(null);
  const [patrones, setPatrones] = useState<PatronDoc[]>([]);
  const [equipo, setEquipo] = useState<EquipoDoc | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!id) return;
    (async () => {
      try {
        const res = await fetch(`/api/calibracion/${id}`);
        if (!res.ok) throw new Error("Registro no encontrado");
        const data: CalibRecord = await res.json();
        setRecord(data);

        // Normalizar IDs de patrones (soporta legado y nuevo)
        const ids: string[] = data.patronIds?.length
          ? data.patronIds
          : data.patronId ? [data.patronId] : [];

        const [patronResults, eRes] = await Promise.all([
          Promise.all(ids.map(pid => fetch(`/api/patrones/${pid}`).then(r => r.ok ? r.json() : null))),
          fetch(`/api/equipos?tag=${encodeURIComponent(data.tag)}`).then(r => r.ok ? r.json() : null),
        ]);
        setPatrones(patronResults.filter(Boolean) as PatronDoc[]);
        if (Array.isArray(eRes) && eRes.length > 0) setEquipo(eRes[0]);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Error");
      } finally {
        setLoading(false);
      }
    })();
  }, [id]);

  if (loading) return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "100vh", fontFamily: "Arial,sans-serif" }}>
      <div style={{ color: "#64748b" }}>Cargando certificado…</div>
    </div>
  );
  if (error || !record) return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minHeight: "100vh", gap: 12, fontFamily: "Arial,sans-serif" }}>
      <div style={{ color: "#dc2626" }}>{error || "No encontrado"}</div>
      <Link href="/ordenes/calibracion" style={{ color: "#2563eb", fontSize: 13 }}>← Volver</Link>
    </div>
  );

  const unidad = record.unidad || "";
  const RES_COLOR: Record<string, string> = { APROBADO: "#15803d", RECHAZADO: "#dc2626", AJUSTADO: "#b45309" };
  const resColor = RES_COLOR[record.resultadoGeneral] ?? "#0d2f5e";

  const puntosAntes = record.puntosAntes ?? [];

  type Fila = { tipo: string; patron: number; lectura: number; error: number; tol: number; u: number; aprueba: boolean; pct: number };
  const filas: Fila[] = [
    ...puntosAntes.map(p => ({ tipo: "Antes", patron: p.lecturaPatron, lectura: p.lecturaInstrumento, error: p.error, tol: p.tolerancia, u: calcU(p), aprueba: p.aprueba, pct: p.lecturaPatron !== 0 ? (p.error / p.lecturaPatron) * 100 : 0 })),
    ...record.puntos.map(p => ({ tipo: "Calibrado", patron: p.lecturaPatron, lectura: p.lecturaInstrumento, error: p.error, tol: p.tolerancia, u: calcU(p), aprueba: p.aprueba, pct: p.lecturaPatron !== 0 ? (p.error / p.lecturaPatron) * 100 : 0 })),
  ];

  const errMaxAbs = record.puntos.length ? record.puntos.reduce((m, p) => Math.abs(p.error) > Math.abs(m) ? p.error : m, 0) : null;
  const tolRef = record.puntos.length ? record.puntos[0].tolerancia : null;
  // U máxima del resultado final (solo puntos calibrados)
  const uMax = record.puntos.length ? Math.max(...record.puntos.map(calcU)) : null;

  const thS: React.CSSProperties = { background: "#f1f5f9", padding: "4px 5px", fontSize: 8, fontWeight: 700, color: "#374151", borderBottom: "1.5px solid #cbd5e1", textAlign: "center", whiteSpace: "nowrap" };
  const tdS = (ok?: boolean): React.CSSProperties => ({ padding: "3px 5px", fontSize: 8.5, textAlign: "center", borderBottom: "1px solid #f1f5f9", color: ok === true ? "#15803d" : ok === false ? "#dc2626" : "#111827", fontWeight: ok !== undefined ? 700 : 400 });

  // Grid de patrones: 1, 2 o 3 columnas
  const nPat = Math.max(patrones.length, 1);
  const patCols = nPat === 1 ? "1fr" : nPat === 2 ? "1fr 1fr" : "1fr 1fr 1fr";

  return (
    <>
      <div id="print-controls" style={{ background: "#0d2f5e", padding: "7px 20px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <Link href="/ordenes/calibracion" style={{ color: "white", fontSize: 13, textDecoration: "none" }}>← Volver</Link>
        <div style={{ display: "flex", gap: 10 }}>
          <Link href={`/ordenes/calibracion/${id}/sticker`}
            style={{ border: "1px solid rgba(255,255,255,0.35)", color: "white", borderRadius: 6, padding: "4px 12px", fontSize: 11, textDecoration: "none" }}>
            🏷 Sticker
          </Link>
          <button onClick={() => {
            // Nombre del PDF = numeroCertificado (formato: seq_TAG_YYYYMMDD)
            const prev = document.title;
            document.title = record.numeroCertificado;
            window.print();
            setTimeout(() => { document.title = prev; }, 1000);
          }}
            style={{ background: "white", color: "#0d2f5e", border: "none", borderRadius: 6, padding: "4px 16px", fontWeight: 700, fontSize: 11, cursor: "pointer" }}>
            Imprimir / PDF
          </button>
        </div>
      </div>

      {/* ══════════════════════════════════════════════════════════════════
          CERTIFICADO
      ══════════════════════════════════════════════════════════════════ */}
      <div id="certificado" style={{ maxWidth: 760, margin: "18px auto 48px", padding: "0 12px", fontFamily: "Arial,Helvetica,sans-serif", color: "#111827", display: "flex", flexDirection: "column" }}>

        {/* ── ENCABEZADO ────────────────────────────────────────────────── */}
        <div style={{ display: "flex", alignItems: "stretch", borderBottom: "3px solid #0d2f5e" }}>
          <div style={{ padding: "8px 12px", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", borderRight: "1.5px solid #e2e8f0", minWidth: 115 }}>
            <LogoMSC width={86} />
          </div>
          <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: "10px 14px" }}>
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: 14, fontWeight: 800, color: "#0d2f5e", letterSpacing: "0.05em", lineHeight: 1.2 }}>
                REGISTRO DE CALIBRACIÓN INTERNA
              </div>
              <div style={{ fontSize: 9, color: "#6b7280", marginTop: 3, letterSpacing: "0.04em" }}>
                LABORATORIO DE INSTRUMENTACIÓN — MINERA SAN CRISTÓBAL S.A.
              </div>
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "center", borderLeft: "1.5px solid #e2e8f0", minWidth: 105, padding: "6px 10px", gap: 4 }}>
            <div style={{ fontSize: 9.5, fontWeight: 700, color: "#374151" }}>2.03.P01.F62</div>
            <div style={{ fontSize: 8.5, color: "#6b7280" }}>Revisión: 4</div>
            <div style={{ background: "#94a3b8", color: "white", fontSize: 8.5, fontWeight: 800, padding: "2px 10px", borderRadius: 3, letterSpacing: "0.08em" }}>
              INTERNA
            </div>
          </div>
        </div>

        {/* ── BANNER ────────────────────────────────────────────────────── */}
        <div style={{ background: "#0d2f5e", color: "white", padding: "6px 14px", display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
          <div>
            <span style={{ fontSize: 8, color: "#93c5fd", fontWeight: 700, marginRight: 8, textTransform: "uppercase", letterSpacing: "0.06em" }}>Certificado N°</span>
            <span style={{ fontSize: 13, fontWeight: 800, letterSpacing: "0.04em" }}>{record.numeroCertificado}</span>
          </div>
          <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
            <span style={{ fontSize: 8.5, color: "#cbd5e1" }}>Fecha: {fmtDate(record.fecha)}</span>
            {record.turno && <span style={{ fontSize: 8.5, color: "#cbd5e1" }}>Turno: {record.turno}</span>}
            {record.temperatura != null && <span style={{ fontSize: 8.5, color: "#cbd5e1" }}>{record.temperatura}°C</span>}
            {record.humedad != null && <span style={{ fontSize: 8.5, color: "#cbd5e1" }}>{record.humedad}%HR</span>}
            <span style={{ fontSize: 10, fontWeight: 800, background: resColor, color: "white", padding: "2px 10px", borderRadius: 4, letterSpacing: "0.06em" }}>
              {record.resultadoGeneral}
            </span>
          </div>
        </div>

        {/* ══ CUERPO — se estira para llenar la página ══════════════════ */}
        <div id="cert-body" style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "space-between" }}>

          {/* ── EQUIPO + PATRONES ─────────────────────────────────────── */}
          <div style={{ display: "grid", gridTemplateColumns: `1fr ${nPat === 1 ? "1fr" : nPat === 2 ? "2fr" : "3fr"}`, gap: 14 }}>
            <div>
              <SecTitle>Datos del Equipo</SecTitle>
              <KV label="TAG" value={record.tag} mono />
              <KV label="Descripción" value={equipo?.descripcion || record.descripcionInstrumento} />
              <KV label="Marca" value={equipo?.fabricante} />
              <KV label="Modelo" value={equipo?.modelo} />
              <KV label="Serie" value={equipo?.serie} mono />
              <KV label="Variable / Unidad" value={`${record.tipoVariable}${unidad ? ` (${unidad})` : ""}`} />
              <KV label="OT Asociada" value={record.otAsociada} mono />
              <KV label="Área" value={equipo?.descripcionArea || equipo?.areaCodigo || record.areaCodigo} />
              {equipo?.descripcion2 && <KV label="Func. / Lazo" value={equipo.descripcion2} />}
              {equipo?.descripcion3 && <KV label="P&Id" value={equipo.descripcion3} />}
            </div>
            <div>
              <SecTitle>Patrones de Referencia</SecTitle>
              <div style={{ display: "grid", gridTemplateColumns: patCols, gap: 8 }}>
                {patrones.length > 0
                  ? patrones.map((p, i) => <PatronCard key={p._id} p={p} num={i + 1} />)
                  : (
                    <div style={{ border: "1px solid #e2e8f0", borderRadius: 6, padding: "7px 9px", background: "#f9fafb" }}>
                      <KV label="Código" value={record.patronCodigos?.[0] || record.patronCodigo} mono />
                    </div>
                  )}
              </div>
            </div>
          </div>

          {/* ── RESULTADO DE MEDICIONES ───────────────────────────────── */}
          <div>
            <SecTitle>Resultado de Mediciones</SecTitle>
            <div style={{ display: "grid", gridTemplateColumns: "58% 1fr", gap: 12, alignItems: "start" }}>
              <div>
                <div style={{ fontSize: 8, fontWeight: 700, color: "#374151", marginBottom: 4 }}>Pruebas</div>
                <table style={{ width: "100%", borderCollapse: "collapse", border: "1px solid #e2e8f0" }}>
                  <thead>
                    <tr>
                      <th style={thS}></th>
                      <th style={thS}>Tipo</th>
                      <th style={thS}>Patrón<br />{unidad}</th>
                      <th style={thS}>Lectura<br />{unidad}</th>
                      <th style={thS}>Error<br />{unidad}</th>
                      <th style={thS}>Error<br />%</th>
                      <th style={{ ...thS, color: "#7c3aed" }}>U exp.<br />(k=2)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filas.map((f, i) => {
                      const nA = puntosAntes.length;
                      const num = i < nA ? i + 1 : i - nA + 1;
                      return (
                        <tr key={i} style={{ background: i % 2 === 0 ? "#fafafa" : "white" }}>
                          <td style={{ ...tdS(), textAlign: "left", paddingLeft: 7, fontSize: 8 }}>Medición {num}</td>
                          <td style={{ ...tdS(), fontSize: 8 }}>{f.tipo}</td>
                          <td style={tdS()}>{f.patron}</td>
                          <td style={tdS()}>{f.lectura}</td>
                          <td style={tdS(f.aprueba)}>{fmt(f.error)}</td>
                          <td style={tdS(f.aprueba)}>{fmt(f.pct, 2)}%</td>
                          <td style={{ ...tdS(), color: "#7c3aed", fontWeight: 600 }}>±{f.u.toFixed(4)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                <div style={{ fontSize: 7, color: "#94a3b8", marginTop: 3, fontStyle: "italic", lineHeight: 1.4 }}>
                  U expandida (k=2, ~95%): calculada según GUM — U = 2√(u_rep² + u_pat²). u_rep = |error|/√3 · u_pat = precisión del patrón/√3.
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 5, marginTop: 7 }}>
                  {[
                    { label: "Error Máx.", value: errMaxAbs !== null ? `${fmt(errMaxAbs)} ${unidad}` : "—" },
                    { label: "Tolerancia", value: tolRef != null ? `±${tolRef} ${unidad}` : "—" },
                    { label: "U expandida", value: uMax != null ? `±${uMax.toFixed(4)} ${unidad}` : "—", purple: true },
                    { label: "Conclusión", value: record.resultadoGeneral === "APROBADO" ? "Dentro tol." : record.resultadoGeneral === "RECHAZADO" ? "Fuera tol." : "Ajustado", result: true },
                  ].map(m => (
                    <div key={m.label} style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 5, padding: "5px 7px" }}>
                      <div style={{ fontSize: 7, fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", marginBottom: 2 }}>{m.label}</div>
                      <div style={{ fontSize: 9.5, fontWeight: 700, color: m.result ? resColor : m.purple ? "#7c3aed" : "#0d2f5e" }}>{m.value}</div>
                    </div>
                  ))}
                </div>
              </div>
              <div>
                <div style={{ fontSize: 8, fontWeight: 700, color: "#374151", marginBottom: 4 }}>Error de Medida %</div>
                <ErrorChart puntos={record.puntos} puntosAntes={record.puntosAntes} unidad={unidad} />
              </div>
            </div>
            {record.observaciones && (
              <div style={{ marginTop: 7, background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 5, padding: "4px 10px" }}>
                <span style={{ fontSize: 7.5, fontWeight: 700, color: "#92400e", textTransform: "uppercase", marginRight: 6 }}>Obs:</span>
                <span style={{ fontSize: 9.5, color: "#111827" }}>{record.observaciones}</span>
              </div>
            )}
          </div>

          {/* ── ESPACIADOR — empuja responsables hacia el fondo ───────── */}
          <div style={{ flex: 1, minHeight: 12 }} />

        </div>{/* fin cert-body */}

        {/* ── RESPONSABLES ──────────────────────────────────────────────── */}
        <SecTitle>Datos Responsable</SecTitle>
        <div style={{ display: "grid", gridTemplateColumns: "1fr auto 1fr", gap: 10, alignItems: "end" }}>
          <div style={{ textAlign: "center", display: "flex", flexDirection: "column", alignItems: "center" }}>
            <div style={{ height: 63, display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 4 }}>
              {record.tecnicoFirma ? (
                <img src={record.tecnicoFirma} alt="Firma Técnico" style={{ maxHeight: 63, maxWidth: 180, objectFit: "contain" }} />
              ) : (
                <div style={{ height: 1, width: 80, borderBottom: "1px solid #374151" }} />
              )}
            </div>
            <div style={{ borderTop: "1px solid #cbd5e1", width: "100%", paddingTop: 4 }}>
              <div style={{ fontSize: 9.5, fontWeight: 700, color: "#0d2f5e" }}>{record.tecnicoNombre}</div>
              <div style={{ fontSize: 7.5, color: "#6b7280", marginTop: 1 }}>Responsable</div>
            </div>
          </div>
          <div style={{ textAlign: "center", padding: "0 8px" }}>
            <div style={{ background: "#f1f5f9", border: "1px solid #e2e8f0", borderRadius: 6, padding: "6px 14px", display: "inline-block" }}>
              <div style={{ marginBottom: 6 }}>
                <div style={{ fontSize: 7.5, fontWeight: 700, color: "#6b7280", textTransform: "uppercase" }}>Fecha Cal.</div>
                <div style={{ fontSize: 11, fontWeight: 800, color: "#0d2f5e", marginTop: 1 }}>{fmtDate(record.fecha)}</div>
              </div>
              <div>
                <div style={{ fontSize: 7.5, fontWeight: 700, color: "#6b7280", textTransform: "uppercase" }}>Fecha de Próx.</div>
                <div style={{ fontSize: 11, fontWeight: 800, color: "#0d2f5e", marginTop: 1 }}>
                  {patrones.length > 0 ? fmtDate(patrones[0].fechaVencimiento) : "—"}
                </div>
              </div>
            </div>
          </div>
          <div style={{ textAlign: "center", display: "flex", flexDirection: "column", alignItems: "center" }}>
            <div style={{ height: 63, display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 4 }}>
              {record.supervisorFirma ? (
                <img src={record.supervisorFirma} alt="Firma Supervisor" style={{ maxHeight: 63, maxWidth: 180, objectFit: "contain" }} />
              ) : (
                <div style={{ height: 1, width: 80, borderBottom: "1px solid #374151" }} />
              )}
            </div>
            <div style={{ borderTop: "1px solid #cbd5e1", width: "100%", paddingTop: 4 }}>
              <div style={{ fontSize: 9.5, fontWeight: 700, color: "#0d2f5e" }}>{record.supervisorNombre || "—"}</div>
              <div style={{ fontSize: 7.5, color: "#6b7280", marginTop: 1 }}>Aprobado</div>
            </div>
          </div>
        </div>

        {/* ── PIE + QR ──────────────────────────────────────────────────── */}
        <div style={{ marginTop: 12, borderTop: "1px solid #e2e8f0", paddingTop: 7, display: "flex", alignItems: "flex-end", gap: 16, justifyContent: "space-between" }}>
          <div style={{ fontSize: 7, color: "#6b7280", lineHeight: 1.7, flex: 1 }}>
            <div>* Este es un documento generado por el Laboratorio de Instrumentación de M.S.C. Válido para Gestión Interna</div>
            <div>* El contenido de este certificado está en función de los requisitos de ISO 17025</div>
            <div>* La Trazabilidad de los patrones sigue las normas nacionales e internacionales</div>
            <div style={{ marginTop: 4, fontWeight: 700, color: "#475569" }}>
              Verificar en línea: sync-msc-production.up.railway.app/pub/cal/{record.numeroCertificado}
            </div>
          </div>
          {/* QR para verificación en línea */}
          <div style={{ textAlign: "center", flexShrink: 0 }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={`/api/qr?url=${encodeURIComponent(`https://sync-msc-production.up.railway.app/pub/cal/${encodeURIComponent(record.numeroCertificado)}`)}&size=208`}
              alt="QR Certificado"
              width={94}
              height={94}
              style={{ display: "block" }}
            />
            <div style={{ fontSize: 6, color: "#94a3b8", marginTop: 2 }}>Escanear para<br />ver en línea</div>
          </div>
        </div>
      </div>

      <style>{`
        @media print {
          #print-controls { display: none !important; }
          body { margin: 0 !important; padding: 0 !important; background: white; }

          #certificado {
            margin: 0 !important;
            padding: 0 !important;
            max-width: 100% !important;
            width: 100% !important;
            /* Ocupa exactamente la altura de la página menos los márgenes @page */
            min-height: calc(100vh - 20mm) !important;
            box-sizing: border-box !important;
          }

          /* El cuerpo central llena el espacio disponible */
          #cert-body {
            flex: 1 !important;
            min-height: 0 !important;
          }

          /* Sin saltos de página dentro de secciones clave */
          #cert-body > *, .patron-card, table { page-break-inside: avoid; }

          * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
        }
        @page { size: letter portrait; margin: 10mm 9mm; }
      `}</style>
    </>
  );
}
