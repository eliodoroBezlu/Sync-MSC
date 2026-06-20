import { prisma } from "@/lib/prisma";

export interface OtGenerada {
  numeroOT: string; tipoOT: string; descripcion: string; tag: string;
  personas: number; hrsTrabajo: number;
  grupo: string; dias: string[]; prioridad: string;
}

/**
 * Genera OTs preventivas automáticamente basadas en EquipoMantenimientoPlan
 * vencidos o próximos a vencer en la semana indicada.
 */
export async function autoGenerarPMOts(
  semana: number,
  anio: number,
  disciplina: string
): Promise<OtGenerada[]> {
  const hoy = new Date();
  const planes = await prisma.equipoMantenimientoPlan.findMany({
    where: {
      disciplina,
      activo: true,
      proximoVencimiento: { lte: new Date(hoy.getTime() + 7 * 24 * 60 * 60 * 1000) }, // próximos 7 días
    },
  });

  const generadas: OtGenerada[] = [];

  for (const plan of planes) {
    const otNum = `${plan.tag}-PMT-${semana}-${anio}`;
    generadas.push({
      numeroOT: otNum,
      tipoOT: "PMT",
      descripcion: plan.descripcion || `Mantenimiento preventivo de ${plan.tag}`,
      tag: plan.tag,
      personas: plan.personas,
      hrsTrabajo: plan.hrsTrabajo,
      grupo: plan.grupo,
      dias: (plan.diasPreferidos as string[]) || ["Lu", "Vi"],
      prioridad: "3P", // Normal
    });
  }

  return generadas;
}

/**
 * Calcula siguiente vencimiento en base a frecuencia
 */
export function calcularProximoVencimiento(
  ultimoEjecutado: Date | null,
  frecuencia: string
): Date {
  const ahora = ultimoEjecutado || new Date();
  const proximo = new Date(ahora);

  if (frecuencia === "semanal") proximo.setDate(proximo.getDate() + 7);
  else if (frecuencia === "mensual") proximo.setMonth(proximo.getMonth() + 1);
  else if (frecuencia === "trimestral") proximo.setMonth(proximo.getMonth() + 3);
  else if (frecuencia === "anual") proximo.setFullYear(proximo.getFullYear() + 1);

  return proximo;
}
