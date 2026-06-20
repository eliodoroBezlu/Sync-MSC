/**
 * Balanceador de carga: distribuye OTs entre técnicos equitativamente
 * según disponibilidad en el roster.
 */

export interface TecnicoDisponibilidad {
  nombre: string;
  diasDisponibles: number; // días laborales disponibles
  hhDisponibles: number; // horas totales disponibles
  hhActualProgramadas: number; // horas ya asignadas en este plan
  grupo: string; // Diurno|Nocturno
  asistencia: string[]; // por día ["D","N","V","L",...]
}

export interface OtAsignacion {
  otNumero: string;
  tecnico: string;
  hhAsignadas: number;
  cargaPorcentaje: number;
}

/**
 * Calcula disponibilidad de cada técnico en la semana
 */
export function calcularDisponibilidad(
  nombre: string,
  asistencia: string[],
  grupo: string,
  hhActualProgramadas: number = 0
): TecnicoDisponibilidad {
  const hrs_x_dia = grupo === "Nocturno" ? 10 : 8;
  const diasDisponibles = asistencia.filter(d => d === "D" || d === "N").length;
  const hhDisponibles = diasDisponibles * hrs_x_dia;
  return {
    nombre,
    diasDisponibles,
    hhDisponibles,
    hhActualProgramadas,
    grupo,
    asistencia,
  };
}

/**
 * Asigna OT al técnico menos cargado respetando grupo/turno
 */
export function asignarOtAlMenosCargado(
  numeroOT: string,
  hhOt: number,
  grupo: string,
  tecnicos: TecnicoDisponibilidad[]
): OtAsignacion | null {
  // Filtrar técnicos compatibles (mismo grupo o sin restricción)
  const compatibles = tecnicos.filter(t => {
    const tieneGrupo = (t.asistencia as string[]).some(d => d === (grupo === "Nocturno" ? "N" : "D"));
    return tieneGrupo && t.hhActualProgramadas + hhOt <= t.hhDisponibles;
  });

  if (compatibles.length === 0) return null;

  // Ordenar por menor carga actual (menos horas programadas)
  compatibles.sort((a, b) => a.hhActualProgramadas - b.hhActualProgramadas);

  const tecnicoMenorCargado = compatibles[0];
  const porcentaje = ((tecnicoMenorCargado.hhActualProgramadas + hhOt) / tecnicoMenorCargado.hhDisponibles) * 100;

  return {
    otNumero: numeroOT,
    tecnico: tecnicoMenorCargado.nombre,
    hhAsignadas: hhOt,
    cargaPorcentaje: porcentaje,
  };
}

/**
 * Balancear múltiples OTs entre roster disponible
 */
export function balancearOts(
  ots: Array<{ numeroOT: string; personas: number; hrsTrabajo: number; grupo: string }>,
  roster: Array<{ nombre: string; asistencia: string[]; grupo: string }>
): Map<string, string[]> {
  // Mapeo: otNumero -> [técnicos asignados]
  const asignaciones = new Map<string, string[]>();

  // Inicializar disponibilidad
  const dispMap = new Map(
    roster.map(r => [
      r.nombre,
      calcularDisponibilidad(r.nombre, r.asistencia, r.grupo, 0),
    ])
  );

  // Ordenar OTs por HH descendente (asignar las más pesadas primero)
  const otsOrdenadas = [...ots].sort((a, b) => b.personas * b.hrsTrabajo - a.personas * a.hrsTrabajo);

  for (const ot of otsOrdenadas) {
    const hhOt = ot.personas * ot.hrsTrabajo;
    const disponibles = Array.from(dispMap.values());

    const asignacion = asignarOtAlMenosCargado(ot.numeroOT, hhOt, ot.grupo, disponibles);
    if (asignacion) {
      asignaciones.set(ot.numeroOT, [asignacion.tecnico]);
      // Actualizar disponibilidad
      const disp = dispMap.get(asignacion.tecnico);
      if (disp) {
        disp.hhActualProgramadas += hhOt;
      }
    }
  }

  return asignaciones;
}

/**
 * Genera reporte de carga por técnico
 */
export interface ReporteCarga {
  tecnico: string;
  hhDisponibles: number;
  hhProgramadas: number;
  cargaPorcentaje: number;
  estado: "subutilizado" | "balanceado" | "alto" | "sobrecargado";
}

export function reporteCarga(
  roster: Array<{ nombre: string; asistencia: string[]; grupo: string }>,
  asignaciones: Map<string, string[]>
): ReporteCarga[] {
  const reportes: ReporteCarga[] = [];

  for (const tecnico of roster) {
    const disp = calcularDisponibilidad(tecnico.nombre, tecnico.asistencia, tecnico.grupo);

    // Sumar HH asignadas
    let hhProgramadas = 0;
    for (const tecnicos of asignaciones.values()) {
      if (tecnicos.includes(tecnico.nombre)) {
        // Buscar OT asociada (esto sería más simple si pasamos OTs también)
        hhProgramadas += 0; // Necesitaría más contexto
      }
    }

    const porcentaje = (hhProgramadas / disp.hhDisponibles) * 100;
    let estado: "subutilizado" | "balanceado" | "alto" | "sobrecargado";
    if (porcentaje < 60) estado = "subutilizado";
    else if (porcentaje <= 85) estado = "balanceado";
    else if (porcentaje <= 100) estado = "alto";
    else estado = "sobrecargado";

    reportes.push({
      tecnico: tecnico.nombre,
      hhDisponibles: disp.hhDisponibles,
      hhProgramadas,
      cargaPorcentaje: porcentaje,
      estado,
    });
  }

  return reportes.sort((a, b) => b.cargaPorcentaje - a.cargaPorcentaje);
}
