import { prisma } from "@/lib/prisma";
import { NextRequest } from "next/server";

// Serializar OrdenTrabajo con sus relaciones al formato que espera el frontend
function serializeOT(ot: Record<string, unknown> & {
  tecnicos?: { usuarioId?: string | null; nombreCompleto: string }[];
  lineas?: Record<string, unknown>[];
  historial?: Record<string, unknown>[];
  registrosDiarios?: Record<string, unknown>[];
}) {
  return {
    _id: ot.id,
    numeroOT: ot.numeroOT,
    fecha: ot.fecha,
    turno: ot.turno,
    areaCodigo: ot.areaCodigo,
    estado: ot.estado,
    origenPlan: ot.origenPlan,
    programacionSemanalId: ot.programacionSemanalId,
    otJdeNumero: ot.otJdeNumero,
    otJdeDia: ot.otJdeDia,
    createdAt: ot.createdAt,
    tecnicos: (ot.tecnicos ?? []).map(t => ({
      usuarioId: t.usuarioId ?? "",
      nombreCompleto: t.nombreCompleto,
    })),
    lineas: (ot.lineas ?? []).map(l => ({
      tag: l.tag,
      descripcionEquipo: l.descripcionEquipo,
      tipoOT: l.tipoOT,
      sintoma: l.sintoma,
      causaProbable: l.causaProbable,
      resolucionAplicada: l.resolucionAplicada,
      tiempoEstimadoHrs: l.tiempoEstimadoHrs,
      tiempoRealHrs: l.tiempoRealHrs,
      descripcionTrabajo: l.descripcionTrabajo,
      tareasEjecutadas: l.tareasEjecutadas,
      observaciones: l.observaciones,
      adjuntos: l.adjuntos ?? [],
    })),
    historialCambios: (ot.historial ?? []).map(h => ({
      fechaHora: h.fechaHora,
      usuarioId: h.usuarioId,
      nombreUsuario: h.nombreUsuario,
      cambio: h.cambio,
    })),
    registrosDiarios: (ot.registrosDiarios ?? []).map(r => ({
      _id: r.id,
      fecha: r.fecha,
      tecnico: r.tecnico,
      usuarioId: r.usuarioId,
      hhTrabajadas: r.hhTrabajadas,
      tareasEjecutadas: r.tareas,
      observaciones: r.observaciones,
    })),
    datosSupervision: {
      codigoModoFallaISO: ot.supCodigoModoFallaISO,
      clasificacionRCM: ot.supClasificacionRCM,
      criticidadEquipo: ot.supCriticidadEquipo,
      leccionAprendida: ot.supLeccionAprendida,
      requierePlanificacion: ot.supRequierePlan,
      otRelacionada: ot.supOtRelacionada,
      comentariosSupervisor: ot.supComentarios,
      revisadoPor: ot.supRevisadoPor,
      revisadoEn: ot.supRevisadoEn,
    },
  };
}

const include = {
  tecnicos: true,
  lineas: true,
  historial: { orderBy: { fechaHora: "asc" as const } },
  registrosDiarios: { orderBy: { fecha: "asc" as const } },
};

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const area         = searchParams.get("area");
  const estado       = searchParams.get("estado");
  const tag          = searchParams.get("tag");
  const turno        = searchParams.get("turno");
  const fecha        = searchParams.get("fecha");
  const fechaDesde   = searchParams.get("fechaDesde");
  const fechaHasta   = searchParams.get("fechaHasta");
  const otJdeNumero  = searchParams.get("otJdeNumero");
  const origenPlan   = searchParams.get("origenPlan");
  const limit        = Math.min(Number(searchParams.get("limit") || "50"), 200);

  let fechaFilter = {};
  if (fecha) {
    const d = new Date(fecha);
    const next = new Date(d); next.setDate(next.getDate() + 1);
    fechaFilter = { gte: d, lt: next };
  } else if (fechaDesde || fechaHasta) {
    const rango: Record<string, Date> = {};
    if (fechaDesde) rango.gte = new Date(fechaDesde);
    if (fechaHasta) { const h = new Date(fechaHasta); h.setDate(h.getDate() + 1); rango.lt = h; }
    fechaFilter = rango;
  }

  const ordenes = await prisma.ordenTrabajo.findMany({
    where: {
      ...(area        ? { areaCodigo: area } : {}),
      ...(estado      ? { estado } : {}),
      ...(tag         ? { lineas: { some: { tag: tag.toUpperCase() } } } : {}),
      ...(turno       ? { turno } : {}),
      ...(otJdeNumero ? { otJdeNumero } : {}),
      ...(origenPlan !== null ? { origenPlan: origenPlan === "true" } : {}),
      ...(Object.keys(fechaFilter).length ? { fecha: fechaFilter } : {}),
    },
    include,
    orderBy: { fecha: "desc" },
    take: limit,
  });

  return Response.json(ordenes.map(o => serializeOT(o as Parameters<typeof serializeOT>[0])));
}

