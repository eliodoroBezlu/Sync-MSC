/**
 * Balanceador de carga: distribuye OTs entre técnicos equitativamente
 * según disponibilidad en el roster.
 */

import type { CuadrillaMiembroRow } from "./cuadrillas";
import { DIAS_SEMANA as TODOS_LOS_DIAS, tecnicosDeCuadrillaEnDia } from "./cuadrillas";

/**
 * Técnicos elegibles para `grupo` en cualquiera de `dias` (miembros de la
 * cuadrilla, no asistencia D/N cruda). Si la OT todavía no tiene día
 * asignado (dias=[]), se usa toda la semana como fallback para no bloquear
 * el primer balanceo de personal antes del reparto por día.
 */
function tecnicosElegiblesGrupo(
  grupo: string,
  dias: string[],
  miembros: CuadrillaMiembroRow[]
): Set<string> {
  const diasAConsiderar = dias.length > 0 ? dias : TODOS_LOS_DIAS;
  const elegibles = new Set<string>();
  for (const dia of diasAConsiderar) {
    for (const t of tecnicosDeCuadrillaEnDia(miembros, grupo, dia)) {
      elegibles.add(t.nombre);
    }
  }
  return elegibles;
}

export interface TecnicoDisponibilidad {
  nombre: string;
  diasDisponibles: number; // días laborales disponibles
  hhDisponibles: number; // horas totales disponibles
  hhActualProgramadas: number; // horas ya asignadas en este plan
  grupo: string; // Diurno|Nocturno
  asistencia: string[]; // por día ["D","N","V","L",...]
}

export interface OtAsignacion {
  otId: string;
  otNumero: string;
  tecnico: string;
  hhAsignadas: number;
  cargaPorcentaje: number;
}

/**
 * Calcula disponibilidad de cada técnico en la semana. 10 horas/día/persona
 * parejo para todos los grupos (G1-G4, Diurno, Nocturno), igual que el Excel
 * de referencia (Programa Semanal Instrumentacion, hoja I-XX).
 */
export function horasPorDiaPersona(_grupo: string): number {
  return 10;
}

export function calcularDisponibilidad(
  nombre: string,
  asistencia: string[],
  grupo: string,
  hhActualProgramadas: number = 0
): TecnicoDisponibilidad {
  const hrs_x_dia = horasPorDiaPersona(grupo);
  // "D" es descanso (código de RRHH), no "turno diurno" pese a la letra —
  // solo "T" (turno normal/guardia diurna) y "N" (nocturno) son presencia real.
  const diasDisponibles = asistencia.filter(d => d === "T" || d === "N").length;
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
  otId: string,
  numeroOT: string,
  hhOt: number,
  grupo: string,
  tecnicos: TecnicoDisponibilidad[]
): OtAsignacion | null {
  // Filtrar técnicos compatibles (mismo grupo o sin restricción)
  const compatibles = tecnicos.filter(t => {
    const tieneGrupo = (t.asistencia as string[]).some(d => d === (grupo === "Nocturno" ? "N" : "T"));
    return tieneGrupo && t.hhActualProgramadas + hhOt <= t.hhDisponibles;
  });

  if (compatibles.length === 0) return null;

  // Ordenar por menor carga actual (menos horas programadas)
  compatibles.sort((a, b) => a.hhActualProgramadas - b.hhActualProgramadas);

  const tecnicoMenorCargado = compatibles[0];
  const porcentaje = ((tecnicoMenorCargado.hhActualProgramadas + hhOt) / tecnicoMenorCargado.hhDisponibles) * 100;

  return {
    otId,
    otNumero: numeroOT,
    tecnico: tecnicoMenorCargado.nombre,
    hhAsignadas: hhOt,
    cargaPorcentaje: porcentaje,
  };
}

/**
 * Asigna una OT a hasta `personas` técnicos (los menos cargados del grupo
 * compatible), repartiendo la carga entre ellos, para que una OT que
 * requiere 2 personas quede con 2 técnicos del mismo grupo en vez de 1 solo.
 */
export function asignarOtAGrupo(
  otId: string,
  numeroOT: string,
  hhOt: number,
  personas: number,
  grupo: string,
  dias: string[],
  tecnicos: TecnicoDisponibilidad[],
  miembros: CuadrillaMiembroRow[]
): string[] {
  const cantidad = Math.max(1, personas);
  const hhPorPersona = hhOt / cantidad;
  const elegibles = tecnicosElegiblesGrupo(grupo, dias, miembros);

  const compatibles = tecnicos
    .filter(t => elegibles.has(t.nombre))
    .filter(t => t.hhActualProgramadas + hhPorPersona <= t.hhDisponibles)
    .sort((a, b) => a.hhActualProgramadas - b.hhActualProgramadas);

  const elegidos = compatibles.slice(0, cantidad);
  for (const t of elegidos) {
    t.hhActualProgramadas += hhPorPersona;
  }
  return elegidos.map(t => t.nombre);
}

