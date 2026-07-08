import { prisma } from "@/lib/prisma";

export function isoWeekInfo(date: Date): { semana: number; anio: number } {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const semana = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return { semana, anio: d.getUTCFullYear() };
}

// Determina si un N° OT pertenece al plan semanal OPEPLANT (turnero) del área
// y semana correspondientes a la fecha dada. Es la fuente única de verdad:
// tanto la detección en el formulario (antes de crear ninguna OT) como la
// creación real deben usar esta misma función para no clasificar distinto
// según si ya existe o no una OT madre creada.
export async function checkOpeplant(otJdeNumero: string, areaCodigo: string | null, fecha: Date) {
  const { semana, anio } = isoWeekInfo(fecha);
  const planSemana = await prisma.programacionSemanal.findFirst({
    where: {
      semana,
      anio,
      ...(areaCodigo ? { areaCodigo } : {}),
    },
    include: { otsProgramadas: { where: { esGuardia: true } } },
  });
  const esOpeplantPlan = !!planSemana?.otsProgramadas.some(
    o => String(o.numeroOT).toUpperCase() === String(otJdeNumero).toUpperCase()
  );
  return { esOpeplantPlan, planSemana };
}
