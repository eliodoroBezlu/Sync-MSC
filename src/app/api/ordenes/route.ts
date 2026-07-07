import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

const include = {
  tecnicos: true,
  lineas: true,
  historial: { orderBy: { fechaHora: "asc" as const } },
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
      estadoFinal: l.estadoFinal,
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
  const buscarNumero = searchParams.get("buscarNumero"); // búsqueda directa por número de OT (bypassa filtros de visibilidad)
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
  // Capa 3: auto-archivo — ocultar OTs concluidas con más de 90 días si no se pide el historial completo.
  // Se omite cuando: el usuario pide explícitamente el historial, hay un filtro de fecha propio del cliente,
  // o se consulta por otJdeNumero/parentOtId (contexto de merge o detalle).
  const ARCHIVO_DIAS = 90;
  const fechaArchivoCorte = new Date();
  fechaArchivoCorte.setDate(fechaArchivoCorte.getDate() - ARCHIVO_DIAS);
  const aplicarFiltroArchivo = !incluirArchivados && !otJdeNumero && !parentOtId && !fechaDesde && !fechaHasta && !fecha;

  // Condiciones AND para combinar múltiples filtros NOT sin sobreescribirse
  const andConditions: object[] = [];

  // Búsqueda directa por número de OT o número JDE — bypassa filtros de visibilidad.
  // Para OPEPLANT retorna solo la más reciente (dedup por otJdeNumero), igual que la lista principal.
  if (buscarNumero) {
    const num = buscarNumero.trim();
    const ots = await prisma.ordenTrabajo.findMany({
      where: {
        OR: [
          { numeroOT: num },
          { otJdeNumero: num },
        ],
      },
      include,
      orderBy: { fecha: "desc" },
      take: 50,
    });
    // Dedup: ocultar hijas con parentOtId (visibles a través de su madre consolidada)
    // y mantener solo una OT por otJdeNumero cuando origenPlan=true.
    const seen = new Set<string>();
    const deduped = ots.filter(o => {
      if (o.parentOtId) return false; // hija de una OT consolidada — no mostrar suelta
      if (o.origenPlan && o.otJdeNumero) {
        if (seen.has(o.otJdeNumero)) return false;
        seen.add(o.otJdeNumero);
      }
      return true;
    });
    return NextResponse.json(deduped.map(o => serializeOT(o as Parameters<typeof serializeOT>[0])));
  }

  // Ocultar OTs hijas de OPEPLANT del Reporte principal, EXCEPTO las de turno especial
  // que deben ser siempre visibles para el ciclo de revisión del supervisor.
  // OTs con turno "Parada de Planta", "Planta" o "Otro" aparecen siempre aunque tengan parentOtId.
  const TURNOS_SIEMPRE_VISIBLES = ["Parada de Planta", "Planta", "Otro"];
  if (!otJdeNumero && !parentOtId && !incluirHijas) {
    andConditions.push({
      OR: [
        { parentOtId: null },
        { turno: { in: TURNOS_SIEMPRE_VISIBLES } },
      ],
    });
    andConditions.push({ NOT: { origenPlan: false, otJdeNumero: { not: null }, turno: { notIn: TURNOS_SIEMPRE_VISIBLES } } });
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

  // Deduplicar OTs OPEPLANT: mostrar solo la más reciente por otJdeNumero.
  // El supervisor ve UNA sola OT por número de planta; el PDF ya consolida todos los avances de todas las semanas.
  // Se omite cuando se consulta por otJdeNumero explícito (PDF merge necesita todos los registros).
  let resultado = ordenes;
  if (!otJdeNumero) {
    const seen = new Set<string>();
    resultado = ordenes.filter(o => {
      const rec = o as Record<string, unknown>;
      if (rec.origenPlan && rec.otJdeNumero) {
        const key = String(rec.otJdeNumero);
        if (seen.has(key)) return false;
        seen.add(key);
      }
      return true;
    });
  }

  return NextResponse.json(resultado.map(o => serializeOT(o as Parameters<typeof serializeOT>[0])));
}

function isoWeekInfo(date: Date): { semana: number; anio: number } {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const semana = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return { semana, anio: d.getUTCFullYear() };
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

    if (esDePlan) {
      // OPEPLANT: una sola OT acumula todos los avances del ciclo (sin importar la semana).
      // Solo se crea OT nueva cuando el supervisor cierra el ciclo anterior (estado "concluido").
      // Para OTs de plan sin número JDE, se mantiene consolidación por semana (CMP/CMR planificados).
      // Solo Eléctrico e Instrumentación tienen OPEPLANT. Se exige coincidencia de
      // areaCodigo como defensa adicional: evita que un número JDE repetido o mal
      // asignado en otra área (contratista, error de captura, etc.) se fusione con
      // el ciclo de Eléctrico/Instrumentación.
      const whereExistente: Record<string, unknown> = otJdeNumero
        ? { otJdeNumero, origenPlan: true, NOT: { estado: "concluido" }, ...(areaCodigo ? { areaCodigo } : {}) }
        : { origenPlan: true, programacionSemanalId: body.programacionSemanalId };

      const existente = await prisma.ordenTrabajo.findFirst({
        where: whereExistente,
        include,
        orderBy: { fecha: "desc" },
      });

      if (existente) {
        // Bloquear avances si la OT ya fue enviada a revisión o está cerrada
        const estadosBloqueados = ["pendiente_revision", "revisado", "concluido"];
        if (estadosBloqueados.includes(existente.estado)) {
          return NextResponse.json(
            { ok: false, error: `No se puede agregar un avance — la OT está en estado "${existente.estado}". Contacta al supervisor.` },
            { status: 409 }
          );
        }

        const registroData = {
          fecha: new Date(body.fecha),
          tecnico: body.tecnicos?.[0]?.nombreCompleto || "Técnico",
          usuarioId: body.tecnicos?.[0]?.usuarioId || null,
          hhTrabajadas: (body.lineas ?? []).reduce((sum: number, l: Record<string, unknown>) => sum + (Number(l.tiempoRealHrs) || 0), 0),
          tareasEjecutadas: body.lineas?.[0]?.tareasEjecutadas as string[] ?? [],
          observaciones: body.lineas?.[0]?.observaciones as string || null,
        };

        const newRdId2 = crypto.randomUUID();
        try {
          await prisma.$executeRaw`
            INSERT INTO "OtRegistroDiario" (id, "ordenTrabajoId", fecha, tecnico, "usuarioId", "hhTrabajadas", tareas, observaciones, adjuntos)
            VALUES (${newRdId2}, ${existente.id}, ${registroData.fecha}, ${registroData.tecnico}, ${registroData.usuarioId},
                    ${registroData.hhTrabajadas}, ${registroData.tareasEjecutadas}::text[], ${registroData.observaciones}, '[]'::jsonb)
          `;
        } catch {
          await prisma.$executeRaw`
            INSERT INTO "OtRegistroDiario" (id, "ordenTrabajoId", fecha, tecnico, "usuarioId", "hhTrabajadas", tareas, observaciones)
            VALUES (${newRdId2}, ${existente.id}, ${registroData.fecha}, ${registroData.tecnico}, ${registroData.usuarioId},
                    ${registroData.hhTrabajadas}, ${registroData.tareasEjecutadas}::text[], ${registroData.observaciones})
          `;
        }

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

    // Detectar si otJdeNumero corresponde a la OT OPEPLANT del plan de la semana.
    // Si coincide: buscar-o-crear la OT consolidada madre y registrar esta reactiva como hija oculta.
    // Si no coincide: fallback al comportamiento anterior (buscar madre por JDE).
    let parentOtId: string | null = null;
    let parentOtNum: string | null = null;
    if (otJdeNumero && !esDePlan) {
      const fechaOT = new Date(body.fecha);
      const { semana: semanaNum, anio: anioNum } = isoWeekInfo(fechaOT);

      // No se filtra por estado del plan ("borrador"/"publicado"/"cerrado"): los técnicos
      // de guardia registran avances en terreno sin esperar a que el plan esté publicado,
      // y el enganche a la OT madre no debe depender de ese paso administrativo.
      const planSemana = await prisma.programacionSemanal.findFirst({
        where: {
          semana: semanaNum,
          anio: anioNum,
          ...(areaCodigo ? { areaCodigo } : {}),
        },
        include: { otsProgramadas: { where: { esGuardia: true } } },
      });

      const esOpeplantPlan = planSemana?.otsProgramadas.some(
        o => String(o.numeroOT).toUpperCase() === String(otJdeNumero).toUpperCase()
      );

      if (esOpeplantPlan && planSemana) {
        // Buscar la OT consolidada madre de esta semana
        const estadosBloqueados = ["pendiente_revision", "revisado", "concluido"];
        let madre = await prisma.ordenTrabajo.findFirst({
          where: {
            otJdeNumero,
            origenPlan: true,
            programacionSemanalId: planSemana.id,
            NOT: { estado: "concluido" },
          },
          select: { id: true, numeroOT: true, estado: true },
        });

        if (madre && estadosBloqueados.includes(madre.estado)) {
          return NextResponse.json(
            { ok: false, error: `La OT OPEPLANT ${otJdeNumero} ya fue cerrada (${madre.estado}). Contacta al supervisor.` },
            { status: 409 }
          );
        }

        if (!madre) {
          const numMadre = await siguienteNumeroOT();
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          madre = await (prisma.ordenTrabajo.create as any)({
            data: {
              numeroOT: numMadre,
              fecha: new Date(body.fecha),
              turno: "Guardia",
              areaCodigo,
              estado: "en_proceso",
              origenPlan: true,
              programacionSemanalId: planSemana.id,
              otJdeNumero,
              historial: {
                create: [{
                  fechaHora: new Date(),
                  usuarioId: body.tecnicos?.[0]?.usuarioId || "system",
                  nombreUsuario: body.tecnicos?.[0]?.nombreCompleto || "Sistema",
                  cambio: `OT consolidada OPEPLANT ${otJdeNumero} creada — sem. ${planSemana.semana}/${planSemana.anio}`,
                }],
              },
            },
            select: { id: true, numeroOT: true, estado: true },
          });
        }

        parentOtId = madre!.id;
        parentOtNum = madre!.numeroOT;
      } else {
        // Sin match en plan — buscar madre existente por JDE (comportamiento anterior)
        const otMadre = await prisma.ordenTrabajo.findFirst({
          where: { otJdeNumero, origenPlan: true, parentOtId: null },
          select: { id: true, numeroOT: true },
        });
        if (otMadre) {
          parentOtId = otMadre.id;
          parentOtNum = otMadre.numeroOT;
        }
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
            estadoFinal: (l.estadoFinal as string | null) ?? null,
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

    // Para OTs recurrentes: registrar el primer día como avance y marcarlo "completada"
    if (body.esRecurrente && esDePlan) {
      const rdFecha = new Date(body.fecha);
      const hhPrimerDia = (body.lineas ?? []).reduce((s: number, l: Record<string, unknown>) => s + (Number(l.tiempoRealHrs) || 0), 0);
      const tareasPrimerDia: string[] = body.lineas?.[0]?.tareasEjecutadas ?? [];
      const obsPrimerDia: string | null = body.lineas?.[0]?.observaciones ?? null;
      const tecnicoPrimerDia: string = body.tecnicos?.[0]?.nombreCompleto ?? "Técnico";
      const usuarioPrimerDia: string | null = body.tecnicos?.[0]?.usuarioId ?? null;
      const newRdId = crypto.randomUUID();
      // Guardar con SQL crudo para evitar error si columna adjuntos aún no existe en DB
      try {
        await prisma.$executeRaw`
          INSERT INTO "OtRegistroDiario" (id, "ordenTrabajoId", fecha, tecnico, "usuarioId", "hhTrabajadas", tareas, observaciones, adjuntos)
          VALUES (${newRdId}, ${ot.id}, ${rdFecha}, ${tecnicoPrimerDia}, ${usuarioPrimerDia},
                  ${hhPrimerDia}, ${tareasPrimerDia}::text[], ${obsPrimerDia}, '[]'::jsonb)
        `;
      } catch {
        await prisma.$executeRaw`
          INSERT INTO "OtRegistroDiario" (id, "ordenTrabajoId", fecha, tecnico, "usuarioId", "hhTrabajadas", tareas, observaciones)
          VALUES (${newRdId}, ${ot.id}, ${rdFecha}, ${tecnicoPrimerDia}, ${usuarioPrimerDia},
                  ${hhPrimerDia}, ${tareasPrimerDia}::text[], ${obsPrimerDia})
        `;
      }
      // Marcar el día de inicio como completada
      const DIA_ABREV: Record<number, string> = { 1: "Lu", 2: "Ma", 3: "Mi", 4: "Ju", 5: "Vi", 6: "Sa", 0: "Do" };
      const diaInicio = DIA_ABREV[new Date(body.fecha + "T12:00:00").getDay()];
      if (diaInicio && body.programacionSemanalId && otJdeNumero) {
        await prisma.otProgramada.updateMany({
          where: { programacionSemanalId: body.programacionSemanalId, numeroOT: otJdeNumero, dia: diaInicio },
          data: { estado: "completada" },
        });
      }
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
