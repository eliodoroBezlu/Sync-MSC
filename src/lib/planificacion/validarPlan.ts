import { prisma } from "@/lib/prisma";
import { calcularReporteCapacidad, hhPorDia, HORAS_POR_PERSONA_DIA, type OtParaCapacidad, type CapacidadOverride } from "./capacidad";
import { DIAS_SEMANA, type CuadrillaMatriz } from "./cuadrillas";

export interface Alert {
  tipo: "capacidad" | "turno" | "especialista" | "asignacion" | "conflicto" | "prioridad";
  severidad: "error" | "warning" | "info";
  mensaje: string;
  detalles?: Record<string, unknown>;
}

type OtBorrador = OtParaCapacidad & {
  id: string; personas: number; hrsTrabajo: number; grupo: string;
  personalAsignado: string[]; prioridad?: string; esGuardia: boolean;
  numeroOT: string; tipoOT: string; dias: string[]; hhTotal: number;
};

type RosterItem = { nombre: string; asistencia: string[]; grupo: string };

export async function validarPlan(
  planId: string,
  ots: OtBorrador[],
  roster: RosterItem[],
  semana: number,
  anio: number,
  disciplina: string,
  cuadrilla: CuadrillaMatriz,
  capacidadOverride: CapacidadOverride = {}
): Promise<Alert[]> {
  const alerts: Alert[] = [];

  // 1. CAPACIDAD: HH disponibles vs programadas — mismo modelo que el
  // Tablero (calcularReporteCapacidad: 7 días, 10 hrs/persona/día por
  // grupo, con overrides), no una aproximación aparte. Antes esto usaba
  // activos × 5 días × 8 horas, un criterio distinto al que el planificador
  // ve en pantalla, así que el disponible/programado nunca coincidía con
  // lo que ya había revisado en el Tablero.
  const reporte = calcularReporteCapacidad(ots, cuadrilla, capacidadOverride, DIAS_SEMANA);
  const hhDisponibles = reporte.totalDisponible;
  const hhProgramadas = reporte.totalProgramada;

  if (hhProgramadas > hhDisponibles) {
    alerts.push({
      tipo: "capacidad",
      severidad: "error",
      mensaje: `Sobreprogramación: ${hhProgramadas.toFixed(0)}HH programadas > ${hhDisponibles}HH disponibles`,
      detalles: { disponibles: hhDisponibles, programadas: hhProgramadas },
    });
  } else if (hhProgramadas > hhDisponibles * 0.9) {
    alerts.push({
      tipo: "capacidad",
      severidad: "warning",
      mensaje: `Carga alta: ${(hhProgramadas / hhDisponibles * 100).toFixed(0)}% utilización`,
    });
  }

  // 2. TURNOS: OT asignada a turno incompatible con técnico
  for (const ot of ots) {
    if (ot.grupo !== "Diurno" && ot.grupo !== "Nocturno") continue;

    for (const nomTecnico of ot.personalAsignado) {
      const tecnico = roster.find(r => r.nombre === nomTecnico);
      if (!tecnico) continue;

      const tiposTurno = new Set(tecnico.asistencia.filter(a => a === "T" || a === "N"));
      const otTurno = ot.grupo === "Diurno" ? "T" : "N";
      if (!tiposTurno.has(otTurno)) {
        alerts.push({
          tipo: "turno",
          severidad: "warning",
          mensaje: `${nomTecnico}: OT ${ot.numeroOT} asignada a turno ${ot.grupo} pero técnico trabaja ${Array.from(tiposTurno).join("/")}`,
          detalles: { tecnico: nomTecnico, otNumero: ot.numeroOT, grupo: ot.grupo },
        });
      }
    }
  }

  // 3. ESPECIALISTAS: Validar que tenga competencia requerida
  for (const ot of ots) {
    // Buscar ChecklistMantto para esta OT (por tag o tipoOT)
    const checklist = await prisma.checklistMantto.findFirst({
      where: { disciplina, activo: true },
    });

    if (checklist && ot.personalAsignado.length === 0) {
      if (["1P", "2P"].includes(ot.prioridad || "")) {
        alerts.push({
          tipo: "asignacion",
          severidad: "error",
          mensaje: `OT ${ot.numeroOT} (${ot.prioridad}): Sin asignación de responsable`,
          detalles: { numeroOT: ot.numeroOT, prioridad: ot.prioridad },
        });
      }
    }
  }

  // 4. PRIORIDAD: OTs críticas sin asignación
  const criticasNoAsignadas = ots.filter(o => o.prioridad === "1P" && o.personalAsignado.length === 0);
  if (criticasNoAsignadas.length > 0) {
    alerts.push({
      tipo: "prioridad",
      severidad: "error",
      mensaje: `${criticasNoAsignadas.length} OTs CRÍTICAS sin asignación: ${criticasNoAsignadas.map(o => o.numeroOT).join(", ")}`,
    });
  }

  // 5. SOBRECARGA INDIVIDUAL: técnico con más de 10HH/día repartidas entre
  // las OTs que tiene asignadas ese día. La capacidad de grupo (punto 1)
  // puede verse sana en conjunto aunque una sola persona esté sobrecargada
  // si la OT tiene pocos asignados — por eso este chequeo va por persona,
  // no por grupo. Reparte hhPorDia(ot, dia) en partes iguales entre los
  // técnicos de personalAsignado, igual criterio que usa el planificador al
  // repartir OTs en la semana.
  const hhPorTecnicoDia: Map<string, Map<string, number>> = new Map();
  for (const ot of ots) {
    for (const dia of ot.dias) {
      if (ot.personalAsignado.length === 0) continue;
      const horasOt = hhPorDia(ot, dia) / ot.personalAsignado.length;
      const porDia = hhPorTecnicoDia.get(dia) ?? new Map<string, number>();
      for (const tecnico of ot.personalAsignado) {
        porDia.set(tecnico, (porDia.get(tecnico) ?? 0) + horasOt);
      }
      hhPorTecnicoDia.set(dia, porDia);
    }
  }
  for (const [dia, porTecnico] of hhPorTecnicoDia) {
    for (const [tecnico, horas] of porTecnico) {
      if (horas > HORAS_POR_PERSONA_DIA) {
        alerts.push({
          tipo: "capacidad",
          severidad: "warning",
          mensaje: `${tecnico}: ${horas.toFixed(1)}HH el ${dia} (> ${HORAS_POR_PERSONA_DIA}HH/día)`,
          detalles: { tecnico, dia, horas },
        });
      }
    }
  }

  // 6. CONFLICTO: Mismo técnico en múltiples OTs mismo día
  const asignacionesPorDia: Map<string, Map<string, number>> = new Map();
  for (const ot of ots) {
    for (const dia of ot.dias) {
      if (!asignacionesPorDia.has(dia)) asignacionesPorDia.set(dia, new Map());
      for (const tecnico of ot.personalAsignado) {
        const count = asignacionesPorDia.get(dia)?.get(tecnico) ?? 0;
        asignacionesPorDia.get(dia)?.set(tecnico, count + 1);
      }
    }
  }

  for (const [dia, tecnicoMap] of asignacionesPorDia) {
    for (const [tecnico, count] of tecnicoMap) {
      if (count > 1) {
        alerts.push({
          tipo: "conflicto",
          severidad: "warning",
          mensaje: `${tecnico}: Asignado a ${count} OTs el ${dia}`,
          detalles: { tecnico, dia, count },
        });
      }
    }
  }

  return alerts;
}
