import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";
import { balancearOts } from "@/lib/planificacion/balanceador";

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
        const ot = o as { numeroOT: string; personas: number; hrsTrabajo: number; grupo: string };
        return {
          numeroOT: ot.numeroOT,
          personas: ot.personas,
          hrsTrabajo: ot.hrsTrabajo,
          grupo: ot.grupo,
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

    // Ejecutar balanceador
    const asignaciones = balancearOts(otsParaBal, rosterParaBal);

    // Actualizar OTs con nuevas asignaciones
    let actualizadas = 0;
    for (const [otNumero, tecnicos] of asignaciones) {
      const ot = plan.ots.find((o: unknown) => (o as { numeroOT: string }).numeroOT === otNumero);
      if (ot) {
        await prisma.planBorradorOt.update({
          where: { id: (ot as { id: string }).id },
          data: { personalAsignado: tecnicos },
        });
        actualizadas++;
      }
    }

    return NextResponse.json({
      ok: true,
      actualizadas,
      mensaje: `${actualizadas} OTs balanceadas automáticamente entre ${rosterParaBal.length} técnicos`,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Error interno";
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}
