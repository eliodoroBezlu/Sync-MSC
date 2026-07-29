"use client";

import { useState } from "react";
import type { DragEvent } from "react";
import type { OtBorrador, Plan, CuadrillaMatriz } from "./types";
import { calcularDiasNecesarios, distribuirEnDias, DIAS_LABORALES } from "@/lib/planificacion/balanceador";
import { grupoDelDia, diasDesde } from "@/lib/planificacion/cuadrillas";
import { DIAS_INFO, trabajaEseDia } from "@/lib/planificacion/personal";

export type EditCuadrillaFn = (
  grupo: string,
  dias: string[],
  agregar?: { nombre: string; usuarioId?: string | null }[],
  quitar?: string[],
) => Promise<void>;

export type EditHHDiaFn = (otId: string, diaCode: string, horas: number | null) => void;
export type AlcanceGrupo = "dia" | "media" | "semana";
export type AsignarGrupoFn = (otId: string, diaCode: string, alcance: AlcanceGrupo) => void;
export type DragPayload = { tipo: "ot"; id: string } | { tipo: "tecnico"; nombre: string };

export function leerPayload(e: DragEvent): DragPayload | null {
  const raw = e.dataTransfer.getData("application/json");
  if (!raw) return null;
  try {
    return JSON.parse(raw) as DragPayload;
  } catch {
    return null;
  }
}

