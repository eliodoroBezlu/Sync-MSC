import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";
import { crearReporteSchema, serialize, zodError } from "@/lib/parada/validacion";
import { calcularTablero, ymd } from "@/lib/parada/indicadores";

type Ctx = { params: Promise<{ id: string }> };

// GET /api/paradas/[id]/reportes?fecha=&turno=&reunion=
export async function GET(req: NextRequest, { params }: Ctx) {
  const { id } = await params;
  const sp = req.nextUrl.searchParams;
  const where: Record<string, unknown> = { paradaId: id };
  const fecha = sp.get("fecha");
  if (fecha) where.fecha = new Date(`${ymd(fecha)}T00:00:00.000Z`);
  if (sp.get("turno")) where.turno = sp.get("turno");
  if (sp.get("reunion")) where.reunion = sp.get("reunion");

  const reportes = await prisma.paradaReporteDiario.findMany({
    where,
    orderBy: [{ fecha: "desc" }, { reunion: "desc" }],
  });
  return NextResponse.json(reportes.map((r) => serialize(r)));
}

// POST /api/paradas/[id]/reportes — crea (o reabre) el reporte del supervisor.
// Con `prellenar: true` autocompleta HH, OTs terminadas y avance global desde
// los avances diarios de esa fecha/turno.
export async function POST(req: NextRequest, { params }: Ctx) {
  try {
    const { id } = await params;
    const parada = await prisma.parada.findUnique({
      where: { id },
      include: { ots: true, avances: true },
    });
    if (!parada) return NextResponse.json({ ok: false, error: "Parada no encontrada" }, { status: 404 });

    const parsed = crearReporteSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ ok: false, error: zodError(parsed.error) }, { status: 400 });
    }
    const d = parsed.data;
    const fechaUTC = new Date(`${ymd(d.fecha)}T00:00:00.000Z`);

    let avanceGlobalPct = 0;
    let hhPropias = 0;
    let hhApoyo = 0;
    let otsTerminadas: string[] = [];

    if (d.prellenar) {
      const otPorId = new Map(parada.ots.map((o) => [o.id, o]));
      const delTurno = parada.avances.filter(
        (a) => ymd(a.fecha) === ymd(fechaUTC) && a.turno === d.turno,
      );
      hhPropias = delTurno.reduce((s, a) => s + a.hhPropias, 0);
      hhApoyo = delTurno.reduce((s, a) => s + a.hhApoyo, 0);
      otsTerminadas = [
        ...new Set(
          delTurno
            .filter((a) => a.estado === "terminada")
            .map((a) => otPorId.get(a.paradaOtId)?.numeroOT)
            .filter((n): n is string => Boolean(n)),
        ),
      ];
      avanceGlobalPct = calcularTablero(parada).avanceGlobalPct;
    }

    const reporte = await prisma.paradaReporteDiario.upsert({
      where: {
        paradaId_fecha_turno_reunion: {
          paradaId: id,
          fecha: fechaUTC,
          turno: d.turno,
          reunion: d.reunion,
        },
      },
      create: {
        paradaId: id,
        fecha: fechaUTC,
        turno: d.turno,
        reunion: d.reunion,
        supervisorNombre: d.supervisorNombre,
        supervisorUsuarioId: d.supervisorUsuarioId ?? null,
        resumen: d.resumen,
        observaciones: d.observaciones ?? null,
        avanceGlobalPct,
        hhPropias,
        hhApoyo,
        otsTerminadas,
      },
      update: {
        supervisorNombre: d.supervisorNombre,
        supervisorUsuarioId: d.supervisorUsuarioId ?? null,
        ...(d.resumen ? { resumen: d.resumen } : {}),
        ...(d.observaciones !== undefined ? { observaciones: d.observaciones ?? null } : {}),
        ...(d.prellenar ? { avanceGlobalPct, hhPropias, hhApoyo, otsTerminadas } : {}),
      },
    });

    return NextResponse.json({ ok: true, reporte: serialize(reporte) }, { status: 201 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Error interno";
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}
