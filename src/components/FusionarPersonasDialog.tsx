"use client";
/**
 * Fusiona dos registros de la misma persona: reasigna sus OT, roster,
 * reportes… a la que se conserva y borra la otra (ver lib/fusion-personas.ts).
 * Primero muestra qué se movería (simulación) y pide confirmar.
 */
import React, { useMemo, useState } from "react";

export interface PersonaFusionable {
  _id: string;
  nombre: string;
  jde: string;
  activo: boolean;
  vinculadoIam: boolean;
  cuentaIam: boolean;
  enPadron: boolean;
}

interface Plan {
  conservar: { id: string; nombre: string };
  eliminar: { id: string; nombre: string };
  referencias: Record<string, number>;
  competenciasCombinadas: number;
  desempenioCombinado: number;
  datosQuePasan: string[];
  avisos: string[];
}

interface Props {
  origen: PersonaFusionable;
  personas: PersonaFusionable[];
  onClose: () => void;
  onFusionado: (mensaje: string) => void;
}

const ETIQUETA_REF: Record<string, string> = {
  "OtTecnico.usuarioId": "Técnico en OT",
  "OtHistorial.usuarioId": "Historial de OT",
  "OtRegistroDiario.usuarioId": "Registros diarios de OT",
  "PersonalSemanal.usuarioId": "Personal semanal",
  "RosterSemanal.usuarioId": "Roster",
  "CuadrillaMiembro.tecnicoUsuarioId": "Cuadrillas",
  "ParadaGrupo.supervisorUsuarioId": "Supervisor de grupo (paradas)",
  "ParadaGrupoMiembro.usuarioId": "Miembro de grupo (paradas)",
  "ParadaReporteDiario.supervisorUsuarioId": "Reportes diarios de parada",
  "ReporteTurno.supervisorId": "Reportes de turno",
  "RegistroCalibracion.tecnicoId": "Calibraciones (técnico)",
  "RegistroCalibracion.supervisorId": "Calibraciones (supervisor)",
  "OtProgramada.personalAsignadoIds": "Personal asignado (programación)",
  "ParadaOt.personalAsignadoIds": "Personal asignado (paradas)",
  "PlanBorradorOt.personalAsignadoIds": "Personal asignado (planificación)",
};

