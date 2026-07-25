import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";
import { balancearOts, balancearDias } from "@/lib/planificacion/balanceador";
import { normalizarOpeplant } from "@/lib/planificacion/normalizarOpeplant";

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

    // Saneamiento previo: toda OT OPEPLANT (guardia de planta) debe quedar
    // programada los 7 días en ambos turnos, aunque haya sido importada
    // antes de que el importador aplicara esta regla.
    const otsActuales = await normalizarOpeplant(id, plan.ots);

    // Preparar datos para el balanceador — solo OTs elegidas para esta semana
    // (o guardia OPEPLANT, que siempre se programa) entran al balanceo.
    const otsParaBal = otsActuales
      .filter(o => o.seleccionada || o.esGuardia)
      .map(o => ({
        id: o.id,
        numeroOT: o.numeroOT,
        personas: o.personas,
        hrsTrabajo: o.hrsTrabajo,
        hhTotal: o.hhTotal,
        grupo: o.grupo,
        dias: o.dias,
        esGuardia: o.esGuardia,
      }));

    const rosterParaBal = plan.roster.map(r => ({
      nombre: r.nombre,
      asistencia: Array.isArray(r.asistencia) ? (r.asistencia as string[]) : [],
      grupo: r.grupo,
    }));
    const usuarioIdPorNombre = new Map(plan.roster.map(r => [r.nombre, r.usuarioId]));

    // Cuadrilla vigente: el balanceador solo puede repartir OTs entre
    // técnicos que efectivamente son miembros del grupo/día de la OT, nunca
    // entre cualquiera con asistencia D/N cruda (ver balanceador.ts).
    const miembrosCuadrilla = await prisma.cuadrillaMiembro.findMany({ where: { planBorradorId: id } });

    // Ejecutar balanceador: asigna técnicos y, por separado, reparte en la
    // semana las OTs que todavía no tienen día asignado. Ambos se indexan
    // por id de fila para no confundir la fila Diurno con la Nocturno de
    // una misma OT OPEPLANT.
    const asignaciones = balancearOts(otsParaBal, rosterParaBal, miembrosCuadrilla);
    const asignacionesDias = balancearDias(otsParaBal);

    // Actualizar OTs con nuevas asignaciones de personal y/o día
    let actualizadas = 0;
    for (const ot of otsParaBal) {
      const tecnicos = asignaciones.get(ot.id);
      const diasNuevos = asignacionesDias.get(ot.id);
      if (!tecnicos && !diasNuevos) continue;

      await prisma.planBorradorOt.update({
        where: { id: ot.id },
        data: {
          ...(tecnicos
            ? {
                personalAsignado: tecnicos,
                personalAsignadoIds: tecnicos
                  .map(n => usuarioIdPorNombre.get(n))
                  .filter((uid): uid is string => !!uid),
              }
            : {}),
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