// Lógica de arrastrar-y-soltar de OTs y personal, compartida entre el Tablero
// (columnas por día lado a lado) y la Lista (secciones por día apiladas) —
// misma mutación de datos en ambas vistas para que no diverjan en comportamiento.
export function useProgramacionDnd({
  plan, cuadrilla, onPatchOt, onEditCuadrilla,
}: {
  plan: Plan;
  cuadrilla: CuadrillaMatriz;
  onPatchOt: (otId: string, patch: Partial<OtBorrador>) => void;
  onEditCuadrilla: EditCuadrillaFn;
}) {
  const [draggingOtId, setDraggingOtId] = useState<string | null>(null);

  function moverADia(otId: string, dia: string) {
    if (dia === "") { onPatchOt(otId, { dias: [] }); return; }
    const ot = plan.ots.find(o => o.id === otId);
    // OTs de guardia u OPEPLANT quedan en el día exacto donde se soltaron; el
    // resto se reparte automáticamente en tantos días hábiles como haga falta
    // según personas/hrsTrabajo y el turno (8h/10h por persona/día).
    if (ot && !ot.esGuardia && DIAS_LABORALES.includes(dia)) {
      const diasNecesarios = calcularDiasNecesarios(ot.hhTotal, ot.personas, ot.grupo);
      onPatchOt(otId, { dias: distribuirEnDias(dia, diasNecesarios) });
    } else {
      onPatchOt(otId, { dias: [dia] });
    }
  }

  function editarHH(otId: string, hhTotal: number) {
    onPatchOt(otId, { hhTotal });
  }

  // Fija (o quita, con horas=null) el reparto manual de HH de un día puntual
  // de una OT multi-día — el resto de hhTotal se sigue repartiendo parejo
  // entre los días sin override, ver hhPorDia().
  function editarHHDia(otId: string, diaCode: string, horas: number | null) {
    const ot = plan.ots.find(o => o.id === otId);
    if (!ot) return;
    const actual = { ...(ot.hhPorDiaManual ?? {}) };
    if (horas == null) {
      delete actual[diaCode];
    } else {
      actual[diaCode] = horas;
    }
    onPatchOt(otId, { hhPorDiaManual: Object.keys(actual).length > 0 ? actual : null });
  }

  // Arrastrar una OT y soltarla sobre la sección de un grupo (G1-G4/Diurno/
  // Nocturno) dentro de un día. Si ese día YA es parte de la OT, es un ajuste
  // puntual: solo ESE día pasa al grupo elegido (grupoPorDia), el resto de
  // los días de la OT se mantienen en su grupo actual. Si la OT viene de otro
  // día o de Sin programar, es la primera vez que se ubica: se fija el grupo
  // base y los días.
  function moverAGrupoEnDia(otId: string, dia: string, grupo: string) {
    const ot = plan.ots.find(o => o.id === otId);
    if (!ot) return;
    const yaEnEsteDia = ot.dias?.includes(dia) ?? false;
    if (yaEnEsteDia) {
      const actual = { ...(ot.grupoPorDia ?? {}) };
      if (grupo === ot.grupo) delete actual[dia];
      else actual[dia] = grupo;
      onPatchOt(otId, { grupoPorDia: Object.keys(actual).length > 0 ? actual : null });
      return;
    }
    if (!ot.esGuardia && DIAS_LABORALES.includes(dia)) {
      const diasNecesarios = calcularDiasNecesarios(ot.hhTotal, ot.personas, grupo);
      onPatchOt(otId, { dias: distribuirEnDias(dia, diasNecesarios), grupo });
    } else {
      onPatchOt(otId, { dias: [dia], grupo });
    }
  }

  async function asignarTecnico(otId: string, nombre: string, diaCode: string) {
    const ot = plan.ots.find(o => o.id === otId);
    if (!ot) return;
    const tecnico = plan.roster.find(r => r.nombre === nombre);
    if (diaCode && tecnico && !trabajaEseDia(tecnico.asistencia, diaCode)) {
      const dia = DIAS_INFO.find(d => d.code === diaCode)?.largo ?? diaCode;
      alert(`${nombre} no está en sitio el ${dia}. No se puede asignar ese día.`);
      return;
    }
    // No usar early-return por "ya está en personalAsignado": una OT de
    // guardia (OPEPLANT) abarca toda la semana en un solo registro, así que
    // dropear al mismo técnico en un día distinto debe seguir registrando su
    // membresía de cuadrilla para ESE día aunque ya figure en la OT.
    const diasParaRegistrar = diaCode
      ? ot.dias.filter(d => {
          if (tecnico && !trabajaEseDia(tecnico.asistencia, d)) return false;
          const yaEnCrew = (cuadrilla[grupoDelDia(ot, d)]?.[d] ?? []).some(t => t.nombre === nombre);
          return !yaEnCrew;
        })
      : [];
    if (diasParaRegistrar.length > 0) {
      const r = plan.roster.find(x => x.nombre === nombre);
      const diasPorGrupo = new Map<string, string[]>();
      for (const d of diasParaRegistrar) {
        const g = grupoDelDia(ot, d);
        diasPorGrupo.set(g, [...(diasPorGrupo.get(g) ?? []), d]);
      }
      for (const [g, dias] of diasPorGrupo) {
        await onEditCuadrilla(g, dias, [{ nombre, usuarioId: r?.usuarioId ?? null }]);
      }
    }
    if (!ot.personalAsignado.includes(nombre)) {
      onPatchOt(otId, { personalAsignado: [...ot.personalAsignado, nombre] });
    }
  }

  // Vuelca a personalAsignado todos los miembros vigentes de la cuadrilla del
  // grupo efectivo de cada día objetivo, sin extender ot.dias.
  function asignarGrupoCompleto(otId: string, diaCode: string, alcance: AlcanceGrupo) {
    const ot = plan.ots.find(o => o.id === otId);
    if (!ot) return;
    const diasObjetivo = alcance === "dia" ? [diaCode]
      : alcance === "media" ? ot.dias.filter(d => diasDesde(diaCode).includes(d))
      : ot.dias;
    const nombres = new Set(ot.personalAsignado);
    for (const d of diasObjetivo) {
      const grupo = grupoDelDia(ot, d);
      for (const t of cuadrilla[grupo]?.[d] ?? []) nombres.add(t.nombre);
    }
    onPatchOt(otId, { personalAsignado: Array.from(nombres) });
  }

  async function quitarTecnico(otId: string, nombre: string, diaCode: string) {
    const ot = plan.ots.find(o => o.id === otId);
    if (!ot) return;
    if (ot.esGuardia && diaCode) {
      // OT de guardia (OPEPLANT): abarca toda la semana en un solo registro
      // (dias = Lu-Do), así que sacar a alguien de un día puntual debe tocar
      // solo la membresía de cuadrilla de ESE día — nunca personalAsignado
      // directo, que lo sacaría de la OT los 7 días a la vez.
      await onEditCuadrilla(grupoDelDia(ot, diaCode), [diaCode], undefined, [nombre]);
      return;
    }
    onPatchOt(otId, { personalAsignado: ot.personalAsignado.filter(n => n !== nombre) });
  }

  function handleDragStartOt(e: DragEvent, otId: string) {
    setDraggingOtId(otId);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("application/json", JSON.stringify({ tipo: "ot", id: otId }));
  }

  function handleDropColumna(e: DragEvent, dia: string) {
    e.preventDefault();
    const payload = leerPayload(e);
    if (payload?.tipo === "ot") moverADia(payload.id, dia);
  }

  function handleDropGrupo(e: DragEvent, dia: string, grupo: string) {
    e.preventDefault();
    e.stopPropagation();
    const payload = leerPayload(e);
    if (payload?.tipo === "ot") moverAGrupoEnDia(payload.id, dia, grupo);
  }

  function handleDropTecnicoEnOt(e: DragEvent, otId: string, diaCode: string) {
    const payload = leerPayload(e);
    if (payload?.tipo === "tecnico") {
      e.preventDefault();
      e.stopPropagation();
      asignarTecnico(otId, payload.nombre, diaCode);
    }
  }

  return {
    draggingOtId, setDraggingOtId,
    moverADia, editarHH, editarHHDia, moverAGrupoEnDia,
    asignarTecnico, asignarGrupoCompleto, quitarTecnico,
    handleDragStartOt, handleDropColumna, handleDropGrupo, handleDropTecnicoEnOt,
  };
}