const S = {
  overlay: { position: "fixed", inset: 0, background: "rgba(15,23,42,0.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: 16 } as React.CSSProperties,
  modal: { background: "white", borderRadius: 12, width: "100%", maxWidth: 620, maxHeight: "90vh", overflow: "auto", boxShadow: "0 20px 50px rgba(15,23,42,0.25)" } as React.CSSProperties,
  head: { padding: "16px 20px", borderBottom: "1px solid #e2e8f0", fontWeight: 700, color: "#0f2847", fontSize: 15 } as React.CSSProperties,
  body: { padding: "16px 20px", display: "flex", flexDirection: "column", gap: 12 } as React.CSSProperties,
  foot: { padding: "12px 20px", borderTop: "1px solid #e2e8f0", display: "flex", justifyContent: "flex-end", gap: 8 } as React.CSSProperties,
  input: { width: "100%", padding: "7px 11px", borderRadius: 7, border: "1.5px solid #cbd5e1", fontSize: 13, boxSizing: "border-box" } as React.CSSProperties,
  lista: { border: "1px solid #e2e8f0", borderRadius: 8, maxHeight: 220, overflow: "auto" } as React.CSSProperties,
  btn: { padding: "7px 14px", borderRadius: 7, border: "1px solid #e2e8f0", background: "white", color: "#475569", fontSize: 13, cursor: "pointer" } as React.CSSProperties,
  btnPrimario: { padding: "7px 16px", borderRadius: 7, border: "none", background: "#0f2847", color: "white", fontSize: 13, fontWeight: 600, cursor: "pointer" } as React.CSSProperties,
  btnPeligro: { padding: "7px 16px", borderRadius: 7, border: "none", background: "#dc2626", color: "white", fontSize: 13, fontWeight: 600, cursor: "pointer" } as React.CSSProperties,
  nota: { fontSize: 12, color: "#64748b" } as React.CSSProperties,
};

function etiquetas(p: PersonaFusionable): string {
  const e = [];
  if (p.vinculadoIam) e.push("entra a Sync");
  else if (p.cuentaIam) e.push("cuenta IAM");
  if (p.enPadron) e.push("en padrón IAM");
  if (!p.activo) e.push("inactiva");
  return e.join(" · ");
}

/** Cuánto pesa en el IAM: conviene conservar la que tiene cuenta o ficha. */
function peso(p: PersonaFusionable): number {
  return (p.vinculadoIam ? 4 : 0) + (p.cuentaIam ? 2 : 0) + (p.enPadron ? 1 : 0);
}

export function FusionarPersonasDialog({ origen, personas, onClose, onFusionado }: Props) {
  const [busqueda, setBusqueda] = useState("");
  const [otra, setOtra] = useState<PersonaFusionable | null>(null);
  const [conservarOrigen, setConservarOrigen] = useState(true);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState("");

  const candidatas = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    return personas
      .filter((p) => p._id !== origen._id)
      .filter((p) => !q || p.nombre.toLowerCase().includes(q) || (p.jde ?? "").includes(q))
      .slice(0, 50);
  }, [busqueda, personas, origen._id]);

  const conservar = otra ? (conservarOrigen ? origen : otra) : null;
  const eliminar = otra ? (conservarOrigen ? otra : origen) : null;

  function elegir(p: PersonaFusionable) {
    setOtra(p);
    setPlan(null);
    setError("");
    // Por defecto se conserva la que ya está enlazada al IAM
    setConservarOrigen(peso(origen) >= peso(p));
  }

  async function llamar(dry: boolean): Promise<(Plan & { ok: true }) | null> {
    if (!conservar || !eliminar) return null;
    setCargando(true); setError("");
    try {
      const r = await fetch("/api/usuarios/fusionar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conservarId: conservar._id, eliminarId: eliminar._id, dry }),
      });
      const j = await r.json();
      if (!j.ok) { setError(j.error ?? "No se pudo fusionar"); return null; }
      return j;
    } catch {
      setError("Error de conexión con Sync");
      return null;
    } finally {
      setCargando(false);
    }
  }

  async function revisar() {
    const r = await llamar(true);
    if (r) setPlan(r);
  }

  async function fusionar() {
    const r = await llamar(false);
    if (!r) return;
    const total = Object.values(r.referencias).reduce((s, n) => s + n, 0);
    onFusionado(`"${r.eliminar.nombre}" fusionado en "${r.conservar.nombre}": ${total} referencias reasignadas.`);
  }

  const totalRefs = plan ? Object.values(plan.referencias).reduce((s, n) => s + n, 0) : 0;

  return (
    <div style={S.overlay} role="dialog" aria-modal="true" aria-label="Fusionar personas duplicadas">
      <div style={S.modal}>
        <div style={S.head}>Fusionar duplicado de “{origen.nombre}”</div>
        <div style={S.body}>
          <div style={S.nota}>
            Para cuando la misma persona está cargada dos veces. Sus OT, roster, cuadrillas,
            reportes y calibraciones pasan a la que se conserva, y la otra se borra.
          </div>

          {!otra ? (
            <>
              <input
                style={S.input} autoFocus placeholder="Buscar el otro registro por nombre o JDE…"
                value={busqueda} onChange={(e) => setBusqueda(e.target.value)}
              />
              <div style={S.lista}>
                {candidatas.length === 0 ? (
                  <div style={{ ...S.nota, padding: 16, textAlign: "center" }}>Sin coincidencias.</div>
                ) : candidatas.map((p) => (
                  <button
                    key={p._id} type="button" onClick={() => elegir(p)}
                    style={{ display: "block", width: "100%", textAlign: "left", padding: "8px 12px", border: "none", borderBottom: "1px solid #f1f5f9", background: "white", cursor: "pointer" }}
                  >
                    <div style={{ fontSize: 13, color: "#0f172a", fontWeight: 600 }}>{p.nombre}</div>
                    <div style={S.nota}>{[p.jde && `JDE ${p.jde}`, etiquetas(p)].filter(Boolean).join(" · ") || "solo en Sync"}</div>
                  </button>
                ))}
              </div>
            </>
          ) : (
            <>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {[origen, otra].map((p) => {
                  const esConservada = conservar?._id === p._id;
                  return (
                    <label key={p._id} style={{ display: "flex", gap: 10, alignItems: "center", padding: "8px 12px", border: `1.5px solid ${esConservada ? "#16a34a" : "#e2e8f0"}`, borderRadius: 8, cursor: "pointer" }}>
                      <input
                        type="radio" name="conservar" checked={esConservada}
                        onChange={() => { setConservarOrigen(p._id === origen._id); setPlan(null); setError(""); }}
                      />
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 13, fontWeight: 600, color: "#0f172a" }}>{p.nombre}</div>
                        <div style={S.nota}>{[p.jde && `JDE ${p.jde}`, etiquetas(p)].filter(Boolean).join(" · ") || "solo en Sync"}</div>
                      </div>
                      <span style={{ fontSize: 11, fontWeight: 700, color: esConservada ? "#16a34a" : "#dc2626" }}>
                        {esConservada ? "SE CONSERVA" : "SE BORRA"}
                      </span>
                    </label>
                  );
                })}
                <button type="button" style={{ ...S.btn, alignSelf: "flex-start", fontSize: 12, padding: "3px 8px" }} onClick={() => { setOtra(null); setPlan(null); setError(""); }}>
                  ← Elegir otro registro
                </button>
              </div>

              {plan && (
                <div style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 8, padding: 12, fontSize: 13 }}>
                  <div style={{ fontWeight: 700, marginBottom: 6, color: "#0f2847" }}>
                    {totalRefs === 0 ? "No tiene referencias que mover." : `Se reasignan ${totalRefs} referencias:`}
                  </div>
                  <ul style={{ margin: 0, paddingLeft: 18 }}>
                    {Object.entries(plan.referencias).map(([k, n]) => (
                      <li key={k}>{ETIQUETA_REF[k] ?? k}: {n}</li>
                    ))}
                    {plan.competenciasCombinadas > 0 && <li>Competencias combinadas: {plan.competenciasCombinadas}</li>}
                    {plan.desempenioCombinado > 0 && <li>Desempeño combinado: {plan.desempenioCombinado}</li>}
                    {plan.datosQuePasan.length > 0 && <li>Datos que completa: {plan.datosQuePasan.join(", ")}</li>}
                  </ul>
                  {plan.avisos.map((a) => (
                    <div key={a} style={{ marginTop: 6, color: "#b45309" }}>⚠ {a}</div>
                  ))}
                </div>
              )}
            </>
          )}

          {error && (
            <div style={{ background: "#fee2e2", color: "#b91c1c", borderRadius: 8, padding: "8px 12px", fontSize: 13 }}>{error}</div>
          )}
        </div>
        <div style={S.foot}>
          <button type="button" style={S.btn} onClick={onClose} disabled={cargando}>Cancelar</button>
          {otra && !plan && (
            <button type="button" style={S.btnPrimario} onClick={() => void revisar()} disabled={cargando}>
              {cargando ? "Revisando…" : "Revisar qué se mueve"}
            </button>
          )}
          {plan && (
            <button type="button" style={S.btnPeligro} onClick={() => void fusionar()} disabled={cargando}>
              {cargando ? "Fusionando…" : `Fusionar y borrar “${plan.eliminar.nombre}”`}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
