import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

const include = {
  tecnicos: true,
  lineas: true,
  historial: { orderBy: { fechaHora: "asc" as const } },
  registrosDiarios: { orderBy: { fecha: "asc" as const } },
};

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
    parentOtId: ot.parentOtId ?? null,
    parentOtNum: ot.parentOtNum ?? null,
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

function normalizeString(value: unknown): string | null {
  if (typeof value === "string") {
    return value.trim() || null;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value).trim() || null;
  }
  return null;
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const area = searchParams.get("area");
  const estado = searchParams.get("estado");
  const tag = searchParams.get("tag");
  const turno = searchParams.get("turno");
  const fecha = searchParams.get("fecha");
  const fechaDesde = searchParams.get("fechaDesde");
  const fechaHasta = searchParams.get("fechaHasta");
  const otJdeNumero = searchParams.get("otJdeNumero");
  const origenPlan = searchParams.get("origenPlan");
  const limit = Math.min(Number(searchParams.get("limit") || "50"), 200);

  let fechaFilter: Record<string, Date> = {};
  if (fecha) {
    const d = new Date(fecha);
    const next = new Date(d);
    next.setDate(next.getDate() + 1);
    fechaFilter = { gte: d, lt: next };
  } else if (fechaDesde || fechaHasta) {
    if (fechaDesde) fechaFilter.gte = new Date(fechaDesde);
    if (fechaHasta) {
      const h = new Date(fechaHasta);
      h.setDate(h.getDate() + 1);
      fechaFilter.lt = h;
    }
  }

  const parentOtId = searchParams.get("parentOtId");
  const incluirArchivados = searchParams.get("incluirArchivados") === "true";
  // incluirHijas=true: muestra OTs hijas de OPEPLANT (para Reporte de OT del supervisor)
  const incluirHijas = searchParams.get("incluirHijas") === "true";
  const esDomingo = new Date().getUTCDay() === 0;

  // Capa 3: auto-archivo — ocultar OTs concluidas con más de 90 días si no se pide el historial completo.
  // Se omite cuando: el usuario pide explícitamente el historial, hay un filtro de fecha propio del cliente,
  // o se consulta por otJdeNumero/parentOtId (contexto de merge o detalle).
  const ARCHIVO_DIAS = 90;
  const fechaArchivoCorte = new Date();
  fechaArchivoCorte.setDate(fechaArchivoCorte.getDate() - ARCHIVO_DIAS);
  const aplicarFiltroArchivo = !incluirArchivados && !otJdeNumero && !parentOtId && !fechaDesde && !fechaHasta && !fecha;

  // Condiciones AND para combinar múltiples filtros NOT sin sobreescribirse
  const andConditions: object[] = [];

  // Ocultar OTs hijas OPEPLANT del panel principal (reactivas con otJdeNumero seteado).
  // Se omite cuando incluirHijas=true (ej: Reporte de OT donde el supervisor debe verlas).
  if (!otJdeNumero && !parentOtId && !incluirHijas) {
    andConditions.push({ NOT: { origenPlan: false, otJdeNumero: { not: null } } });
  }
  // Ocultar OTs OPEPLANT de plan pendientes fuera del domingo.
  // Cuando se consulta por otJdeNumero explícito (ej: para PDF merge) se necesitan
  // TODOS los registros sin importar estado, así que se omite este filtro.
  if (!esDomingo && !otJdeNumero) {
    andConditions.push({ NOT: { estado: "pendiente_revision", origenPlan: true, otJdeNumero: { not: null } } });
  }

  // Capa 3: excluir OTs concluidas archivadas (>90 días) salvo que se pida historial completo
  if (aplicarFiltroArchivo) {
    andConditions.push({ NOT: { estado: "concluido", fecha: { lt: fechaArchivoCorte } } });
  }

  const programacionSemanalId = searchParams.get("programacionSemanalId");

  const ordenes = await prisma.ordenTrabajo.findMany({
    where: {
      ...(area ? { areaCodigo: area } : {}),
      ...(estado ? { estado } : {}),
      ...(tag ? { lineas: { some: { tag: tag.toUpperCase() } } } : {}),
      ...(turno ? { turno } : {}),
      ...(otJdeNumero ? { otJdeNumero } : {}),
      ...(origenPlan !== null ? { origenPlan: origenPlan === "true" } : {}),
      ...(Object.keys(fechaFilter).length ? { fecha: fechaFilter } : {}),
      ...(parentOtId ? { parentOtId } : {}),
      ...(programacionSemanalId ? { programacionSemanalId } : {}),
      ...(andConditions.length > 0 ? { AND: andConditions } : {}),
    },
    include,
    orderBy: { fecha: "desc" },
    take: limit,
  });

  // Deduplicar OTs de plan con mismo otJdeNumero+programacionSemanalId.
  // Se omite cuando se consulta por otJdeNumero explícito — en ese caso se necesitan
  // TODOS los registros (ej: para fusionar datos al generar el PDF).
  let resultado = ordenes;
  if (!otJdeNumero) {
    const seen = new Set<string>();
    resultado = ordenes.filter(o => {
      const rec = o as Record<string, unknown>;
      if (rec.origenPlan && rec.otJdeNumero && rec.programacionSemanalId) {
        const key = `${rec.programacionSemanalId}::${rec.otJdeNumero}`;
        if (seen.has(key)) return false;
        seen.add(key);
      }
      return true;
    });
  }

  return NextResponse.json(resultado.map(o => serializeOT(o as Parameters<typeof serializeOT>[0])));
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
    const areaCodigo: string | null = typeof body.areaCodigo === "string" ? body.areaCodigo.trim() || null : null;
    const otJdeNumero = normalizeString(body.otJdeNumero);
    const otJdeDia = normalizeString(body.otJdeDia);

    if (areaCodigo) {
      await prisma.area.upsert({
        where: { codigo: areaCodigo },
        update: {},
        create: { codigo: areaCodigo, nombre: areaCodigo, superintendencia: "" },
      });
    }

    if (esDePlan && body.programacionSemanalId) {
      // Buscar OT existente para este plan+OT sin restricción de fecha (la semana ya está en el plan)
      const whereExistente: Record<string, unknown> = {
        origenPlan: true,
        programacionSemanalId: body.programacionSemanalId,
      };
      if (otJdeNumero) whereExistente.otJdeNumero = otJdeNumero;

      const existente = await prisma.ordenTrabajo.findFirst({
        where: whereExistente,
        include,
        orderBy: { fecha: "asc" },
      });

      if (existente) {
        const registroData = {
          fecha: new Date(body.fecha),
          tecnico: body.tecnicos?.[0]?.nombreCompleto || "Técnico",
          usuarioId: body.tecnicos?.[0]?.usuarioId || null,
          hhTrabajadas: (body.lineas ?? []).reduce((sum: number, l: Record<string, unknown>) => sum + (Number(l.tiempoRealHrs) || 0), 0),
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
            cambio: `Avance del día ${otJdeDia ?? body.fecha} registrado — ${registroData.hhTrabajadas}HH`,
          },
        });

        // Actualizar la OtProgramada del día actual con ordenTrabajoId Y estado
        if (otJdeDia) {
          await prisma.otProgramada.updateMany({
            where: {
              programacionSemanalId: body.programacionSemanalId,
              ...(otJdeNumero ? { numeroOT: otJdeNumero } : {}),
              dia: otJdeDia,
            },
            data: {
              estado: "completada",
              ordenTrabajoId: existente.id,
              ordenTrabajoNum: existente.numeroOT,
            },
          });
        }

        const otActualizada = await prisma.ordenTrabajo.findUnique({
          where: { id: existente.id },
          include,
        });

        return NextResponse.json(
          { ok: true, ot: serializeOT(otActualizada as Parameters<typeof serializeOT>[0]), consolidado: true },
          { status: 200 }
        );
      }
    }

    // Detectar si otJdeNumero corresponde a una OT OPEPLANT madre existente
    let parentOtId: string | null = null;
    let parentOtNum: string | null = null;
    if (otJdeNumero && !esDePlan) {
      const otMadre = await prisma.ordenTrabajo.findFirst({
        where: { otJdeNumero, origenPlan: true, parentOtId: null },
        select: { id: true, numeroOT: true },
      });
      if (otMadre) {
        parentOtId = otMadre.id;
        parentOtNum = otMadre.numeroOT;
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
        otJdeNumero,
        otJdeDia,
        parentOtId,
        parentOtNum,
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
            sintoma: (l.sintoma as string | null) ?? null,
            causaProbable: (l.causaProbable as string | null) ?? null,
            resolucionAplicada: (l.resolucionAplicada as string | null) ?? null,
            tiempoEstimadoHrs: (l.tiempoEstimadoHrs as number | null) ?? null,
            tiempoRealHrs: (l.tiempoRealHrs as number | null) ?? null,
            descripcionTrabajo: (l.descripcionTrabajo as string | null) ?? null,
            tareasEjecutadas: (l.tareasEjecutadas as string[]) ?? [],
            observaciones: (l.observaciones as string | null) ?? null,
            adjuntos: (l.adjuntos as object[]) ?? [],
          })),
        },
        historial: {
          create: [{
            fechaHora: new Date(),
            usuarioId: body.tecnicos?.[0]?.usuarioId || "system",
            nombreUsuario: body.tecnicos?.[0]?.nombreCompleto || "Sistema",
            cambio: esDePlan
              ? `OT creada desde plan semanal (JDE: ${otJdeNumero ?? "—"} · ${otJdeDia ?? ""})`
              : body.estado === "pendiente_revision" ? "OT enviada a revisión" : "OT creada como borrador",
          }],
        },
      },
      include,
    });

    if (esDePlan && body.programacionSemanalId && otJdeNumero) {
      await prisma.otProgramada.updateMany({
        where: {
          programacionSemanalId: body.programacionSemanalId,
          numeroOT: otJdeNumero,
          ...(!body.esRecurrente && otJdeDia ? { dia: otJdeDia } : {}),
        },
        data: {
          estado: "en_proceso",
          ordenTrabajoId: ot.id,
          ordenTrabajoNum: ot.numeroOT,
        },
      });
    }

    return NextResponse.json(
      { ok: true, ot: serializeOT(ot as Parameters<typeof serializeOT>[0]) },
      { status: 201 }
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Error interno";
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}
