"use client";

import { useState, useEffect, useCallback, use } from "react";
import { useRouter } from "next/navigation";
import AppHeader from "@/components/AppHeader";
import { useUser } from "@/context/AuthContext";

const GRUPOS = ["Diurno", "Nocturno", "G1", "G2", "G3", "G4"];
const DIAS_SEMANA = ["Lu", "Ma", "Mi", "Ju", "Vi", "Sa", "Do"];

const ESTADO_COLOR: Record<string, string> = {
  borrador: "#f59e0b", revision: "#3b82f6", publicado: "#16a34a",
};

type OtBorrador = {
  id: string; control: number | null; numeroOT: string; tipoOT: string;
  tipoTrabajo: string; descripcion: string; tag: string; descripcionEquipo: string;
  personas: number; hrsTrabajo: number; hhTotal: number;
  fechaInicioOt: string | null; fechaFinOt: string | null;
  diasTexto: string | null; dias: string[];
  grupo: string; personalAsignado: string[]; esGuardia: boolean;
};

type RosterItem = {
  id: string; nombre: string; grupo: string; disciplina: string;
  asistencia: string[]; esContratista: boolean;
};

type Plan = {
  id: string; semana: number; anio: number; areaCodigo: string; disciplina: string;
  estado: string; creadoPor: string;
  ots: OtBorrador[];
  roster: RosterItem[];
};

function formatFecha(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  return `${d.getDate().toString().padStart(2, "0")}/${(d.getMonth() + 1).toString().padStart(2, "0")}`;
}

