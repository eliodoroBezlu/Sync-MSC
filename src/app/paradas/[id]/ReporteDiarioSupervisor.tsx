"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { SessionPayload } from "@/lib/auth";
import { DISCIPLINAS_PARADA, type DisciplinaParada } from "@/lib/parada/tipos";
import {
  generarReporteDiarioPdf,
  generarReporteReunionPdf,
  type DatosReportePdf,
} from "@/lib/parada/generarReporteDiarioPdf";
import type {
  OtConRetraso, ParadaDetalle, ParadaOtCli, ParadaReporteCli, PendienteParada,
  ReunionParada, TableroParada as TableroData, TurnoParada,
} from "./tipos";
import { fmtFecha, DISCIPLINA_LABEL, inp, btnPrim, btnSec } from "./ui";

interface Props {
  parada: ParadaDetalle;
  tablero: TableroData | null;
  /** El supervisor de área puede crear/emitir el reporte de SU área. */
  puedeEmitir: boolean;
  /** Admin/Superintendente: puede generar el PDF consolidado de la reunión. */
  puedeConsolidar: boolean;
  usuario: SessionPayload;
  /** Si viene, sólo se consideran las OTs de esa disciplina. */
  discFiltro?: DisciplinaParada | null;
  onChange: () => Promise<void>;
}

const TIPOS_PENDIENTE: PendienteParada["tipo"][] = ["material", "repuesto", "permiso", "apoyo", "otro"];

// SC TESA no tiene turno noche.
function turnosDeArea(area: string): TurnoParada[] {
  return area === "TESA" ? ["Dia"] : ["Dia", "Noche"];
}
function areasDeTurno(turno: TurnoParada): DisciplinaParada[] {
  return turno === "Noche" ? DISCIPLINAS_PARADA.filter((d) => d !== "TESA") : [...DISCIPLINAS_PARADA];
}

function diasEjec(iniIso: string, finIso: string): string[] {
  const ini = new Date(iniIso.slice(0, 10) + "T00:00:00Z");
  const fin = new Date(finIso.slice(0, 10) + "T00:00:00Z");
  const out: string[] = [];
  for (let t = ini.getTime(); t <= fin.getTime(); t += 86_400_000) out.push(new Date(t).toISOString().slice(0, 10));
  return out.length ? out : [iniIso.slice(0, 10)];
}

interface FormState {
  fecha: string;
  turno: TurnoParada;
  reunion: ReunionParada;
  supervisorNombre: string;
  resumen: string;
  avanceGlobalPct: string;
  hhPropias: string;
  otsTerminadas: string[];
  otsConRetraso: OtConRetraso[];
  pendientes: PendienteParada[];
  observaciones: string;
}

