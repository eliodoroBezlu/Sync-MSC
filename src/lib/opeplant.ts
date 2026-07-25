import { prisma } from "@/lib/prisma";

export const DIAS_SEMANA_COMPLETA = ["Lu", "Ma", "Mi", "Ju", "Vi", "Sa", "Do"];

// Fuente única de verdad de qué hace que una OT sea OPEPLANT (guardia de
// planta): esGuardia marcado explícitamente, o el tag la etiqueta como tal.
// El importador no siempre setea ambos de forma consistente, así que hay
// que aceptar cualquiera de los dos.
export function esOpeplant(tag: string | null | undefined, esGuardia: boolean): boolean {
  return esGuardia || !!tag?.toUpperCase().includes("OPEPLANT");
}

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
    include: { otsProgramadas: true },
  });
  // Igual que la detección en las tarjetas del plan (registro/page.tsx): una OT es
  // OPEPLANT si esGuardia está marcado O si el tag la etiqueta como tal — el importador
  // no siempre setea ambos de forma consistente, así que hay que aceptar cualquiera.
  const esOpeplantPlan = !!planSemana?.otsProgramadas.some(
    o => String(o.numeroOT).toUpperCase() === String(otJdeNumero).toUpperCase()
      && (o.esGuardia || o.tag?.includes("OPEPLANT"))
  );
  return { esOpeplantPlan, planSemana };
}