function OtRow({ ot, onSave, onDelete, rosterNombres }: {
  ot: OtBorrador;
  onSave: (id: string, patch: Partial<OtBorrador>) => Promise<void>;
  onDelete: (id: string) => void;
  rosterNombres: string[];
}) {
  const [editando, setEditando] = useState(false);
  const [form, setForm] = useState({ ...ot });

  function set(field: string, value: unknown) {
    setForm(prev => ({ ...prev, [field]: value }));
  }

  async function guardar() {
    const patch: Partial<OtBorrador> = {
      grupo: form.grupo,
      personas: Number(form.personas),
      hrsTrabajo: Number(form.hrsTrabajo),
      fechaInicioOt: form.fechaInicioOt,
      fechaFinOt: form.fechaFinOt,
      diasTexto: form.diasTexto,
      personalAsignado: form.personalAsignado,
    };
    await onSave(ot.id, patch);
    setEditando(false);
  }

  if (!editando) {
    return (
      <tr style={{ borderBottom: "1px solid #f1f5f9" }}>
        <td style={{ padding: "7px 8px", fontSize: 12, color: "#64748b", width: 36 }}>{ot.control ?? "-"}</td>
        <td style={{ padding: "7px 8px", fontWeight: 700, fontSize: 12, color: "#0f2847", whiteSpace: "nowrap" }}>{ot.numeroOT}</td>
        <td style={{ padding: "7px 8px", fontSize: 12, color: "#374151", maxWidth: 180 }}>
          <div style={{ fontWeight: 600 }}>{ot.descripcion}</div>
          <div style={{ color: "#94a3b8", fontSize: 11 }}>{ot.tag}</div>
        </td>
        <td style={{ padding: "7px 8px", fontSize: 12, color: "#374151", whiteSpace: "nowrap" }}>
          {formatFecha(ot.fechaInicioOt)}{ot.fechaFinOt && ot.fechaFinOt !== ot.fechaInicioOt ? ` → ${formatFecha(ot.fechaFinOt)}` : ""}
        </td>
        <td style={{ padding: "7px 8px", fontSize: 12, color: "#374151", textAlign: "center" }}>
          {ot.personas}px{ot.hrsTrabajo}h = <strong>{ot.hhTotal}HH</strong>
        </td>
        <td style={{ padding: "7px 8px", fontSize: 11 }}>
          <span style={{
            padding: "2px 8px", borderRadius: 12,
            background: ot.grupo === "Nocturno" ? "#1e1b4b" : "#ede9fe",
            color: ot.grupo === "Nocturno" ? "white" : "#7c3aed",
            fontWeight: 600,
          }}>{ot.grupo}</span>
        </td>
        <td style={{ padding: "7px 8px", fontSize: 11, color: "#64748b", maxWidth: 140 }}>
          {ot.personalAsignado.length > 0 ? ot.personalAsignado.join(", ") : <span style={{ color: "#cbd5e1" }}>Sin asignar</span>}
        </td>
        <td style={{ padding: "7px 4px", textAlign: "center" }}>
          <button onClick={() => setEditando(true)} style={{
            padding: "3px 10px", borderRadius: 6, border: "1px solid #e2e8f0",
            background: "white", fontSize: 11, fontWeight: 600, cursor: "pointer", color: "#374151",
          }}>Editar</button>
        </td>
      </tr>
    );
  }

  return (
    <tr style={{ background: "#f8f7ff", borderBottom: "2px solid #7c3aed30" }}>
      <td colSpan={8} style={{ padding: "12px 8px" }}>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
          <div>
            <div style={{ fontSize: 11, fontWeight: 600, color: "#7c3aed", marginBottom: 3 }}>Grupo</div>
            <select value={form.grupo} onChange={e => set("grupo", e.target.value)}
              style={{ padding: "5px 8px", borderRadius: 6, border: "1.5px solid #7c3aed", fontSize: 12 }}>
              {GRUPOS.map(g => <option key={g}>{g}</option>)}
            </select>
          </div>
          <div>
            <div style={{ fontSize: 11, fontWeight: 600, color: "#64748b", marginBottom: 3 }}>Personas</div>
            <input type="number" min={1} max={20} value={form.personas} onChange={e => set("personas", e.target.value)}
              style={{ width: 60, padding: "5px 6px", borderRadius: 6, border: "1.5px solid #e2e8f0", fontSize: 12 }} />
          </div>
          <div>
            <div style={{ fontSize: 11, fontWeight: 600, color: "#64748b", marginBottom: 3 }}>Hrs/día</div>
            <input type="number" min={0} max={24} step={0.5} value={form.hrsTrabajo} onChange={e => set("hrsTrabajo", e.target.value)}
              style={{ width: 60, padding: "5px 6px", borderRadius: 6, border: "1.5px solid #e2e8f0", fontSize: 12 }} />
          </div>
          <div>
            <div style={{ fontSize: 11, fontWeight: 600, color: "#64748b", marginBottom: 3 }}>Inicio</div>
            <input type="date" value={form.fechaInicioOt?.slice(0, 10) ?? ""} onChange={e => set("fechaInicioOt", e.target.value)}
              style={{ padding: "5px 6px", borderRadius: 6, border: "1.5px solid #e2e8f0", fontSize: 12 }} />
          </div>
          <div>
            <div style={{ fontSize: 11, fontWeight: 600, color: "#64748b", marginBottom: 3 }}>Fin</div>
            <input type="date" value={form.fechaFinOt?.slice(0, 10) ?? ""} onChange={e => set("fechaFinOt", e.target.value)}
              style={{ padding: "5px 6px", borderRadius: 6, border: "1.5px solid #e2e8f0", fontSize: 12 }} />
          </div>
          <div>
            <div style={{ fontSize: 11, fontWeight: 600, color: "#64748b", marginBottom: 3 }}>Días</div>
            <div style={{ display: "flex", gap: 3 }}>
              {DIAS_SEMANA.map(d => (
                <button key={d}
                  onClick={() => {
                    const prev = form.dias ?? [];
                    set("dias", prev.includes(d) ? prev.filter((x: string) => x !== d) : [...prev, d]);
                  }}
                  style={{
                    width: 26, height: 26, borderRadius: 4, fontSize: 10, fontWeight: 700, cursor: "pointer",
                    border: "1.5px solid " + ((form.dias ?? []).includes(d) ? "#7c3aed" : "#e2e8f0"),
                    background: (form.dias ?? []).includes(d) ? "#7c3aed" : "white",
                    color: (form.dias ?? []).includes(d) ? "white" : "#374151",
                  }}
                >{d}</button>
              ))}
            </div>
          </div>
          <div style={{ minWidth: 180 }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: "#64748b", marginBottom: 3 }}>Personal asignado</div>
            <select multiple value={form.personalAsignado}
              onChange={e => set("personalAsignado", Array.from(e.target.selectedOptions, o => o.value))}
              style={{ width: "100%", height: 60, borderRadius: 6, border: "1.5px solid #e2e8f0", fontSize: 11, padding: "2px 4px" }}>
              {rosterNombres.map(n => <option key={n}>{n}</option>)}
            </select>
          </div>
          <div style={{ display: "flex", gap: 6, alignSelf: "flex-end" }}>
            <button onClick={guardar} style={{
              padding: "6px 14px", borderRadius: 6, border: "none", background: "#7c3aed",
              color: "white", fontSize: 12, fontWeight: 700, cursor: "pointer",
            }}>Guardar</button>
            <button onClick={() => setEditando(false)} style={{
              padding: "6px 10px", borderRadius: 6, border: "1px solid #e2e8f0",
              background: "white", fontSize: 12, cursor: "pointer",
            }}>Cancelar</button>
            <button onClick={() => onDelete(ot.id)} style={{
              padding: "6px 10px", borderRadius: 6, border: "1px solid #fecaca",
              background: "#fff5f5", color: "#dc2626", fontSize: 12, cursor: "pointer",
            }}>Eliminar</button>
          </div>
        </div>
      </td>
    </tr>
  );
}