export default function ReporteDiarioSupervisor({
  parada, tablero, puedeEmitir, puedeConsolidar, usuario, discFiltro, onChange,
}: Props) {
  const dias = useMemo(
    () => diasEjec(parada.fechaEjecucionInicio, parada.fechaEjecucionFin),
    [parada.fechaEjecucionInicio, parada.fechaEjecucionFin],
  );

  // Área del reporte activo. El supervisor queda fijo a su disciplina;
  // el admin elige qué área ver / consolidar.
  const [areaActiva, setAreaActiva] = useState<DisciplinaParada>(discFiltro ?? "ELEC");

  // OTs de ejecución del área activa (para los chips y el PDF de área).
  const otsArea = useMemo(
    () => parada.ots.filter((o) => o.fase === "ejecucion" && o.disciplina === areaActiva),
    [parada.ots, areaActiva],
  );

  const [f, setF] = useState<FormState>({
    fecha: dias[0],
    turno: "Dia",
    reunion: "08:00",
    supervisorNombre: usuario.nombre ?? "",
    resumen: "",
    avanceGlobalPct: "",
    hhPropias: "",
    otsTerminadas: [],
    otsConRetraso: [],
    pendientes: [],
    observaciones: "",
  });
  const [repActual, setRepActual] = useState<ParadaReporteCli | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setF((p) => ({ ...p, [k]: v }));

  // Al cambiar área/fecha/turno/reunión, cargar el reporte existente de ESA área.
  const cargarExistente = useCallback(() => {
    const encontrado = parada.reportesDiarios.find(
      (r) =>
        r.fecha.slice(0, 10) === f.fecha &&
        r.turno === f.turno &&
        r.reunion === f.reunion &&
        r.disciplina === areaActiva,
    );
    setRepActual(encontrado ?? null);
    if (encontrado) {
      setF((p) => ({
        ...p,
        supervisorNombre: encontrado.supervisorNombre || p.supervisorNombre,
        resumen: encontrado.resumen ?? "",
        avanceGlobalPct: String(encontrado.avanceGlobalPct ?? ""),
        hhPropias: String(encontrado.hhPropias ?? ""),
        otsTerminadas: encontrado.otsTerminadas ?? [],
        otsConRetraso: encontrado.otsConRetraso ?? [],
        pendientes: encontrado.pendientes ?? [],
        observaciones: encontrado.observaciones ?? "",
      }));
    } else {
      // Sin reporte para esta combinación: limpiar los campos del formulario.
      setF((p) => ({
        ...p,
        resumen: "",
        avanceGlobalPct: "",
        hhPropias: "",
        otsTerminadas: [],
        otsConRetraso: [],
        pendientes: [],
        observaciones: "",
      }));
    }
  }, [parada.reportesDiarios, f.fecha, f.turno, f.reunion, areaActiva]);

  useEffect(() => {
    cargarExistente();
  }, [cargarExistente]);

  // SC TESA no tiene turno noche: si se elige TESA con turno Noche, forzar Día.
  useEffect(() => {
    if (areaActiva === "TESA" && f.turno === "Noche") {
      setF((p) => ({ ...p, turno: "Dia" }));
    }
  }, [areaActiva, f.turno]);

  // POST base (crea/actualiza) y devuelve el reporte con _id.
  async function postBase(prellenar: boolean): Promise<ParadaReporteCli | null> {
    const res = await fetch(`/api/paradas/${parada.id}/reportes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        fecha: f.fecha,
        turno: f.turno,
        reunion: f.reunion,
        disciplina: areaActiva,
        supervisorNombre: f.supervisorNombre || usuario.nombre || "—",
        supervisorUsuarioId: usuario.id,
        resumen: f.resumen,
        observaciones: f.observaciones || null,
        prellenar,
      }),
    });
    const data = await res.json();
    if (data.ok === false) {
      setMsg(data.error ?? "Error al guardar");
      return null;
    }
    return data.reporte as ParadaReporteCli;
  }

  async function patchRico(repId: string, estado?: "borrador" | "emitido") {
    const res = await fetch(`/api/paradas/${parada.id}/reportes/${repId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        resumen: f.resumen,
        avanceGlobalPct: Number(f.avanceGlobalPct) || 0,
        hhPropias: Number(f.hhPropias) || 0,
        otsTerminadas: f.otsTerminadas,
        otsConRetraso: f.otsConRetraso.filter((o) => o.numeroOT.trim()),
        pendientes: f.pendientes.filter((p) => p.detalle.trim()),
        observaciones: f.observaciones || null,
        ...(estado ? { estado } : {}),
      }),
    });
    const data = await res.json();
    if (data.ok === false) {
      setMsg(data.error ?? "Error al guardar detalle");
      return null;
    }
    return data.reporte as ParadaReporteCli;
  }

  async function prellenar() {
    setBusy(true);
    setMsg("");
    try {
      const rep = await postBase(true);
      if (!rep) return;
      setF((p) => ({
        ...p,
        avanceGlobalPct: String(rep.avanceGlobalPct ?? ""),
        hhPropias: String(rep.hhPropias ?? ""),
        otsTerminadas: rep.otsTerminadas ?? [],
      }));
      setRepActual(rep);
      setMsg("Prellenado desde los avances del turno.");
      await onChange();
    } finally {
      setBusy(false);
    }
  }

  async function guardar(emitir: boolean) {
    setBusy(true);
    setMsg("");
    try {
      const base = repActual ?? (await postBase(false));
      if (!base) return;
      const done = await patchRico(base._id, emitir ? "emitido" : "borrador");
      if (!done) return;
      setRepActual(done);
      setMsg(emitir ? "Reporte emitido." : "Borrador guardado.");
      await onChange();
    } finally {
      setBusy(false);
    }
  }

  function generarPdf() {
    const otPorNumero = new Map(otsArea.map((o) => [o.numeroOT, o]));
    const datos: DatosReportePdf = {
      paradaCodigo: parada.codigo,
      paradaNombre: parada.nombre,
      fecha: f.fecha,
      turno: f.turno,
      reunion: f.reunion,
      supervisorNombre: f.supervisorNombre || usuario.nombre || "—",
      resumen: f.resumen,
      avanceGlobalPct: Number(f.avanceGlobalPct) || tablero?.avanceGlobalPct || 0,
      hhPropias: Number(f.hhPropias) || 0,
      otsTerminadas: f.otsTerminadas,
      otsConRetraso: f.otsConRetraso.filter((o) => o.numeroOT.trim()),
      pendientes: f.pendientes.filter((p) => p.detalle.trim()),
      observaciones: f.observaciones || null,
      cumplimientoHoyPct: tablero ? Math.round(tablero.cumplimientoHoy * 100) : undefined,
      diaEtiqueta: tablero?.diaActual.etiqueta,
      hhEst: tablero?.hh.hhEst,
      detalleOts: f.otsTerminadas
        .map((num) => otPorNumero.get(num))
        .filter((o): o is NonNullable<typeof o> => Boolean(o))
        .map((o) => ({
          numeroOT: o.numeroOT,
          descripcion: o.descripcion,
          disciplina: DISCIPLINA_LABEL[o.disciplina] ?? o.disciplina,
          avancePct: o.avancePct,
          hhTurno: 0,
          estado: o.estado,
        })),
    };
    generarReporteDiarioPdf(datos);
  }

  // Construye los datos PDF de un reporte ya guardado de un área.
  function mapReporteADatos(rep: ParadaReporteCli, disc: DisciplinaParada): DatosReportePdf {
    const otsDisc = parada.ots.filter((o) => o.fase === "ejecucion" && o.disciplina === disc);
    const otPorNumero = new Map(otsDisc.map((o) => [o.numeroOT, o]));
    return {
      paradaCodigo: parada.codigo,
      paradaNombre: parada.nombre,
      fecha: rep.fecha.slice(0, 10),
      turno: rep.turno,
      reunion: rep.reunion,
      supervisorNombre: rep.supervisorNombre || "—",
      resumen: rep.resumen ?? "",
      avanceGlobalPct: rep.avanceGlobalPct ?? 0,
      hhPropias: rep.hhPropias ?? 0,
      otsTerminadas: rep.otsTerminadas ?? [],
      otsConRetraso: (rep.otsConRetraso ?? []).filter((o) => o.numeroOT.trim()),
      pendientes: (rep.pendientes ?? []).filter((p) => p.detalle.trim()),
      observaciones: rep.observaciones || null,
      cumplimientoHoyPct: tablero ? Math.round(tablero.cumplimientoHoy * 100) : undefined,
      diaEtiqueta: tablero?.diaActual.etiqueta,
      hhEst: tablero?.hh.hhEst,
      detalleOts: (rep.otsTerminadas ?? [])
        .map((num) => otPorNumero.get(num))
        .filter((o): o is NonNullable<typeof o> => Boolean(o))
        .map((o) => ({
          numeroOT: o.numeroOT,
          descripcion: o.descripcion,
          disciplina: DISCIPLINA_LABEL[o.disciplina] ?? o.disciplina,
          avancePct: o.avancePct,
          hhTurno: 0,
          estado: o.estado,
        })),
    };
  }

  // Admin: PDF consolidado de la reunión con las áreas del turno (sólo emitidas).
  function generarPdfReunion() {
    const areas = areasDeTurno(f.turno).map((disc) => {
      const rep = parada.reportesDiarios.find(
        (r) =>
          r.fecha.slice(0, 10) === f.fecha &&
          r.turno === f.turno &&
          r.reunion === f.reunion &&
          r.disciplina === disc,
      );
      return {
        disciplina: disc,
        label: DISCIPLINA_LABEL[disc] ?? disc,
        datos: rep && rep.estado === "emitido" ? mapReporteADatos(rep, disc) : null,
      };
    });
    generarReporteReunionPdf({
      paradaCodigo: parada.codigo,
      paradaNombre: parada.nombre,
      fecha: f.fecha,
      turno: f.turno,
      reunion: f.reunion,
      areas,
    });
  }

  const toggleTerminada = (num: string) =>
    set(
      "otsTerminadas",
      f.otsTerminadas.includes(num) ? f.otsTerminadas.filter((n) => n !== num) : [...f.otsTerminadas, num],
    );

  return (
    <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) 300px", gap: 20 }}>
      {/* ── Formulario ─────────────────────────────────────────────── */}
      <div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 14 }}>
          <label style={campo}>
            <span style={lbl}>Área</span>
            {discFiltro ? (
              <input
                value={DISCIPLINA_LABEL[discFiltro] ?? discFiltro}
                disabled
                style={{ ...inp, background: "#f1f5f9" }}
              />
            ) : (
              <select
                value={areaActiva}
                onChange={(e) => setAreaActiva(e.target.value as DisciplinaParada)}
                style={inp}
              >
                {DISCIPLINAS_PARADA.map((d) => (
                  <option key={d} value={d}>{DISCIPLINA_LABEL[d] ?? d}</option>
                ))}
              </select>
            )}
          </label>
          <label style={campo}>
            <span style={lbl}>Fecha</span>
            <select value={f.fecha} onChange={(e) => set("fecha", e.target.value)} style={inp}>
              {dias.map((d) => (
                <option key={d} value={d}>{fmtFecha(d)}</option>
              ))}
            </select>
          </label>
          <label style={campo}>
            <span style={lbl}>Turno</span>
            <select value={f.turno} onChange={(e) => set("turno", e.target.value as TurnoParada)} style={inp}>
              {turnosDeArea(areaActiva).map((t) => (
                <option key={t} value={t}>{t === "Dia" ? "Día" : "Noche"}</option>
              ))}
            </select>
          </label>
          <label style={campo}>
            <span style={lbl}>Reunión</span>
            <select value={f.reunion} onChange={(e) => set("reunion", e.target.value as ReunionParada)} style={inp}>
              <option value="08:00">08:00 AM</option>
              <option value="17:00">17:00 PM</option>
            </select>
          </label>
          <label style={{ ...campo, flex: 1, minWidth: 180 }}>
            <span style={lbl}>Supervisor</span>
            <input value={f.supervisorNombre} onChange={(e) => set("supervisorNombre", e.target.value)} style={inp} />
          </label>
        </div>

        {repActual && (
          <div style={{ fontSize: 11, marginBottom: 10, color: repActual.estado === "emitido" ? "#15803d" : "#d97706" }}>
            {repActual.estado === "emitido" ? "● Reporte emitido" : "○ Borrador guardado"} — última actualización {fmtFecha(repActual.updatedAt)}
          </div>
        )}

        {puedeEmitir && (
          <button onClick={prellenar} disabled={busy} style={{ ...btnSec, marginBottom: 12 }}>
            ↻ Prellenar desde avances del turno
          </button>
        )}

        <label style={{ display: "block", marginBottom: 12 }}>
          <span style={lbl}>Resumen del turno</span>
          <textarea
            value={f.resumen}
            onChange={(e) => set("resumen", e.target.value)}
            rows={3}
            style={{ ...inp, resize: "vertical" }}
            placeholder="Qué se avanzó, hitos alcanzados, coordinación con operaciones…"
          />
        </label>

        <div style={{ display: "flex", gap: 10, marginBottom: 14, flexWrap: "wrap" }}>
          <label style={campo}>
            <span style={lbl}>Avance global %</span>
            <input type="number" min={0} max={100} value={f.avanceGlobalPct} onChange={(e) => set("avanceGlobalPct", e.target.value)} style={inp} />
          </label>
          <label style={campo}>
            <span style={lbl}>HH propias</span>
            <input type="number" min={0} step={0.5} value={f.hhPropias} onChange={(e) => set("hhPropias", e.target.value)} style={inp} />
          </label>
        </div>

        {/* OTs terminadas (del área activa) */}
        <div style={{ marginBottom: 14 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <span style={lbl}>
              OTs terminadas en el turno · {DISCIPLINA_LABEL[areaActiva] ?? areaActiva}
            </span>
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 4 }}>
            {otsArea.length === 0 && (
              <span style={{ fontSize: 12, color: "#94a3b8" }}>Sin OTs de ejecución para esta área.</span>
            )}
            {otsArea.map((o) => {
              const on = f.otsTerminadas.includes(o.numeroOT);
              return (
                <button
                  key={o.id}
                  onClick={() => toggleTerminada(o.numeroOT)}
                  title={o.descripcion}
                  style={{
                    padding: "4px 10px",
                    borderRadius: 14,
                    border: "1.5px solid",
                    borderColor: on ? "#15803d" : "#e2e8f0",
                    background: on ? "#dcfce7" : "white",
                    color: on ? "#15803d" : "#64748b",
                    fontSize: 11,
                    fontWeight: 600,
                    cursor: "pointer",
                  }}
                >
                  {on ? "✓ " : ""}{o.numeroOT}
                </button>
              );
            })}
          </div>
        </div>

        {/* OTs con retraso */}
        <div style={{ marginBottom: 14 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={lbl}>OTs con retraso y acción</span>
            <button
              onClick={() => set("otsConRetraso", [...f.otsConRetraso, { numeroOT: "", motivo: "", accion: "" }])}
              style={{ ...btnSec, padding: "3px 10px", fontSize: 12 }}
            >
              + fila
            </button>
          </div>
          {f.otsConRetraso.map((o, i) => (
            <div key={i} style={{ display: "flex", gap: 6, marginTop: 6 }}>
              <input
                placeholder="N° OT"
                value={o.numeroOT}
                onChange={(e) => {
                  const next = [...f.otsConRetraso];
                  next[i] = { ...o, numeroOT: e.target.value };
                  set("otsConRetraso", next);
                }}
                style={{ ...inp, width: 110 }}
              />
              <input
                placeholder="Motivo"
                value={o.motivo}
                onChange={(e) => {
                  const next = [...f.otsConRetraso];
                  next[i] = { ...o, motivo: e.target.value };
                  set("otsConRetraso", next);
                }}
                style={inp}
              />
              <input
                placeholder="Acción correctiva"
                value={o.accion}
                onChange={(e) => {
                  const next = [...f.otsConRetraso];
                  next[i] = { ...o, accion: e.target.value };
                  set("otsConRetraso", next);
                }}
                style={inp}
              />
              <button
                onClick={() => set("otsConRetraso", f.otsConRetraso.filter((_, j) => j !== i))}
                style={{ ...btnSec, padding: "3px 8px", color: "#dc2626", borderColor: "#fecaca" }}
              >
                ✕
              </button>
            </div>
          ))}
        </div>

        {/* Pendientes */}
        <div style={{ marginBottom: 14 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={lbl}>Pendientes / requerimientos</span>
            <button
              onClick={() => set("pendientes", [...f.pendientes, { tipo: "material", detalle: "" }])}
              style={{ ...btnSec, padding: "3px 10px", fontSize: 12 }}
            >
              + fila
            </button>
          </div>
          {f.pendientes.map((p, i) => (
            <div key={i} style={{ display: "flex", gap: 6, marginTop: 6 }}>
              <select
                value={p.tipo}
                onChange={(e) => {
                  const next = [...f.pendientes];
                  next[i] = { ...p, tipo: e.target.value as PendienteParada["tipo"] };
                  set("pendientes", next);
                }}
                style={{ ...inp, width: 130 }}
              >
                {TIPOS_PENDIENTE.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
              <input
                placeholder="Detalle"
                value={p.detalle}
                onChange={(e) => {
                  const next = [...f.pendientes];
                  next[i] = { ...p, detalle: e.target.value };
                  set("pendientes", next);
                }}
                style={inp}
              />
              <button
                onClick={() => set("pendientes", f.pendientes.filter((_, j) => j !== i))}
                style={{ ...btnSec, padding: "3px 8px", color: "#dc2626", borderColor: "#fecaca" }}
              >
                ✕
              </button>
            </div>
          ))}
        </div>

        <label style={{ display: "block", marginBottom: 14 }}>
          <span style={lbl}>Observaciones</span>
          <textarea value={f.observaciones} onChange={(e) => set("observaciones", e.target.value)} rows={2} style={{ ...inp, resize: "vertical" }} />
        </label>

        {msg && (
          <div style={{ fontSize: 12, marginBottom: 10, color: msg.includes("Error") ? "#dc2626" : "#15803d" }}>{msg}</div>
        )}

        {/* Admin/Superintendente: estado de los reportes de área para esta reunión */}
        {puedeConsolidar && (
          <div style={{ marginBottom: 12, padding: "10px 12px", borderRadius: 10, background: "#f8fafc", border: "1.5px solid #e2e8f0" }}>
            <span style={lbl}>
              Estado de reportes · {fmtFecha(f.fecha)} · {f.turno === "Dia" ? "Día" : "Noche"} · {f.reunion}
            </span>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginTop: 6 }}>
              {areasDeTurno(f.turno).map((disc) => {
                const rep = parada.reportesDiarios.find(
                  (r) =>
                    r.fecha.slice(0, 10) === f.fecha &&
                    r.turno === f.turno &&
                    r.reunion === f.reunion &&
                    r.disciplina === disc,
                );
                const emitido = rep?.estado === "emitido";
                const color = emitido ? "#15803d" : rep ? "#d97706" : "#94a3b8";
                const icono = emitido ? "✓" : rep ? "○" : "—";
                return (
                  <span key={disc} style={{ fontSize: 12, fontWeight: 700, color, display: "inline-flex", gap: 4, alignItems: "center" }}>
                    {icono} {DISCIPLINA_LABEL[disc] ?? disc}
                    <span style={{ fontWeight: 500, color: "#94a3b8" }}>
                      {emitido ? "emitido" : rep ? "borrador" : "sin reporte"}
                    </span>
                  </span>
                );
              })}
            </div>
          </div>
        )}

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {puedeEmitir && (
            <>
              <button onClick={() => guardar(false)} disabled={busy} style={btnSec}>
                Guardar borrador
              </button>
              <button onClick={() => guardar(true)} disabled={busy} style={btnPrim}>
                Emitir reporte
              </button>
              <button onClick={generarPdf} style={{ ...btnSec, borderColor: "#0f2847", color: "#0f2847" }}>
                PDF de mi área
              </button>
            </>
          )}
          {puedeConsolidar && (
            <button onClick={generarPdfReunion} style={{ ...btnPrim, background: "#0f2847" }}>
              Generar PDF de la reunión
            </button>
          )}
        </div>
      </div>

      {/* ── Historial ─────────────────────────────────────────────── */}
      <div>
        <h3 style={{ fontSize: 13, fontWeight: 700, color: "#0f2847", margin: "0 0 8px" }}>
          Reportes emitidos
        </h3>
        {parada.reportesDiarios.length === 0 && (
          <p style={{ fontSize: 12, color: "#94a3b8" }}>Aún no hay reportes.</p>
        )}
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {parada.reportesDiarios.map((r) => (
            <button
              key={r._id}
              onClick={() => {
                if (!discFiltro) setAreaActiva(r.disciplina as DisciplinaParada);
                set("fecha", r.fecha.slice(0, 10));
                set("turno", r.turno);
                set("reunion", r.reunion);
              }}
              style={{
                textAlign: "left",
                padding: "8px 10px",
                borderRadius: 8,
                border: "1.5px solid #e2e8f0",
                background: repActual?._id === r._id ? "#fff7ed" : "white",
                cursor: "pointer",
              }}
            >
              <div style={{ fontSize: 12, fontWeight: 700, color: "#0f2847" }}>
                {fmtFecha(r.fecha)} · {r.turno === "Dia" ? "Día" : "Noche"} · {r.reunion}
              </div>
              <div style={{ fontSize: 11, color: "#64748b" }}>
                {DISCIPLINA_LABEL[r.disciplina] ?? r.disciplina} · Avance {r.avanceGlobalPct}% ·{" "}
                {r.hhPropias.toFixed(0)} HH ·{" "}
                <span style={{ color: r.estado === "emitido" ? "#15803d" : "#d97706" }}>{r.estado}</span>
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

const campo: React.CSSProperties = { display: "flex", flexDirection: "column", gap: 3, minWidth: 120 };
const lbl: React.CSSProperties = { fontSize: 11, fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.04em" };
