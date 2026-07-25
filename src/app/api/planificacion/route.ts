import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";
import { areaToDisciplina } from "@/lib/planificacion/areaToDisciplina";

function serialize(p: Record<string, unknown>) {
  return { ...p, _id: p.id };
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const semana    = searchParams.get("semana");
  const anio      = searchParams.get("anio");
  const areaCodigo = searchParams.get("areaCodigo");
  const estado    = searchParams.get("estado");
  const limit     = Math.min(Number(searchParams.get("limit") || "50"), 200);

  const planes = await prisma.planBorrador.findMany({
    where: {
      ...(semana     ? { semana: Number(semana) }   : {}),
      ...(anio       ? { anio: Number(anio) }       : {}),
      ...(areaCodigo ? { areaCodigo }               : {}),
      ...(estado     ? { estado }                   : {}),
    },
    include: { ots: true, roster: true },
    orderBy: [{ anio: "desc" }, { semana: "desc" }],
    take: limit,
  });

  return NextResponse.json(planes.map(p => serialize(p as Record<string, unknown>)));
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { semana, anio, areaCodigo, creadoPor } = body;

    if (!semana || !anio || !areaCodigo || !creadoPor) {
      return NextResponse.json({ ok: false, error: "semana, anio, areaCodigo y creadoPor son requeridos" }, { status: 400 });
    }

    const disciplina = areaToDisciplina(areaCodigo);
    const semanaNum = Number(semana);
    const anioNum = Number(anio);

    const existente = await prisma.planBorrador.findUnique({
      where: { semana_anio_areaCodigo: { semana: semanaNum, anio: anioNum, areaCodigo } },
    });

    const plan = existente ?? await prisma.planBorrador.create({
      data: { semana: semanaNum, anio: anioNum, areaCodigo, disciplina, creadoPor, estado: "borrador" },
    });

    // Al crear un plan nuevo (no al reabrir uno existente), arrastrar el
    // backlog: OTs del plan anterior de la misma área que no fueron elegidas
    // ni son OPEPLANT, para que el planificador vuelva a decidir esta semana.
    if (!existente) {
      const anterior = await prisma.planBorrador.findFirst({
        where: {
          areaCodigo,
          OR: [
            { anio: { lt: anioNum } },
            { anio: anioNum, semana: { lt: semanaNum } },
          ],
        },
        orderBy: [{ anio: "desc" }, { semana: "desc" }],
        include: { ots: true },
      });

      const backlog = (anterior?.ots ?? []).filter(o => !o.seleccionada && !o.esGuardia);
      let control = 1;
      for (const o of backlog) {
        await prisma.planBorradorOt.create({
          data: {
            planBorradorId: plan.id,
            control: control++,
            numeroOT: o.numeroOT,
            tipoOT: o.tipoOT,
            tipoTrabajo: o.tipoTrabajo,
            prioridad: o.prioridad,
            descripcion: o.descripcion,
            tag: o.tag,
            descripcionEquipo: o.descripcionEquipo,
            personas: o.personas,
            hrsTrabajo: o.hrsTrabajo,
            hhTotal: o.hhTotal,
            estadoJDE: o.estadoJDE,
            estadoDetalle: o.estadoDetalle,
            solicitante: o.solicitante,
            observaciones: o.observaciones,
            motivoNoProgramada: o.motivoNoProgramada,
            comentarioNoProgramada: o.comentarioNoProgramada,
            grupo: "Diurno",
            dias: [],
            personalAsignado: [],
            personalAsignadoIds: [],
            esGuardia: false,
            seleccionada: false,
            esBacklog: true,
          },
        });
      }
    }

    const planCompleto = await prisma.planBorrador.findUnique({
      where: { id: plan.id },
      include: { ots: true, roster: true },
    });

    return NextResponse.json({ ok: true, plan: serialize(planCompleto as unknown as Record<string, unknown>) }, { status: 201 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Error interno";
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}
