"use client";

import { useState, useEffect, useCallback } from "react";
import AppHeader from "@/components/AppHeader";
import { useUser } from "@/context/AuthContext";
import TecnicosPanel from "@/components/TecnicosPanel";
import { tipoOtDisplay } from "@/lib/tiposOt";


// ─── Helpers de semana ISO ────────────────────────────────────────────────────

function isoWeekNumber(date: Date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
}

function getMondayOfWeek(anio: number, semana: number): Date {
  const jan4 = new Date(Date.UTC(anio, 0, 4));
  const day = jan4.getUTCDay() || 7;
  const monday = new Date(jan4);
  monday.setUTCDate(jan4.getUTCDate() - day + 1 + (semana - 1) * 7);
  return monday;
}

function isoDateStr(d: Date) {
  return d.toISOString().split("T")[0];
}

// ─── Types ────────────────────────────────────────────────────────────────────

type OTPlan = {
  numeroOT: string;
  tag: string;
  descripcion: string;
  grupo: string; // "Diurno" | "Nocturno"
  dia: string;
  esGuardia?: boolean;
};

type Programa = {
  _id: string;
  disciplina: string;
  areaCodigo: string;
  otsProgramadas: OTPlan[];
};

type Linea = {
  tag: string;
  tipoOT: string;
  sintoma?: string;
  resolucionAplicada?: string;
  tiempoRealHrs?: number;
  descripcionEquipo?: string;
  descripcionTrabajo?: string;
  tareasEjecutadas?: string[];
  observaciones?: string;
};

type RegistroDiario = {
  _id?: string;
  fecha: string;
  turno?: string | null;
  tecnico: string;
  hhTrabajadas: number;
  tareasEjecutadas: string[];
  observaciones?: string | null;
};

type OTReactiva = {
  _id: string;
  numeroOT: string;
  fecha: string;
  turno: string;
  areaCodigo: string;
  otJdeNumero?: string;
  tecnicos: { usuarioId?: string; nombreCompleto: string }[];
  lineas: Linea[];
  estado: string;
  registrosDiarios?: RegistroDiario[];
};

// Un "avance" es un registro diario individual (una jornada de trabajo) de una OT.
// Antes, OPEPLANT acumulaba todos los avances del ciclo en una sola OT madre cuya
// fecha/turno quedaban fijos desde su creación — por eso avances posteriores en
// otro día/turno nunca aparecían en la grilla. Ahora cada avance se posiciona
// según su propio registro diario, no según la fecha/turno estáticos de la OT.
type Avance = {
  cardId: string;
  ot: OTReactiva;
  fecha: string;
  turno: string;
  tecnico: string;
  hhTrabajadas: number;
  tareasEjecutadas: string[];
  observaciones?: string | null;
};

function avancesDeOT(ot: OTReactiva): Avance[] {
  const registros = ot.registrosDiarios ?? [];
  if (registros.length > 0) {
    return registros.map(r => ({
      cardId: r._id ?? `${ot._id}-${r.fecha}`,
      ot,
      fecha: r.fecha,
      turno: r.turno || ot.turno,
      tecnico: r.tecnico,
      hhTrabajadas: r.hhTrabajadas,
      tareasEjecutadas: r.tareasEjecutadas,
      observaciones: r.observaciones,
    }));
  }
  // OT legacy sin registrosDiarios: usar los datos estáticos de la OT como único avance
  const multiplesLineas = ot.lineas.length > 1;
  const observaciones = ot.lineas
    .map(l => {
      const texto = [l.descripcionTrabajo, l.observaciones].filter(Boolean).join(" — ");
      if (!texto) return null;
      return multiplesLineas ? `[${l.tag}] ${texto}` : texto;
    })
    .filter(Boolean)
    .join(" | ") || null;
  return [{
    cardId: ot._id,
    ot,
    fecha: ot.fecha,
    turno: ot.turno,
    tecnico: ot.tecnicos.map(t => t.nombreCompleto).join(" · ") || "—",
    hhTrabajadas: ot.lineas.reduce((s, l) => s + (l.tiempoRealHrs ?? 0), 0),
    tareasEjecutadas: ot.lineas.flatMap(l =>
      (l.tareasEjecutadas ?? []).map(t => multiplesLineas ? `[${l.tag}] ${t}` : t)
    ),
    observaciones,
  }];
}

// ─── Constantes ───────────────────────────────────────────────────────────────

