import { prisma } from "@/lib/prisma";

// Detecta OTs "de largo aliento" (recurrentes) sin depender de que nadie las marque
// a mano: si una misma OT (ordenTrabajoId) quedo vinculada a mas de una semana del
// plan (OtProgramada.programacionSemanalId distintos), es porque el plan la volvio a
// programar en una semana posterior — la firma misma de una OT recurrente.
export async function calcularOtsRecurrentes(ordenTrabajoIds: string[]): Promise<Map<string, boolean>> {
  const ids = [...new Set(ordenTrabajoIds)].filter(Boolean);
  const resultado = new Map<string, boolean>();
  if (ids.length === 0) return resultado;

  const vinculos = await prisma.otProgramada.findMany({
    where: { ordenTrabajoId: { in: ids } },
    select: { ordenTrabajoId: true, programacionSemanalId: true },
  });

  const semanasPorOt = new Map<string, Set<string>>();
  for (const v of vinculos) {
    if (!v.ordenTrabajoId) continue;
    const semanas = semanasPorOt.get(v.ordenTrabajoId) ?? new Set<string>();
    semanas.add(v.programacionSemanalId);
    semanasPorOt.set(v.ordenTrabajoId, semanas);
  }

  for (const id of ids) {
    resultado.set(id, (semanasPorOt.get(id)?.size ?? 0) > 1);
  }
  return resultado;
}
