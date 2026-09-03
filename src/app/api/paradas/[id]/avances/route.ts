import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";
import {
  avanceSchema,
  avancesBatchSchema,
  serialize,
  zodError,
} from "@/lib/parada/validacion";
import { ymd } from "@/lib/parada/indicadores";
import { z } from "zod";

type Ctx = { params: Promise<{ id: string }> };
type AvanceInput = z.infer<typeof avanceSchema>;

// GET /api/paradas/[id]/avances?fecha=YYYY-MM-DD&turno=Dia|Noche
export async function GET(req: NextRequest, { params }: Ctx) {
  const { id } = await params;
  const sp = req.nextUrl.searchParams;
  const where: Record<string, unknown> = { paradaId: id };
  const fecha = sp.get("fecha");
  const turno = sp.get("turno");
  if (fecha) where.fecha = new Date(`${ymd(fecha)}T00:00:00.000Z`);
  if (turno) where.turno = turno;

  const avances = await prisma.paradaAvanceDiario.findMany({
    where,
    orderBy: [{ fecha: "asc" }, { turno: "asc" }],
  });
  return NextResponse.json(avances.map((a) => serialize(a)));
}

// POST /api/paradas/[id]/avances — upsert de uno o varios avances diarios.
// Sólo se aceptan avances de OTs con fase = "ejecucion" (las HH de preparativos
// no entran al tablero). Actualiza el cache ParadaOt.avancePct / estado.
export async function POST(req: NextRequest, { params }: Ctx) {
  try {
    const { id } = await params;
    const parsed = avancesBatchSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ ok: false, error: zodError(parsed.error) }, { status: 400 });
    }
    const items: AvanceInput[] = "items" in parsed.data ? parsed.data.items : [parsed.data];

    const otIds = [...new Set(items.map((i) => i.paradaOtId))];
    const ots = await prisma.paradaOt.findMany({
      where: { id: { in: otIds }, paradaId: id },
      select: { id: true, fase: true },
    });
    const faseDe = new Map(ots.map((o) => [o.id, o.fase]));

    const guardados = [];
    const rechazados: { paradaOtId: string; motivo: string }[] = [];

    for (const it of items) {
      const fase = faseDe.get(it.paradaOtId);
      if (!fase) {
        rechazados.push({ paradaOtId: it.paradaOtId, motivo: "OT no pertenece a la parada" });
        continue;
      }
      if (fase !== "ejecucion") {
        rechazados.push({ paradaOtId: it.paradaOtId, motivo: "OT de preparativos: no lleva HH" });
        continue;
      }
      const fechaUTC = new Date(`${ymd(it.fecha)}T00:00:00.000Z`);

      const avance = await prisma.paradaAvanceDiario.upsert({
        where: {
          paradaOtId_fecha_turno: {
            paradaOtId: it.paradaOtId,
            fecha: fechaUTC,
            turno: it.turno,
          },
        },
        create: {
          paradaId: id,
          paradaOtId: it.paradaOtId,
          fecha: fechaUTC,
          turno: it.turno,
          avancePct: it.avancePct,
          hhPropias: it.hhPropias,
          hhApoyo: it.hhApoyo,
          estado: it.estado,
          comentario: it.comentario ?? null,
          registradoPor: it.registradoPor,
        },
        update: {
          avancePct: it.avancePct,
          hhPropias: it.hhPropias,
          hhApoyo: it.hhApoyo,
          estado: it.estado,
          comentario: it.comentario ?? null,
          registradoPor: it.registradoPor,
        },
      });

      // Cache en la OT: último avance / estado reportado.
      await prisma.paradaOt.update({
        where: { id: it.paradaOtId },
        data: { avancePct: it.avancePct, estado: it.estado },
      });

      guardados.push(serialize(avance));
    }

    return NextResponse.json({ ok: true, guardados, rechazados }, { status: 201 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Error interno";
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}
