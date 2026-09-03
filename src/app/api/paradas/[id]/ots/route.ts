import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";
import { crearOtSchema, serialize, zodError } from "@/lib/parada/validacion";

type Ctx = { params: Promise<{ id: string }> };

// GET /api/paradas/[id]/ots?fase=&disciplina=&grupo=&estado=
export async function GET(req: NextRequest, { params }: Ctx) {
  const { id } = await params;
  const sp = req.nextUrl.searchParams;
  const where: Record<string, unknown> = { paradaId: id };
  for (const k of ["fase", "disciplina", "grupo", "estado"] as const) {
    const v = sp.get(k);
    if (v) where[k] = v;
  }
  const ots = await prisma.paradaOt.findMany({
    where,
    orderBy: [{ orden: "asc" }, { numeroOT: "asc" }],
  });
  return NextResponse.json(ots.map((o) => serialize(o)));
}

// POST /api/paradas/[id]/ots — agrega una OT manual.
export async function POST(req: NextRequest, { params }: Ctx) {
  try {
    const { id } = await params;
    const parada = await prisma.parada.findUnique({ where: { id }, select: { id: true } });
    if (!parada) return NextResponse.json({ ok: false, error: "Parada no encontrada" }, { status: 404 });

    const parsed = crearOtSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ ok: false, error: zodError(parsed.error) }, { status: 400 });
    }
    const d = parsed.data;
    const orden = d.orden ?? (await prisma.paradaOt.count({ where: { paradaId: id } })) + 1;

    const ot = await prisma.paradaOt.create({
      data: {
        paradaId: id,
        numeroOT: d.numeroOT,
        descripcion: d.descripcion,
        tag: d.tag.toUpperCase(),
        descripcionEquipo: d.descripcionEquipo,
        disciplina: d.disciplina,
        fase: d.fase,
        hhEstimadas: d.hhEstimadas,
        fechaProg: d.fechaProg ?? null,
        fechaProgFin: d.fechaProgFin ?? null,
        grupo: d.grupo,
        responsable: d.responsable ?? null,
        critica: d.critica,
        observaciones: d.observaciones ?? null,
        personalAsignado: d.personalAsignado ?? [],
        personalAsignadoIds: d.personalAsignadoIds ?? [],
        orden,
      },
    });
    return NextResponse.json({ ok: true, ot: serialize(ot) }, { status: 201 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Error interno";
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}