const DIAS_SEMANA = ["Lu", "Ma", "Mi", "Ju", "Vi", "Sa", "Do"] as const;
const DIAS_FULL: Record<string, string> = {
  Lu: "Lunes", Ma: "Martes", Mi: "Miércoles",
  Ju: "Jueves", Vi: "Viernes", Sa: "Sábado", Do: "Domingo",
};

const ESTADO_COLOR: Record<string, string> = {
  borrador: "#64748b", pendiente_revision: "#d97706",
  solicitar_correccion: "#dc2626", revisado: "#2563eb", concluido: "#16a34a",
};
const ESTADO_LABEL: Record<string, string> = {
  borrador: "Borrador", pendiente_revision: "Pend. revisión",
  solicitar_correccion: "Corrección", revisado: "Revisado", concluido: "Concluido",
};
function tipoColor(tipoOT: string): string {
  return tipoOtDisplay(tipoOT).color.color;
}

// ─── Estilos ──────────────────────────────────────────────────────────────────

const S = {
  badge: (color: string) => ({
    display: "inline-block" as const,
    background: color + "18", color,
    border: `1px solid ${color}40`,
    borderRadius: 5, padding: "2px 8px",
    fontSize: 11, fontWeight: 700, whiteSpace: "nowrap" as const,
  }),
};

// ─── Componente principal ─────────────────────────────────────────────────────

type EditForm = {
  estado: string;
  tecnicos: { usuarioId: string; nombreCompleto: string }[];
  lineas: { tag: string; descripcionEquipo: string; tipoOT: string; sintoma: string; resolucionAplicada: string; tiempoRealHrs: string; descripcionTrabajo: string; observaciones: string }[];
};