async function siguienteNumeroOT(): Promise<string> {
  const counter = await prisma.contador.upsert({
    where: { nombre: "ordenTrabajo" },
    update: { valor: { increment: 1 } },
    create: { nombre: "ordenTrabajo", valor: 1 },
  });
  return String(counter.valor).padStart(6, "0");
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const esDePlan = !!body.programacionSemanalId;

    const areaCodigo: string | null = body.areaCodigo?.trim() || null;

    // Garantizar que el área exista antes de crear la OT
    if (areaCodigo) {
      await prisma.area.upsert({
        where: { codigo: areaCodigo },
        update: {},
        create: { codigo: areaCodigo, nombre: areaCodigo, superintendencia: "" },
      });
    }

    // ── Consolidación OPEPLANT: si ya existe OT con mismo otJdeNumero en esta semana, agregar avance diario ──
    if (body.otJdeNumero && esDePlan) {
      const fechaOT = new Date(body.fecha);
      // Calcular lunes de la semana ISO de la fecha
      const day = fechaOT.getUTCDay() || 7;
      const lunes = new Date(fechaOT);
      lunes.setUTCDate(fechaOT.getUTCDate() - day + 1);
      lunes.setUTCHours(0, 0, 0, 0);
      const domingo = new Date(lunes);
      domingo.setUTCDate(lunes.getUTCDate() + 7);

      const existente = await prisma.ordenTrabajo.findFirst({
        where: {
          otJdeNumero: body.otJdeNumero,
          origenPlan: true,
          fecha: { gte: lunes, lt: domingo },
        },
        include,
        orderBy: { fecha: "asc" },
      });

      if (existente) {
        // Agregar registro diario + historial a la OT existente
        const registroData = {
          fecha: new Date(body.fecha),
          tecnico: body.tecnicos?.[0]?.nombreCompleto || "Técnico",
          usuarioId: body.tecnicos?.[0]?.usuarioId || null,
          hhTrabajadas: body.lineas?.reduce((s: number, l: Record<string, unknown>) => s + (Number(l.tiempoRealHrs) || 0), 0) || 0,
          tareasEjecutadas: body.lineas?.[0]?.tareasEjecutadas as string[] ?? [],
          observaciones: body.lineas?.[0]?.observaciones as string || null,
        };

        await prisma.otRegistroDiario.create({
          data: {
            ordenTrabajoId: existente.id,
            fecha: registroData.fecha,
            tecnico: registroData.tecnico,
            usuarioId: registroData.usuarioId,
            hhTrabajadas: registroData.hhTrabajadas,
            tareas: registroData.tareasEjecutadas,
            observaciones: registroData.observaciones,
          },
        });

        await prisma.otHistorial.create({
          data: {
            ordenTrabajoId: existente.id,
            fechaHora: new Date(),
            usuarioId: body.tecnicos?.[0]?.usuarioId || "system",
            nombreUsuario: body.tecnicos?.[0]?.nombreCompleto || "Sistema",
            cambio: `Avance del día ${body.otJdeDia ?? body.fecha} registrado — ${registroData.hhTrabajadas}HH`,
          },
        });

        // Actualizar estado del otProgramada correspondiente
        if (body.programacionSemanalId && body.otJdeNumero && body.otJdeDia) {
          await prisma.otProgramada.updateMany({
            where: {
              programacionSemanalId: body.programacionSemanalId,
              numeroOT: body.otJdeNumero,
              dia: body.otJdeDia,
            },
            data: { estado: "completada" },
          });
        }

        // Re-fetch con relaciones actualizadas
        const otActualizada = await prisma.ordenTrabajo.findUnique({
          where: { id: existente.id },
          include,
        });

        return Response.json(
          { ok: true, ot: serializeOT(otActualizada as Parameters<typeof serializeOT>[0]), consolidado: true },
          { status: 200 }
        );
      }
    }

    const numeroOT = await siguienteNumeroOT();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ot = await (prisma.ordenTrabajo.create as any)({
      data: {
        numeroOT,
        fecha: new Date(body.fecha),
        turno: body.turno,
        areaCodigo,
        estado: body.estado ?? "borrador",
        origenPlan: esDePlan,
        programacionSemanalId: body.programacionSemanalId || null,
        otJdeNumero: body.otJdeNumero || null,
        otJdeDia: body.otJdeDia || null,
        tecnicos: {
          create: (body.tecnicos ?? []).map((t: { usuarioId?: string; nombreCompleto: string }) => ({
            usuarioId: t.usuarioId || null,
            nombreCompleto: t.nombreCompleto,
          })),
        },
        lineas: {
          create: (body.lineas ?? []).map((l: Record<string, unknown>) => ({
            tag: String(l.tag).toUpperCase(),
            descripcionEquipo: String(l.descripcionEquipo ?? ""),
            tipoOT: String(l.tipoOT),
            sintoma: l.sintoma as string | null ?? null,
            causaProbable: l.causaProbable as string | null ?? null,
            resolucionAplicada: l.resolucionAplicada as string | null ?? null,
            tiempoEstimadoHrs: l.tiempoEstimadoHrs as number | null ?? null,
            tiempoRealHrs: l.tiempoRealHrs as number | null ?? null,
            descripcionTrabajo: l.descripcionTrabajo as string | null ?? null,
            tareasEjecutadas: (l.tareasEjecutadas as string[]) ?? [],
            observaciones: l.observaciones as string | null ?? null,
            adjuntos: (l.adjuntos as object[]) ?? [],
          })),
        },
        historial: {
          create: [{
            fechaHora: new Date(),
            usuarioId: body.tecnicos?.[0]?.usuarioId || "system",
            nombreUsuario: body.tecnicos?.[0]?.nombreCompleto || "Sistema",
            cambio: esDePlan
              ? `OT creada desde plan semanal (JDE: ${body.otJdeNumero ?? "—"} · ${body.otJdeDia ?? ""})`
              : body.estado === "pendiente_revision" ? "OT enviada a revisión" : "OT creada como borrador",
          }],
        },
      },
      include,
    });

    // Actualizar plan semanal si viene del plan
    // Para OTs recurrentes (misma OT en múltiples días) se vinculan TODOS los días sin filtrar por día
    if (esDePlan && body.programacionSemanalId && body.otJdeNumero) {
      await prisma.otProgramada.updateMany({
        where: {
          programacionSemanalId: body.programacionSemanalId,
          numeroOT: body.otJdeNumero,
          ...(!body.esRecurrente && body.otJdeDia ? { dia: body.otJdeDia } : {}),
        },
        data: {
          estado: "en_proceso",
          ordenTrabajoId: ot.id,
          ordenTrabajoNum: ot.numeroOT,
        },
      });
    }

    return Response.json(
      { ok: true, ot: serializeOT(ot as Parameters<typeof serializeOT>[0]) },
      { status: 201 }
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Error interno";
    return Response.json({ ok: false, error: message }, { status: 400 });
  }
}
