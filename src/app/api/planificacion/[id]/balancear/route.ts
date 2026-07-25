import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";
import { balancearOts, balancearDias } from "@/lib/planificacion/balanceador";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(_req: NextRequest, { params }: Ctx) {
  try {
    const { id } = await params;

    const plan = await prisma.planBorrador.findUnique({
      where: { id },
      include: { ots: true, roster: true },
    });

    if (!plan) return NextResponse.json({ error: "Plan no encontrado" }, { status: 404 });
    if (plan.estado === "publicado") return NextResponse.json({ error: "No se puede balancear un plan publicado" }, { status: 400 });

    // Preparar datos para el balanceador — solo OTs elegidas para esta semana
    // (o guardia OPEPLANT, que siempre se programa) entran al balanceo.
    const otsParaBal = (plan.ots as unknown[])
      .filter((o: unknown) => (o as { seleccionada: boolean; esGuardia: boolean }).seleccionada
        || (o as { seleccionada: boolean; esGuardia: boolean }).esGuardia)
      .map((o: unknown) => {
        const ot = o as { numeroOT: string; personas: number; hrsTrabajo: number; hhTotal: number; grupo: string; dias: string[]; esGuardia: boolean };
        return {
          numeroOT: ot.numeroOT,
          personas: ot.personas,
          hrsTrabajo: ot.hrsTrabajo,
          hhTotal: ot.hhTotal,
          grupo: ot.grupo,
          dias: ot.dias,
          esGuardia: ot.esGuardia,
        };
      });

    const rosterParaBal = (plan.roster as unknown[]).map((r: unknown) => {
      const rs = r as { nombre: string; asistencia: string[]; grupo: string };
      return {
        nombre: rs.nombre,
        asistencia: rs.asistencia,
        grupo: rs.grupo,
      };
    });

    // Ejecutar balanceador: asigna técnicos y, por separado, reparte en la
    // semana las OTs que todavía no tienen día asignado.
    const asignaciones = balancearOts(otsParaBal, rosterParaBal);
    const asignacionesDias = balancearDias(otsParaBal);

    // Actualizar OTs con nuevas asignaciones de personal y/o día
    let actualizadas = 0;
    for (const ot of otsParaBal) {
      const tecnicos = asignaciones.get(ot.numeroOT);
      const diasNuevos = asignacionesDias.get(ot.numeroOT);
      if (!tecnicos && !diasNuevos) continue;

      const otDb = plan.ots.find((o: unknown) => (o as { numeroOT: string }).numeroOT === ot.numeroOT);
      if (!otDb) continue;

      await prisma.planBorradorOt.update({
        where: { id: (otDb as { id: string }).id },
        data: {
          ...(tecnicos ? { personalAsignado: tecnicos } : {}),
          ...(diasNuevos ? { dias: diasNuevos, diasTexto: diasNuevos.join(", ") } : {}),
        },
      });
      actualizadas++;
    }

    return NextResponse.json({
      ok: true,
      actualizadas,
      mensaje: `${actualizadas} OTs balanceadas y repartidas en la semana entre ${rosterParaBal.length} técnicos`,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Error interno";
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}
