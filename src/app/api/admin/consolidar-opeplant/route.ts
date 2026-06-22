import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

async function siguienteNumeroOT(): Promise<string> {
  const counter = await prisma.contador.upsert({
    where: { nombre: "ordenTrabajo" },
    update: { valor: { increment: 1 } },
    create: { nombre: "ordenTrabajo", valor: 1 },
  });
  return String(counter.valor).padStart(6, "0");
}

/**
 * GET /api/admin/consolidar-opeplant?jdeNumero=892901
 *
 * Migración puntual: toma todas las OTs sueltas (origenPlan=false, sin parentOtId)
 * con ese otJdeNumero y las engancha como hijas de una OT consolidada madre.
 * Crea la madre si no existe, buscando el plan semanal por OtProgramada.esGuardia.
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const jdeNumero = searchParams.get("jdeNumero")?.trim();
  if (!jdeNumero) {
    return NextResponse.json({ error: "jdeNumero es requerido" }, { status: 400 });
  }

  // 1. OTs sueltas (reactivas, sin madre)
  const otsHuerfanas = await prisma.ordenTrabajo.findMany({
    where: {
      otJdeNumero: jdeNumero,
      parentOtId: null,
      origenPlan: false,
    },
    select: { id: true, numeroOT: true, areaCodigo: true, fecha: true },
    orderBy: { fecha: "asc" },
  });

  // 2. OT consolidada madre ya existente
  let madre = await prisma.ordenTrabajo.findFirst({
    where: {
      otJdeNumero: jdeNumero,
      origenPlan: true,
      parentOtId: null,
    },
    select: { id: true, numeroOT: true, programacionSemanalId: true },
  });

  // 3. Si no hay madre, buscar el plan por OtProgramada.esGuardia
  if (!madre) {
    const otProg = await prisma.otProgramada.findFirst({
      where: { numeroOT: jdeNumero, esGuardia: true },
      select: { programacionSemanalId: true },
    });

    const planInfo = otProg?.programacionSemanalId
      ? await prisma.programacionSemanal.findUnique({
          where: { id: otProg.programacionSemanalId },
          select: { id: true, areaCodigo: true, semana: true, anio: true },
        })
      : null;

    const areaCodigo = planInfo?.areaCodigo ?? otsHuerfanas[0]?.areaCodigo ?? null;
    const primeraFecha = otsHuerfanas[0]?.fecha ?? new Date();

    const numMadre = await siguienteNumeroOT();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    madre = await (prisma.ordenTrabajo.create as any)({
      data: {
        numeroOT: numMadre,
        fecha: primeraFecha,
        turno: "Guardia",
        areaCodigo,
        estado: "en_proceso",
        origenPlan: true,
        programacionSemanalId: planInfo?.id ?? null,
        otJdeNumero: jdeNumero,
        historial: {
          create: [{
            fechaHora: new Date(),
            usuarioId: "system",
            nombreUsuario: "Sistema (migración)",
            cambio: `OT consolidada OPEPLANT ${jdeNumero} creada por migración — ${otsHuerfanas.length} sub-OTs vinculadas`,
          }],
        },
      },
      select: { id: true, numeroOT: true, programacionSemanalId: true },
    });
  }

  // 4. Vincular todas las huérfanas como hijas de la madre
  const { count } = await prisma.ordenTrabajo.updateMany({
    where: {
      id: { in: otsHuerfanas.map(o => o.id) },
      parentOtId: null,
    },
    data: {
      parentOtId: madre!.id,
      parentOtNum: madre!.numeroOT,
    },
  });

  return NextResponse.json({
    ok: true,
    madreNumeroOT: madre!.numeroOT,
    madreId: madre!.id,
    otsMigradas: count,
    otsNums: otsHuerfanas.map(o => o.numeroOT),
  });
}