/**
 * Balancear múltiples OTs entre roster disponible. Se indexa por `id` de
 * fila (no por numeroOT) porque una misma OT OPEPLANT tiene una fila Diurno
 * y otra Nocturno que deben poder recibir técnicos distintos. Cada OT recibe
 * hasta `personas` técnicos (ideal: parejas de 2) del mismo grupo/turno.
 */
export function balancearOts(
  ots: Array<{ id: string; numeroOT: string; personas: number; hrsTrabajo: number; grupo: string; dias: string[] }>,
  roster: Array<{ nombre: string; asistencia: string[]; grupo: string }>,
  miembros: CuadrillaMiembroRow[]
): Map<string, string[]> {
  // Mapeo: id de fila -> [técnicos asignados]
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

    const tecnicos = asignarOtAGrupo(ot.id, ot.numeroOT, hhOt, ot.personas, ot.grupo, ot.dias, disponibles, miembros);
    if (tecnicos.length > 0) {
      asignaciones.set(ot.id, tecnicos);
    }
  }

  return asignaciones;
}

export const GRUPOS_ORDENADOS = ["G1", "G2", "G3", "G4"];

/**
 * Agrupa OTs (no guardia) en G1→G2→G3→G4 según la capacidad de HH del día de
 * cada grupo — el mismo criterio que aplica el planificador a mano en el
 * Excel de referencia (llena G1 hasta el tope del día, lo que sobra pasa a
 * G2, luego G3, luego G4). Turno Nocturno queda fuera de este reparto: es
 * exclusivo de guardia OPEPLANT y asignación manual.
 *
 * La capacidad del día NO sale de la cuadrilla de G1-G4 (esos grupos recién
 * se arman a mano, arrastrando técnicos sobre las OTs una vez que quedan acá
 * agrupadas — sería huevo-gallina pedirles cuadrilla previa). Sale del
 * roster: técnicos en turno normal ("T") ese día, descontando a los que ya
 * están tomados por la guardia Diurno (esos sí están sembrados de forma
 * confiable desde la asistencia real, ver seedMembresiaDesdeAsistencia). El
 * total de HH del día se reparte parejo entre los 4 grupos como cupo de
 * referencia.
 *
 * El reparto entre G1-G4 es por menor carga relativa: cada OT (de la más
 * pesada a la más liviana) se manda al grupo que, sumándole esta OT, quede
 * con el % de uso más bajo en el peor de sus días — no al primer grupo que
 * "entra" bajo su cupo. Con el cupo fijo dividido en 4 partes iguales, un
 * criterio de "cabe o no cabe" hacía que la primera OT (la más grande) casi
 * nunca entrara en el 1/4 de G1 y todo cayera en cascada hasta G4, aunque
 * G1-G3 tuvieran de sobra. Comparar % de uso en vez de exigir que quepa deja
 * que el cupo se pase del 100% cuando hace falta (igual que el planificador
 * de referencia), pero repartido parejo entre los 4 grupos en vez de siempre
 * en G4.
 */