export default function TurneroPage() {
  const { user } = useUser();
  const esAdmin = user?.rol === 1;
  const esSup   = user ? user.rol <= 3 : false;
  const hoy = new Date();

  const [semana, setSemana] = useState(isoWeekNumber(hoy));
  const [anio, setAnio]     = useState(hoy.getFullYear());
  const [programas, setProgramas]       = useState<Programa[]>([]);
  const [otsReactivas, setOtsReactivas] = useState<OTReactiva[]>([]);
  const [loading, setLoading]           = useState(false);
  const [deletingId, setDeletingId]     = useState<string | null>(null);
  const [editingOt, setEditingOt]       = useState<OTReactiva | null>(null);
  const [editForm, setEditForm]         = useState<EditForm | null>(null);
  const [saving, setSaving]             = useState(false);
  const [saveErr, setSaveErr]           = useState("");

  // Fechas de la semana
  const lunes = getMondayOfWeek(anio, semana);
  const domingo = new Date(lunes); domingo.setUTCDate(lunes.getUTCDate() + 6);

  // Mapa día abrev → fecha
  const fechasDias = DIAS_SEMANA.reduce<Record<string, Date>>((acc, d, i) => {
    const f = new Date(lunes); f.setUTCDate(lunes.getUTCDate() + i);
    acc[d] = f; return acc;
  }, {});

  const cargar = useCallback(async () => {
    setLoading(true);
    try {
      // 1. Cargar programación semanal — filtrada por áreas del usuario
      const userAreas: string[] = user?.areas ?? [];
      const progData = await fetch(
        `/api/programacion-semanal?semana=${semana}&anio=${anio}&limit=20`
      ).then(r => r.json()).catch(() => []);
      const todosProgs: Programa[] = Array.isArray(progData) ? progData : [];
      // Si el usuario tiene áreas asignadas, filtrar solo sus áreas
      const progs = userAreas.length > 0
        ? todosProgs.filter(p => p.areaCodigo && userAreas.includes(p.areaCodigo))
        : todosProgs;
      setProgramas(progs);

      // 2. Extraer números OPEPLANT únicos de esta semana
      const opeplants = new Set<string>();
      for (const prog of progs) {
        for (const ot of prog.otsProgramadas) {
          if (ot.esGuardia || ot.tag === "OPEPLANT") {
            opeplants.add(ot.numeroOT);
          }
        }
      }

      if (opeplants.size === 0) { setOtsReactivas([]); return; }

      // 3. Para cada OPEPLANT, buscar OTs reactivas vinculadas en el rango de la semana
      const promesas = Array.from(opeplants).map(num =>
        fetch(
          `/api/ordenes?otJdeNumero=${num}&fechaDesde=${isoDateStr(lunes)}&fechaHasta=${isoDateStr(domingo)}&limit=200`
        ).then(r => r.json()).catch(() => [])
      );
      const resultados = await Promise.all(promesas);
      const todas: OTReactiva[] = resultados.flat().filter(Boolean);
      // Filtrar por áreas del usuario si están definidas
      const filtradas = userAreas.length > 0
        ? todas.filter(ot => !ot.areaCodigo || userAreas.includes(ot.areaCodigo))
        : todas;
      setOtsReactivas(filtradas);
    } finally {
      setLoading(false);
    }
  }, [semana, anio, user]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { cargar(); }, [cargar]);

  function abrirEditar(ot: OTReactiva) {
    setEditingOt(ot);
    setEditForm({
      estado: ot.estado,
      tecnicos: ot.tecnicos.map(t => ({ usuarioId: t.usuarioId ?? "", nombreCompleto: t.nombreCompleto })),
      lineas: ot.lineas.map(l => ({
        tag: l.tag,
        descripcionEquipo: l.descripcionEquipo ?? "",
        tipoOT: l.tipoOT,
        sintoma: l.sintoma ?? "",
        resolucionAplicada: l.resolucionAplicada ?? "",
        tiempoRealHrs: String(l.tiempoRealHrs ?? ""),
        descripcionTrabajo: l.descripcionTrabajo ?? "",
        observaciones: l.observaciones ?? "",
      })),
    });
    setSaveErr("");
  }

  async function guardarEdicion() {
    if (!editingOt || !editForm) return;
    setSaving(true); setSaveErr("");
    try {
      const res = await fetch(`/api/ordenes/${editingOt._id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          estado: editForm.estado,
          tecnicos: editForm.tecnicos,
          lineas: editForm.lineas.map(l => ({
            ...l,
            tiempoRealHrs: l.tiempoRealHrs ? parseFloat(l.tiempoRealHrs) : null,
          })),
          cambio: `Edición desde Bitácora Turnero por ${user?.nombre ?? "usuario"}`,
          usuarioId: user?.id ?? "",
          nombreUsuario: user?.nombre ?? "",
        }),
      });
      if (!res.ok) {
        const d = await res.json();
        throw new Error(d.error ?? "Error al guardar");
      }
      // Actualizar estado local
      setOtsReactivas(prev => prev.map(o => {
        if (o._id !== editingOt._id) return o;
        return {
          ...o,
          estado: editForm.estado,
          tecnicos: editForm.tecnicos,
          lineas: editForm.lineas.map(l => ({
            ...l,
            tiempoRealHrs: l.tiempoRealHrs ? parseFloat(l.tiempoRealHrs) : undefined,
          })),
        };
      }));
      setEditingOt(null);
      setEditForm(null);
    } catch (e: unknown) {
      setSaveErr(e instanceof Error ? e.message : "Error desconocido");
    } finally {
      setSaving(false);
    }
  }

  function navSemana(dir: -1 | 1) {
    const n = semana + dir;
    if (n < 1)       { setSemana(52); setAnio(a => a - 1); }
    else if (n > 52) { setSemana(1);  setAnio(a => a + 1); }
    else setSemana(n);
  }

  // ── Áreas únicas presentes en los programas cargados ─────────────────────────
  type AreaInfo = { areaCodigo: string; disciplina: string };
  const areasUnicas: AreaInfo[] = [];
  const areasSeen = new Set<string>();
  for (const prog of programas) {
    const key = prog.areaCodigo || prog.disciplina;
    if (!areasSeen.has(key)) {
      areasSeen.add(key);
      areasUnicas.push({ areaCodigo: prog.areaCodigo, disciplina: prog.disciplina });
    }
  }

  // ── Identificar OPEPLANT del plan por área y grupo ────────────────────────────
  type OpeplantInfo = { numeroOT: string; grupo: string; disciplina: string; dia: string; areaCodigo: string };
  const opeplantEntradas: OpeplantInfo[] = [];
  for (const prog of programas) {
    for (const ot of prog.otsProgramadas) {
      if (ot.esGuardia || ot.tag === "OPEPLANT") {
        opeplantEntradas.push({
          numeroOT: ot.numeroOT,
          grupo: ot.grupo,
          disciplina: prog.disciplina,
          dia: ot.dia,
          areaCodigo: prog.areaCodigo,
        });
      }
    }
  }

  const grupos = ["Diurno", "Nocturno"] as const;

  const avances = otsReactivas.flatMap(avancesDeOT);

  // Avances filtrados por área y turno (cada avance se posiciona por su propio día/turno)
  function avancesDeAreaGrupo(areaCodigo: string, grupo: string): Avance[] {
    return avances.filter(a =>
      a.turno === grupo && (!a.ot.areaCodigo || a.ot.areaCodigo === areaCodigo)
    );
  }

  function avancesPorAreaDia(areaCodigo: string, grupo: string, diaAbrev: string): Avance[] {
    const fechaStr = isoDateStr(fechasDias[diaAbrev]);
    return avancesDeAreaGrupo(areaCodigo, grupo).filter(a => a.fecha.startsWith(fechaStr));
  }

  // KPIs globales
  const totalAvances = avances.length;
  const totalHH  = avances.reduce((s, a) => s + a.hhTrabajadas, 0);
  const diasConOTs = new Set(avances.map(a => a.fecha.slice(0, 10))).size;

  if (!user) return null;

  return (
    <>
    <div style={{ minHeight: "100vh", background: "#f1f5f9" }}>
      <AppHeader backHref="/ordenes" />

      {/* Header */}
      <div style={{ background: "white", borderBottom: "1px solid #e2e8f0", padding: "14px 20px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <div>
            <h1 style={{ fontSize: 18, fontWeight: 800, color: "#0f2847" }}>Bitácora Turnero</h1>
            <p style={{ fontSize: 12, color: "#94a3b8" }}>OTs reactivas vinculadas a OPEPLANT — acumulado semanal</p>
          </div>
          <div style={{ flex: 1 }} />
          {/* Navegador semana */}
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <button
              onClick={() => navSemana(-1)}
              style={{ width: 32, height: 32, border: "1px solid #e2e8f0", borderRadius: 8, background: "white", cursor: "pointer", fontSize: 16, fontWeight: 700, color: "#0f2847", display: "flex", alignItems: "center", justifyContent: "center" }}
            >‹</button>
            <div style={{ fontSize: 15, fontWeight: 800, color: "#0f2847", background: "#f8fafc", borderRadius: 8, padding: "5px 14px", border: "1px solid #e2e8f0" }}>
              Sem {semana} · {anio}
              <span style={{ fontSize: 11, fontWeight: 400, color: "#94a3b8", marginLeft: 8 }}>
                {lunes.toLocaleDateString("es-BO", { day: "2-digit", month: "short", timeZone: "UTC" })} – {domingo.toLocaleDateString("es-BO", { day: "2-digit", month: "short", timeZone: "UTC" })}
              </span>
            </div>
            <button
              onClick={() => navSemana(1)}
              style={{ width: 32, height: 32, border: "1px solid #e2e8f0", borderRadius: 8, background: "white", cursor: "pointer", fontSize: 16, fontWeight: 700, color: "#0f2847", display: "flex", alignItems: "center", justifyContent: "center" }}
            >›</button>
          </div>
          <button onClick={cargar} style={{ border: "1px solid #e2e8f0", borderRadius: 8, background: "white", cursor: "pointer", fontSize: 13, color: "#64748b", padding: "6px 12px" }}>
            ↻ Actualizar
          </button>
        </div>
      </div>

      <div style={{ maxWidth: 960, margin: "0 auto", padding: "16px" }}>

        {/* KPIs */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10, marginBottom: 16 }}>
          {[
            { val: totalAvances,  label: "Avances reactivos registrados", color: "#2563eb" },
            { val: Math.round(totalHH * 10) / 10, label: "HH atendidas total", color: "#d97706" },
            { val: diasConOTs,    label: "Días con actividad",        color: "#16a34a" },
          ].map(k => (
            <div key={k.label} style={{ background: "white", borderRadius: 12, padding: "14px 16px", textAlign: "center", border: `3px solid ${k.color}20`, boxShadow: "0 1px 4px rgba(0,0,0,0.06)" }}>
              <p style={{ fontSize: 28, fontWeight: 800, color: k.color }}>{k.val}</p>
              <p style={{ fontSize: 11, color: "#64748b" }}>{k.label}</p>
            </div>
          ))}
        </div>

        {loading ? (
          <div style={{ textAlign: "center", padding: 48, color: "#94a3b8" }}>Cargando…</div>
        ) : opeplantEntradas.length === 0 ? (
          <div style={{ textAlign: "center", padding: 48, background: "white", borderRadius: 14, color: "#94a3b8" }}>
            <p style={{ fontSize: 40, marginBottom: 12 }}>🔄</p>
            <p style={{ fontSize: 16, fontWeight: 700, color: "#0f2847" }}>Sin OPEPLANT esta semana</p>
            <p style={{ fontSize: 13 }}>Verifica que el programa semanal esté cargado</p>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
            {areasUnicas.map(area => {
              const opepDeArea = opeplantEntradas.filter(e => e.areaCodigo === area.areaCodigo);
              if (opepDeArea.length === 0) return null;
              const avancesArea = avances.filter(a => !a.ot.areaCodigo || a.ot.areaCodigo === area.areaCodigo);
              const hhArea = avancesArea.reduce((s, a) => s + a.hhTrabajadas, 0);

              return (
                <div key={area.areaCodigo}>
                  {/* Encabezado de área */}
                  {areasUnicas.length > 1 && (
                    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10, padding: "8px 0" }}>
                      <div style={{ height: 2, flex: 1, background: "#e2e8f0" }} />
                      <span style={{ fontSize: 13, fontWeight: 800, color: "#0f2847", background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 20, padding: "4px 14px" }}>
                        {area.disciplina} · Área {area.areaCodigo}
                      </span>
                      <span style={{ fontSize: 11, color: "#d97706", fontWeight: 700 }}>
                        {avancesArea.length} avances · {Math.round(hhArea * 10) / 10}HH semana
                      </span>
                      <div style={{ height: 2, flex: 1, background: "#e2e8f0" }} />
                    </div>
                  )}

                  <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                  {grupos.map(grupo => {
                    const avancesGrupo = avancesDeAreaGrupo(area.areaCodigo, grupo);
                    const hhGrupo  = avancesGrupo.reduce((s, a) => s + a.hhTrabajadas, 0);
                    const opepGrupo = opepDeArea.filter(e => e.grupo === grupo);
                    if (opepGrupo.length === 0) return null;

                    const opepNums = [...new Set(opepGrupo.map(e => e.numeroOT))].join(", ");

                    return (
                      <div key={grupo} style={{ background: "white", borderRadius: 14, overflow: "hidden", boxShadow: "0 1px 6px rgba(0,0,0,0.07)" }}>
                        {/* Cabecera grupo */}
                        <div style={{
                          background: grupo === "Nocturno" ? "#0f2847" : "#fef3c7",
                          color: grupo === "Nocturno" ? "#e2e8f0" : "#92400e",
                          padding: "12px 18px",
                          display: "flex", justifyContent: "space-between", alignItems: "center",
                        }}>
                          <div>
                            <span style={{ fontWeight: 800, fontSize: 15 }}>
                              {grupo === "Nocturno" ? "🌙" : "☀️"} Turno {grupo}
                            </span>
                            <span style={{ fontSize: 11, marginLeft: 12, opacity: 0.7 }}>
                              OPEPLANT {opepNums} · {area.disciplina}
                            </span>
                          </div>
                          <span style={{ fontSize: 12, fontWeight: 700 }}>
                            {avancesGrupo.length} avance{avancesGrupo.length !== 1 ? "s" : ""} · {Math.round(hhGrupo * 10) / 10}HH
                          </span>
                        </div>

                        {/* Días de la semana */}
                        <div style={{ display: "flex", flexDirection: "column" }}>
                          {DIAS_SEMANA.map((dia, idx) => {
                            const avancesDelDia = avancesPorAreaDia(area.areaCodigo, grupo, dia);
                            const fecha = fechasDias[dia];
                            const hhDia = avancesDelDia.reduce((s, a) => s + a.hhTrabajadas, 0);

                      return (
                        <div key={dia} style={{ borderTop: idx > 0 ? "1px solid #f1f5f9" : undefined }}>
                          {/* Subencabezado día */}
                          <div style={{ background: "#f8fafc", padding: "8px 18px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                            <span style={{ fontSize: 12, fontWeight: 700, color: "#475569" }}>
                              {DIAS_FULL[dia]} {fecha.toLocaleDateString("es-BO", { day: "2-digit", month: "short", timeZone: "UTC" })}
                            </span>
                            {avancesDelDia.length > 0 ? (
                              <span style={{ fontSize: 11, color: "#d97706", fontWeight: 700 }}>
                                {avancesDelDia.length} avance{avancesDelDia.length !== 1 ? "s" : ""} · {Math.round(hhDia * 10) / 10}HH
                              </span>
                            ) : (
                              <span style={{ fontSize: 11, color: "#cbd5e1", fontStyle: "italic" }}>Sin actividad</span>
                            )}
                          </div>

                          {/* Lista de avances del día */}
                          {avancesDelDia.length > 0 && (
                            <div style={{ padding: "8px 18px 12px", display: "flex", flexDirection: "column", gap: 8 }}>
                              {avancesDelDia.map(a => {
                                const ot = a.ot;
                                const estadoColor = ESTADO_COLOR[ot.estado] ?? "#64748b";
                                return (
                                  <div key={a.cardId} style={{ background: "#fafafa", borderRadius: 10, border: "1px solid #e2e8f0", padding: "10px 14px", borderLeft: "3px solid #d97706" }}>
                                    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 4 }}>
                                      <span style={{ fontWeight: 800, fontSize: 13, fontFamily: "monospace", color: "#0f2847" }}>{ot.otJdeNumero ? `OT ${ot.otJdeNumero}` : `#${ot.numeroOT}`}</span>
                                      <span style={S.badge(estadoColor)}>{ESTADO_LABEL[ot.estado] ?? ot.estado}</span>
                                      {ot.lineas.map((l, i) => (
                                        <span key={i} style={S.badge(tipoColor(l.tipoOT))}>{l.tag} · {tipoOtDisplay(l.tipoOT).texto}</span>
                                      ))}
                                      {a.hhTrabajadas > 0 && (
                                        <span style={{ marginLeft: "auto", fontSize: 12, fontWeight: 700, color: "#d97706" }}>{Math.round(a.hhTrabajadas * 10) / 10}HH</span>
                                      )}
                                      {esSup && (
                                        <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
                                          <button
                                            onClick={(e) => { e.stopPropagation(); abrirEditar(ot); }}
                                            style={{ fontSize: 11, color: "#2563eb", fontWeight: 600, background: "none", border: "none", cursor: "pointer", padding: 0 }}
                                          >
                                            Editar
                                          </button>
                                          {esAdmin && (
                                            <button
                                              onClick={(e) => { e.stopPropagation(); setDeletingId(ot._id); }}
                                              style={{ fontSize: 11, color: "#dc2626", fontWeight: 600, background: "none", border: "none", cursor: "pointer", padding: 0 }}
                                            >
                                              Eliminar
                                            </button>
                                          )}
                                        </div>
                                      )}
                                    </div>
                                    <p style={{ fontSize: 12, color: "#475569", marginBottom: 3 }}>
                                      {a.tecnico}
                                    </p>
                                    {(!ot.registrosDiarios || ot.registrosDiarios.length === 0) && ot.lineas.length > 0 && (
                                      <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 2 }}>
                                        {ot.lineas.map((l, i) => (
                                          (l.sintoma || l.descripcionTrabajo || l.resolucionAplicada) && (
                                            <div key={i} style={{ fontSize: 11, color: "#334155" }}>
                                              {ot.lineas.length > 1 && (
                                                <span style={{ fontWeight: 700, color: "#1d4ed8", fontFamily: "monospace" }}>{l.tag}: </span>
                                              )}
                                              {l.sintoma && <span>{l.sintoma}. </span>}
                                              {l.descripcionTrabajo && <span>{l.descripcionTrabajo}</span>}
                                              {l.resolucionAplicada && <span style={{ color: "#16a34a" }}> ✓ {l.resolucionAplicada}</span>}
                                            </div>
                                          )
                                        ))}
                                      </div>
                                    )}
                                    {a.tareasEjecutadas.length > 0 && (
                                      <ul style={{ margin: "3px 0 0", paddingLeft: 16, fontSize: 11, color: "#334155" }}>
                                        {a.tareasEjecutadas.map((t, i) => <li key={i}>{t}</li>)}
                                      </ul>
                                    )}
                                    {a.observaciones && (
                                      <p style={{ fontSize: 11, color: "#7c3aed", marginTop: 3 }}>{a.observaciones}</p>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>

                        {/* Footer del grupo */}
                        <div style={{ background: "#f1f5f9", padding: "10px 18px", display: "flex", justifyContent: "flex-end", gap: 24 }}>
                          <span style={{ fontSize: 12, color: "#64748b" }}>
                            Total semana: <strong>{avancesGrupo.length} avance{avancesGrupo.length !== 1 ? "s" : ""}</strong>
                          </span>
                          <span style={{ fontSize: 12, color: "#d97706", fontWeight: 700 }}>
                            {Math.round(hhGrupo * 10) / 10} HH acumuladas
                          </span>
                        </div>
                      </div>
                    );
                  })}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Nota informativa */}
        {!loading && otsReactivas.length === 0 && opeplantEntradas.length > 0 && (
          <div style={{ marginTop: 16, background: "#fffbeb", border: "1px solid #fcd34d", borderRadius: 12, padding: "14px 18px" }}>
            <p style={{ fontSize: 13, color: "#92400e", fontWeight: 600 }}>Sin OTs reactivas registradas esta semana</p>
            <p style={{ fontSize: 12, color: "#b45309", marginTop: 4 }}>
              Para vincular una OT reactiva a la OPEPLANT, al registrar la OT coloca el número{" "}
              <strong>{[...new Set(opeplantEntradas.map(e => e.numeroOT))].join(" / ")}</strong>{" "}
              en el campo "N° OT OPEPLANT".
            </p>
          </div>
        )}
      </div>
    </div>

    {/* Modal edición de OT de bitácora */}
    {editingOt && editForm && (
      <div
        style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 9999, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}
        onClick={() => { setEditingOt(null); setEditForm(null); }}
      >
        <div
          style={{ background: "white", borderRadius: 14, padding: 24, maxWidth: 500, width: "100%", maxHeight: "90vh", overflowY: "auto", boxShadow: "0 20px 60px rgba(0,0,0,0.3)" }}
          onClick={(e) => e.stopPropagation()}
        >
          <div style={{ fontWeight: 800, fontSize: 16, color: "#0f2847", marginBottom: 4 }}>
            Editar OT {editingOt.otJdeNumero ? `OPEPLANT ${editingOt.otJdeNumero}` : `#${editingOt.numeroOT}`}
          </div>
          {esAdmin ? (
            <TecnicosPanel
              areaCodigo={editingOt.areaCodigo}
              tecnicos={editForm.tecnicos}
              onChange={tecnicos => setEditForm(f => f ? { ...f, tecnicos } : f)}
            />
          ) : (
            <p style={{ fontSize: 12, color: "#94a3b8", marginBottom: 18 }}>
              {editingOt.tecnicos.map(t => t.nombreCompleto).join(" · ")}
            </p>
          )}

          {/* Estado */}
          <div style={{ marginBottom: 16 }}>
            <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: "#64748b", textTransform: "uppercase", marginBottom: 6 }}>Estado</label>
            <select
              value={editForm.estado}
              onChange={e => setEditForm(f => f ? { ...f, estado: e.target.value } : f)}
              style={{ width: "100%", border: "1px solid #cbd5e1", borderRadius: 8, padding: "8px 10px", fontSize: 14, color: "#1e293b" }}
            >
              {["borrador","en_proceso","pendiente_revision","solicitar_correccion","revisado","concluido"].map(s => (
                <option key={s} value={s}>{ESTADO_LABEL[s] ?? s}</option>
              ))}
            </select>
          </div>

          {/* Líneas */}
          {editForm.lineas.map((l, i) => (
            <div key={i} style={{ background: "#f8fafc", borderRadius: 10, padding: "12px 14px", marginBottom: 12, border: "1px solid #e2e8f0" }}>
              <div style={{ fontWeight: 700, fontSize: 12, color: "#1d4ed8", fontFamily: "monospace", marginBottom: 10 }}>
                {l.tag} · <span style={{ color: tipoColor(l.tipoOT) }}>{tipoOtDisplay(l.tipoOT).texto}</span>
              </div>

              <div style={{ marginBottom: 10 }}>
                <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: "#64748b", textTransform: "uppercase", marginBottom: 4 }}>HH Reales</label>
                <input
                  type="number" min="0" step="0.5"
                  value={l.tiempoRealHrs}
                  onChange={e => setEditForm(f => {
                    if (!f) return f;
                    const lineas = [...f.lineas];
                    lineas[i] = { ...lineas[i], tiempoRealHrs: e.target.value };
                    return { ...f, lineas };
                  })}
                  style={{ width: 100, border: "1px solid #cbd5e1", borderRadius: 8, padding: "7px 10px", fontSize: 14 }}
                />
              </div>

              <div style={{ marginBottom: 10 }}>
                <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: "#64748b", textTransform: "uppercase", marginBottom: 4 }}>Síntoma / Descripción</label>
                <textarea
                  value={l.sintoma}
                  onChange={e => setEditForm(f => {
                    if (!f) return f;
                    const lineas = [...f.lineas];
                    lineas[i] = { ...lineas[i], sintoma: e.target.value };
                    return { ...f, lineas };
                  })}
                  rows={2}
                  style={{ width: "100%", border: "1px solid #cbd5e1", borderRadius: 8, padding: "7px 10px", fontSize: 13, resize: "vertical", boxSizing: "border-box" }}
                />
              </div>

              <div style={{ marginBottom: 10 }}>
                <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: "#1d4ed8", textTransform: "uppercase", marginBottom: 4 }}>Detalle del trabajo realizado</label>
                <textarea
                  value={l.descripcionTrabajo}
                  onChange={e => setEditForm(f => {
                    if (!f) return f;
                    const lineas = [...f.lineas];
                    lineas[i] = { ...lineas[i], descripcionTrabajo: e.target.value };
                    return { ...f, lineas };
                  })}
                  rows={2}
                  placeholder="Lo que el técnico registró como trabajo ejecutado…"
                  style={{ width: "100%", border: "1px solid #cbd5e1", borderRadius: 8, padding: "7px 10px", fontSize: 13, resize: "vertical", boxSizing: "border-box" }}
                />
              </div>

              <div>
                <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: "#16a34a", textTransform: "uppercase", marginBottom: 4 }}>Resolución aplicada</label>
                <textarea
                  value={l.resolucionAplicada}
                  onChange={e => setEditForm(f => {
                    if (!f) return f;
                    const lineas = [...f.lineas];
                    lineas[i] = { ...lineas[i], resolucionAplicada: e.target.value };
                    return { ...f, lineas };
                  })}
                  rows={2}
                  style={{ width: "100%", border: "1px solid #cbd5e1", borderRadius: 8, padding: "7px 10px", fontSize: 13, resize: "vertical", boxSizing: "border-box" }}
                />
              </div>
            </div>
          ))}

          {saveErr && (
            <div style={{ background: "#fee2e2", border: "1px solid #fca5a5", borderRadius: 8, padding: "8px 12px", marginBottom: 12, fontSize: 13, color: "#dc2626" }}>
              {saveErr}
            </div>
          )}

          <div style={{ display: "flex", gap: 10, marginTop: 4 }}>
            <button
              onClick={() => { setEditingOt(null); setEditForm(null); }}
              style={{ flex: 1, padding: "10px 0", borderRadius: 8, border: "1px solid #e2e8f0", background: "white", fontWeight: 600, fontSize: 14, cursor: "pointer", color: "#64748b" }}
            >
              Cancelar
            </button>
            <button
              onClick={guardarEdicion}
              disabled={saving}
              style={{ flex: 1, padding: "10px 0", borderRadius: 8, border: "none", background: saving ? "#93c5fd" : "#2563eb", fontWeight: 700, fontSize: 14, cursor: saving ? "not-allowed" : "pointer", color: "white" }}
            >
              {saving ? "Guardando…" : "Guardar cambios"}
            </button>
          </div>
        </div>
      </div>
    )}

    {/* Modal confirmación eliminar */}
    {deletingId && (
      <div
        style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 9999, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}
        onClick={() => setDeletingId(null)}
      >
        <div
          style={{ background: "white", borderRadius: 12, padding: 28, maxWidth: 360, width: "100%", boxShadow: "0 20px 60px rgba(0,0,0,0.3)" }}
          onClick={(e) => e.stopPropagation()}
        >
          <div style={{ fontWeight: 800, fontSize: 16, color: "#0f2847", marginBottom: 8 }}>Eliminar OT</div>
          <p style={{ fontSize: 14, color: "#475569", marginBottom: 20, lineHeight: 1.5 }}>
            Esta acción eliminará permanentemente la OT y todos sus datos. No se puede deshacer.
          </p>
          <div style={{ display: "flex", gap: 10 }}>
            <button
              onClick={() => setDeletingId(null)}
              style={{ flex: 1, padding: "10px 0", borderRadius: 8, border: "1px solid #e2e8f0", background: "white", fontWeight: 600, fontSize: 14, cursor: "pointer", color: "#64748b" }}
            >
              Cancelar
            </button>
            <button
              onClick={async () => {
                const id = deletingId;
                setDeletingId(null);
                const res = await fetch(`/api/ordenes/${id}`, { method: "DELETE" });
                if (res.ok) {
                  setOtsReactivas(prev => prev.filter(o => o._id !== id));
                } else {
                  alert("Error al eliminar la OT");
                }
              }}
              style={{ flex: 1, padding: "10px 0", borderRadius: 8, border: "none", background: "#dc2626", fontWeight: 700, fontSize: 14, cursor: "pointer", color: "white" }}
            >
              Eliminar
            </button>
          </div>
        </div>
      </div>
    )}
    </>
  );
}
