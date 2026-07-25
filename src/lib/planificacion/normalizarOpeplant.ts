import { prisma } from "@/lib/prisma";
import { esOpeplant, DIAS_SEMANA_COMPLETA } from "@/lib/opeplant";
import type { PlanBorradorOt } from "@prisma/client";

/**
 * Asegura que toda OT OPEPLANT (guardia de planta) quede programada los 7
 * días de la semana en ambos turnos (Diurno y Nocturno). Existen planes con
 * OTs importadas antes de que el importador aplicara esta regla, así que el
 * saneamiento corre también al balancear, no solo al importar.
 */
export async function normalizarOpeplant(
  planBorradorId: string,
  ots: PlanBorradorOt[]
): Promise<PlanBorradorOt[]> {
  const porNumero = new Map<string, PlanBorradorOt[]>();
  for (const ot of ots) {
    if (!esOpeplant(ot.tag, ot.esGuardia)) continue;
    const filas = porNumero.get(ot.numeroOT) ?? [];
    filas.push(ot);
    porNumero.set(ot.numeroOT, filas);
  }
  if (porNumero.size === 0) return ots;

  let siguienteControl = Math.max(0, ...ots.map(o => o.control ?? 0)) + 1;
  const actualizadas = new Map<string, PlanBorradorOt>();
  const nuevas: PlanBorradorOt[] = [];

  for (const filas of porNumero.values()) {
    for (const fila of filas) {
      const diasCompletos = fila.dias.length === DIAS_SEMANA_COMPLETA.length
        && DIAS_SEMANA_COMPLETA.every(d => fila.dias.includes(d));
      if (fila.esGuardia && fila.seleccionada && diasCompletos) continue;
      const actualizada = await prisma.planBorradorOt.update({
        where: { id: fila.id },
        data: {
          esGuardia: true,
          seleccionada: true,
          dias: DIAS_SEMANA_COMPLETA,
          diasTexto: "Lu a Do",
        },
      });
      actualizadas.set(fila.id, actualizada);
    }

    const grupos = new Set(filas.map(f => f.grupo));
    const base = filas[0];
    for (const grupoFaltante of ["Diurno", "Nocturno"]) {
      if (grupos.has(grupoFaltante)) continue;
      const creada = await prisma.planBorradorOt.create({
        data: {
          planBorradorId,
          control: siguienteControl++,
          numeroOT: base.numeroOT,
          tipoOT: base.tipoOT,
          tipoTrabajo: base.tipoTrabajo,
          prioridad: base.prioridad,
          descripcion: base.descripcion,
          tag: base.tag,
          descripcionEquipo: base.descripcionEquipo,
          personas: base.personas,
          hrsTrabajo: base.hrsTrabajo,
          hhTotal: base.hhTotal,
          fechaInicioOt: base.fechaInicioOt,
          fechaFinOt: base.fechaFinOt,
          diasTexto: "Lu a Do",
          dias: DIAS_SEMANA_COMPLETA,
          estadoJDE: base.estadoJDE,
          estadoDetalle: base.estadoDetalle,
          solicitante: base.solicitante,
          observaciones: base.observaciones,
          personalAsignado: [],
          personalAsignadoIds: [],
          esGuardia: true,
          seleccionada: true,
          grupo: grupoFaltante,
        },
      });
      nuevas.push(creada);
    }
  }

  if (actualizadas.size === 0 && nuevas.length === 0) return ots;

  return [
    ...ots.map(o => actualizadas.get(o.id) ?? o),
    ...nuevas,
  ];
}