export function agruparPorCapacidad(
  ots: Array<{ id: string; hhTotal: number; dias: string[] }>,
  miembros: CuadrillaMiembroRow[],
  roster: Array<{ nombre: string; asistencia: string[] }>
): Map<string, string> {
  const capacidadPorGrupoDia = new Map<string, number>();
  for (const dia of TODOS_LOS_DIAS) {
    const diaIdx = TODOS_LOS_DIAS.indexOf(dia);
    const diurnoDelDia = new Set(tecnicosDeCuadrillaEnDia(miembros, "Diurno", dia).map(t => t.nombre));
    const disponiblesTurnoNormal = roster.filter(
      r => r.asistencia[diaIdx] === "T" && !diurnoDelDia.has(r.nombre)
    ).length;
    const capacidadTotalDia = disponiblesTurnoNormal * horasPorDiaPersona("G1");
    const capacidadPorGrupo = capacidadTotalDia / GRUPOS_ORDENADOS.length;
    for (const grupo of GRUPOS_ORDENADOS) {
      capacidadPorGrupoDia.set(`${grupo}|${dia}`, capacidadPorGrupo);
    }
  }

  const usadoPorGrupoDia = new Map<string, number>();
  const asignaciones = new Map<string, string>();
  const ordenadas = [...ots].sort((a, b) => b.hhTotal - a.hhTotal);

  for (const ot of ordenadas) {
    const dias = ot.dias.length > 0 ? ot.dias : TODOS_LOS_DIAS;
    const hhPorDia = ot.hhTotal / dias.length;

    let grupoElegido = GRUPOS_ORDENADOS[0];
    let peorUtilizacionMinima = Infinity;
    for (const grupo of GRUPOS_ORDENADOS) {
      let peorUtilizacion = 0;
      for (const dia of dias) {
        const clave = `${grupo}|${dia}`;
        const capacidad = capacidadPorGrupoDia.get(clave) ?? 0;
        const usado = usadoPorGrupoDia.get(clave) ?? 0;
        const utilizacion = capacidad > 0 ? (usado + hhPorDia) / capacidad : (usado + hhPorDia > 0 ? Infinity : 0);
        peorUtilizacion = Math.max(peorUtilizacion, utilizacion);
      }
      if (peorUtilizacion < peorUtilizacionMinima) {
        peorUtilizacionMinima = peorUtilizacion;
        grupoElegido = grupo;
      }
    }
    for (const dia of dias) {
      const clave = `${grupoElegido}|${dia}`;
      usadoPorGrupoDia.set(clave, (usadoPorGrupoDia.get(clave) ?? 0) + hhPorDia);
    }
    asignaciones.set(ot.id, grupoElegido);
  }

  return asignaciones;
}

const DIAS_SEMANA = ["Lu", "Ma", "Mi", "Ju", "Vi", "Sa", "Do"];
// La mina trabaja Lu-Sa (no Lu-Vi): el reparto automático de una OT al
// arrastrarla a un día puede usar hasta el sábado.
export const DIAS_LABORALES = ["Lu", "Ma", "Mi", "Ju", "Vi", "Sa"];

/**
 * Cuántos días hace falta para completar el total de HH de una OT, según la
 * cantidad de personas asignadas y las horas/día/persona del grupo (10 parejo
 * para todos). Se limita a los 5 días hábiles: una OT que a ese ritmo tomaría
 * más de 5 días simplemente reparte más HH por día.
 */
export function calcularDiasNecesarios(hhTotal: number, personas: number, grupo: string): number {
  const capacidadDia = Math.max(1, personas) * horasPorDiaPersona(grupo);
  return Math.min(DIAS_LABORALES.length, Math.max(1, Math.ceil(hhTotal / capacidadDia)));
}

/**
 * Devuelve `diasNecesarios` días hábiles consecutivos a partir de `diaInicio`
 * (dando la vuelta dentro de Lu-Vi si hace falta) para repartir una OT.
 */
export function distribuirEnDias(diaInicio: string, diasNecesarios: number): string[] {
  const idx = DIAS_LABORALES.indexOf(diaInicio);
  if (idx === -1) return [diaInicio];
  const seleccion: string[] = [];
  for (let i = 0; i < diasNecesarios; i++) {
    seleccion.push(DIAS_LABORALES[(idx + i) % DIAS_LABORALES.length]);
  }
  return seleccion;
}

/**
 * Reparte las OTs sin día asignado a lo largo de la semana, colocando cada
 * una en el día con menor carga acumulada (OPEPLANT y OTs que ya traen un
 * día definido —por ejemplo, un rango importado del Excel— quedan intactas).
 */
export function balancearDias(
  ots: Array<{ id: string; hhTotal: number; dias: string[]; esGuardia: boolean }>,
  dias: string[] = DIAS_SEMANA
): Map<string, string[]> {
  const asignaciones = new Map<string, string[]>();
  const cargaPorDia = new Map(dias.map(d => [d, 0]));

  const pendientes = ots.filter(o => !o.esGuardia && o.dias.length === 0);
  const ordenadas = [...pendientes].sort((a, b) => b.hhTotal - a.hhTotal);

  for (const ot of ordenadas) {
    let mejorDia = dias[0];
    let menorCarga = Infinity;
    for (const d of dias) {
      const carga = cargaPorDia.get(d) ?? 0;
      if (carga < menorCarga) {
        menorCarga = carga;
        mejorDia = d;
      }
    }
    asignaciones.set(ot.id, [mejorDia]);
    cargaPorDia.set(mejorDia, menorCarga + ot.hhTotal);
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
