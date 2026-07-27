import { prisma } from "@/lib/prisma";

export interface Alert {
  tipo: "capacidad" | "turno" | "especialista" | "asignacion" | "conflicto" | "prioridad";
  severidad: "error" | "warning" | "info";
  mensaje: string;
  detalles?: Record<string, unknown>;
}

type OtBorrador = {
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
  disciplina: string
): Promise<Alert[]> {
  const alerts: Alert[] = [];

  // 1. CAPACIDAD: HH disponibles vs programadas
  const horas_x_dia = 8;
  const diasSemana = 5; // Lu-Vi por defecto
  // "D" es descanso (RRHH), no "turno diurno" pese a la letra — solo "T" y
  // "N" son presencia real en sitio.
  const activos = roster.filter(r => r.asistencia.some(a => a === "T" || a === "N"));
  const hhDisponibles = activos.length * diasSemana * horas_x_dia;
  // hhTotal es el HH real de la OT para toda la semana (del Excel al
  // importar, o editado a mano) — personas × hrsTrabajo × días asume que
  // hrsTrabajo es siempre "horas por día", lo cual no es cierto (ver bug de
  // colapso de hhTotal en api/planificacion/[id]/ots/[otId]/route.ts) y
  // sobreestima brutalmente OTs multi-día, bloqueando la publicación con una
  // falsa "sobreprogramación".
  const hhProgramadas = ots.reduce((s, o) => s + o.hhTotal, 0);

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

  // 5. CONFLICTO: Mismo técnico en múltiples OTs mismo día
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