export default function PlanDetalleePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { user, loading } = useUser();
  const router = useRouter();
  const [plan, setPlan] = useState<Plan | null>(null);
  const [cargando, setCargando] = useState(true);
  const [tab, setTab] = useState<"ots" | "roster">("ots");
  const [importandoOts, setImportandoOts] = useState(false);
  const [importandoRoster, setImportandoRoster] = useState(false);
  const [publicando, setPublicando] = useState(false);
  const [msg, setMsg] = useState("");

  useEffect(() => {
    if (!loading && !user) router.replace("/login");
  }, [loading, user, router]);

  const loadPlan = useCallback(async () => {
    setCargando(true);
    const res = await fetch(`/api/planificacion/${id}`);
    const data = await res.json();
    setPlan(data);
    setCargando(false);
  }, [id]);

  useEffect(() => { loadPlan(); }, [loadPlan]);

  async function patchOt(otId: string, patch: Partial<OtBorrador>) {
    await fetch(`/api/planificacion/${id}/ots/${otId}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    await loadPlan();
  }

  async function deleteOt(otId: string) {
    await fetch(`/api/planificacion/${id}/ots/${otId}`, { method: "DELETE" });
    await loadPlan();
  }

  async function importarOts(file: File) {
    setImportandoOts(true);
    setMsg("");
    const fd = new FormData();
    fd.append("file", file);
    const res = await fetch(`/api/planificacion/${id}/importar`, { method: "POST", body: fd });
    const data = await res.json();
    setMsg(data.ok ? `✓ ${data.importadas} OTs importadas` : `Error: ${data.error}`);
    setImportandoOts(false);
    await loadPlan();
  }

  async function importarRoster(file: File) {
    setImportandoRoster(true);
    setMsg("");
    const fd = new FormData();
    fd.append("file", file);
    const res = await fetch(`/api/planificacion/${id}/importar-roster`, { method: "POST", body: fd });
    const data = await res.json();
    setMsg(data.ok ? `✓ ${data.importados} técnicos importados del roster` : `Error: ${data.error}`);
    setImportandoRoster(false);
    await loadPlan();
  }

  async function publicarPlan() {
    if (!confirm("¿Publicar este plan? Se creará el Programa Semanal visible para todos los técnicos.")) return;
    setPublicando(true);
    setMsg("");
    const res = await fetch(`/api/planificacion/${id}/publicar`, { method: "POST" });
    const data = await res.json();
    if (data.ok) {
      setMsg("✓ Plan publicado como Programa Semanal");
      await loadPlan();
    } else {
      setMsg(`Error: ${data.error}`);
    }
    setPublicando(false);
  }

  if (loading || !user) return null;
  if (cargando) return (
    <div style={{ minHeight: "100vh", background: "#f1f5f9" }}>
      <AppHeader backHref="/planificacion" />
      <div style={{ textAlign: "center", padding: 60, color: "#94a3b8" }}>Cargando plan…</div>
    </div>
  );
  if (!plan) return (
    <div style={{ minHeight: "100vh", background: "#f1f5f9" }}>
      <AppHeader backHref="/planificacion" />
      <div style={{ textAlign: "center", padding: 60, color: "#dc2626" }}>Plan no encontrado</div>
    </div>
  );

  const totalHH = plan.ots.reduce((s, o) => s + o.hhTotal, 0);
  const rosterNombres = plan.roster.map(r => r.nombre);
  const yaPublicado = plan.estado === "publicado";

  return (
    <div style={{ minHeight: "100vh", background: "#f1f5f9" }}>
      <AppHeader backHref="/planificacion" />

      <main style={{ maxWidth: 1100, margin: "0 auto", padding: "20px 16px" }}>
        {/* Header del plan */}
        <div style={{ background: "white", borderRadius: 14, padding: "18px 22px", marginBottom: 16, boxShadow: "0 2px 12px rgba(0,0,0,0.06)" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
                <h1 style={{ fontSize: 20, fontWeight: 800, color: "#0f2847", margin: 0 }}>
                  Semana {plan.semana} / {plan.anio} — {plan.disciplina}
                </h1>
                <span style={{
                  padding: "3px 10px", borderRadius: 20, fontSize: 11, fontWeight: 700,
                  background: `${ESTADO_COLOR[plan.estado]}20`, color: ESTADO_COLOR[plan.estado],
                  textTransform: "uppercase",
                }}>{plan.estado}</span>
              </div>
              <div style={{ fontSize: 13, color: "#64748b" }}>
                {plan.ots.length} OTs · {totalHH.toFixed(0)} HH totales · {plan.roster.length} técnicos en roster
              </div>
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {!yaPublicado && (
                <button
                  onClick={publicarPlan}
                  disabled={publicando || plan.ots.length === 0}
                  style={{
                    padding: "8px 16px", borderRadius: 8, border: "none",
                    background: plan.ots.length === 0 ? "#e2e8f0" : "#16a34a",
                    color: plan.ots.length === 0 ? "#94a3b8" : "white",
                    fontWeight: 700, fontSize: 13, cursor: plan.ots.length === 0 ? "not-allowed" : "pointer",
                  }}
                >{publicando ? "Publicando…" : "📤 Publicar plan"}</button>
              )}
            </div>
          </div>
          {msg && (
            <div style={{
              marginTop: 10, padding: "8px 12px", borderRadius: 8,
              background: msg.startsWith("✓") ? "#f0fdf4" : "#fef2f2",
              color: msg.startsWith("✓") ? "#16a34a" : "#dc2626",
              fontSize: 13, fontWeight: 600,
            }}>{msg}</div>
          )}
        </div>

        {/* Tabs */}
        <div style={{ display: "flex", gap: 2, marginBottom: 14 }}>
          {(["ots", "roster"] as const).map(t => (
            <button key={t} onClick={() => setTab(t)} style={{
              padding: "8px 18px", borderRadius: t === "ots" ? "8px 8px 0 0" : "8px 8px 0 0",
              border: "none", cursor: "pointer", fontSize: 13, fontWeight: 700,
              background: tab === t ? "white" : "#e2e8f0",
              color: tab === t ? "#7c3aed" : "#64748b",
              borderBottom: tab === t ? "2px solid #7c3aed" : "2px solid transparent",
            }}>
              {t === "ots" ? `OTs (${plan.ots.length})` : `Roster (${plan.roster.length})`}
            </button>
          ))}
        </div>

        {/* Tab OTs */}
        {tab === "ots" && (
          <div style={{ background: "white", borderRadius: "0 12px 12px 12px", overflow: "hidden", boxShadow: "0 2px 12px rgba(0,0,0,0.06)" }}>
            <div style={{ padding: "12px 16px", borderBottom: "1px solid #f1f5f9", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: "#374151" }}>Lista de OTs del plan</div>
              {!yaPublicado && (
                <label style={{
                  padding: "6px 14px", borderRadius: 8, background: "#7c3aed14",
                  color: "#7c3aed", fontSize: 12, fontWeight: 700, cursor: "pointer",
                  border: "1.5px solid #7c3aed30",
                }}>
                  {importandoOts ? "Importando…" : "⬆ Importar Excel JDE"}
                  <input type="file" accept=".xlsx,.xls" style={{ display: "none" }}
                    onChange={e => e.target.files?.[0] && importarOts(e.target.files[0])} />
                </label>
              )}
            </div>

            {plan.ots.length === 0 ? (
              <div style={{ padding: 40, textAlign: "center", color: "#94a3b8" }}>
                <div style={{ marginBottom: 8 }}>No hay OTs. Importa el Excel JDE del área.</div>
                <div style={{ fontSize: 11, color: "#cbd5e1" }}>Formato: columnas numeroOT, tipoOT, tipoTrabajo, descripcion, tag, personas, hrsTrabajo, diasTexto, fechaInicioOt, fechaFinOt</div>
              </div>
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead>
                    <tr style={{ background: "#f8fafc" }}>
                      {["#", "OT", "Descripción / TAG", "Fechas", "HH", "Grupo", "Personal", ""].map(h => (
                        <th key={h} style={{ padding: "8px", fontSize: 11, fontWeight: 700, color: "#64748b", textAlign: "left", whiteSpace: "nowrap" }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {plan.ots.map(ot => (
                      <OtRow key={ot.id} ot={ot} onSave={patchOt} onDelete={deleteOt} rosterNombres={rosterNombres} />
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* Tab Roster */}
        {tab === "roster" && (
          <div style={{ background: "white", borderRadius: "0 12px 12px 12px", overflow: "hidden", boxShadow: "0 2px 12px rgba(0,0,0,0.06)" }}>
            <div style={{ padding: "12px 16px", borderBottom: "1px solid #f1f5f9", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: "#374151" }}>Técnicos disponibles esta semana</div>
              {!yaPublicado && (
                <label style={{
                  padding: "6px 14px", borderRadius: 8, background: "#0891b214",
                  color: "#0891b2", fontSize: 12, fontWeight: 700, cursor: "pointer",
                  border: "1.5px solid #0891b230",
                }}>
                  {importandoRoster ? "Importando…" : "⬆ Importar Roster E&I"}
                  <input type="file" accept=".xlsx,.xls" style={{ display: "none" }}
                    onChange={e => e.target.files?.[0] && importarRoster(e.target.files[0])} />
                </label>
              )}
            </div>

            {plan.roster.length === 0 ? (
              <div style={{ padding: 40, textAlign: "center", color: "#94a3b8" }}>
                No hay técnicos en el roster. Importa el archivo &quot;02 Roster E&amp;I 2026.xlsx&quot;.
              </div>
            ) : (
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ background: "#f8fafc" }}>
                    <th style={{ padding: "8px", fontSize: 11, fontWeight: 700, color: "#64748b", textAlign: "left" }}>Nombre</th>
                    <th style={{ padding: "8px", fontSize: 11, fontWeight: 700, color: "#64748b" }}>Grupo</th>
                    {[1,2,3,4,5,6,7].map(d => (
                      <th key={d} style={{ padding: "6px 4px", fontSize: 10, fontWeight: 700, color: "#64748b", textAlign: "center", width: 28 }}>
                        {["Lu","Ma","Mi","Ju","Vi","Sa","Do"][d-1]}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {plan.roster.map(r => (
                    <tr key={r.id} style={{ borderBottom: "1px solid #f1f5f9" }}>
                      <td style={{ padding: "7px 8px", fontSize: 13, fontWeight: 600, color: "#0f2847" }}>{r.nombre}</td>
                      <td style={{ padding: "7px 8px", textAlign: "center" }}>
                        <span style={{
                          padding: "2px 8px", borderRadius: 12, fontSize: 10, fontWeight: 700,
                          background: r.grupo === "Nocturno" ? "#1e1b4b" : "#ede9fe",
                          color: r.grupo === "Nocturno" ? "white" : "#7c3aed",
                        }}>{r.grupo}</span>
                      </td>
                      {(r.asistencia as string[]).slice(0, 7).map((a, i) => (
                        <td key={i} style={{ padding: "4px", textAlign: "center" }}>
                          <span style={{
                            display: "inline-block", width: 22, height: 22, borderRadius: 4, fontSize: 9, fontWeight: 700,
                            lineHeight: "22px", textAlign: "center",
                            background: a === "D" ? "#d1fae5" : a === "N" ? "#1e1b4b" : a === "V" ? "#fef3c7" : "#f1f5f9",
                            color: a === "D" ? "#065f46" : a === "N" ? "white" : a === "V" ? "#92400e" : "#94a3b8",
                          }}>{a || "—"}</span>
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
