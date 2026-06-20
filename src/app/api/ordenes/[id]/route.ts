import { prisma } from "@/lib/prisma";
import { NextRequest } from "next/server";

type Ctx = { params: Promise<{ id: string }> };

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
    createdAt: ot.createdAt,
    tecnicos: (ot.tecnicos ?? []).map(t => ({
      usuarioId: t.usuarioId ?? "",
      nombreCompleto: t.nombreCompleto,
    })),
    lineas: (ot.lineas ?? []).map(l => ({
      tag: l.tag, descripcionEquipo: l.descripcionEquipo, tipoOT: l.tipoOT,
      sintoma: l.sintoma, causaProbable: l.causaProbable, resolucionAplicada: l.resolucionAplicada,
      tiempoEstimadoHrs: l.tiempoEstimadoHrs, tiempoRealHrs: l.tiempoRealHrs,
      descripcionTrabajo: l.descripcionTrabajo, tareasEjecutadas: l.tareasEjecutadas,
      observaciones: l.observaciones,
      adjuntos: l.adjuntos ?? [],
    })),
    historialCambios: (ot.historial ?? []).map(h => ({
      fechaHora: h.fechaHora, usuarioId: h.usuarioId,
      nombreUsuario: h.nombreUsuario, cambio: h.cambio,
    })),
    registrosDiarios: (ot.registrosDiarios ?? []).map(r => ({
      _id: r.id, fecha: r.fecha, tecnico: r.tecnico, usuarioId: r.usuarioId,
      hhTrabajadas: r.hhTrabajadas, tareasEjecutadas: r.tareas, observaciones: r.observaciones,
    })),
    datosSupervision: {
      codigoModoFallaISO: ot.supCodigoModoFallaISO,
      clasificacionRCM: ot.supClasificacionRCM,
      comentariosSupervisor: ot.supComentarios,
      requierePlanificacion: ot.supRequierePlan,
      revisadoPor: ot.supRevisadoPor,
      revisadoEn: ot.supRevisadoEn,
    },
  };
}

function mapEstadoAlPlan(estado: string): string {
  switch (estado) {
    case "pendiente_revision":   return "completada";
    case "solicitar_correccion": return "en_revision";
    case "revisado":             return "completada";
    case "concluido":            return "completada";
    default:                     return "en_proceso";
  }
}

const DIA_ABREV: Record<number, string> = { 1: "Lu", 2: "Ma", 3: "Mi", 4: "Ju", 5: "Vi", 6: "Sa", 0: "Do" };
function fechaToDiaAbrev(fecha: string): string {
  return DIA_ABREV[new Date(fecha + "T12:00:00").getDay()] ?? "";
}

export async function GET(_req: NextRequest, { params }: Ctx) {
  const { id } = await params;
  const ot = await prisma.ordenTrabajo.findUnique({ where: { id }, include });
  if (!ot) return Response.json({ error: "No encontrado" }, { status: 404 });
  return Response.json(serializeOT(ot as Parameters<typeof serializeOT>[0]));
}

export async function PATCH(req: NextRequest, { params }: Ctx) {
  try {
    const { id } = await params;
    const body = await req.json();
    const { estado, datosSupervision, cambio, cambios, lineas, tecnicos, turno, registroDiario, usuarioId, nombreUsuario, otJdeNumero } = body;

    const updateData: Record<string, unknown> = {};
    if (estado) updateData.estado = estado;
    if (otJdeNumero !== undefined) updateData.otJdeNumero = otJdeNumero || null;
    if (turno) updateData.turno = turno;

    // Actualizar técnicos: delete + recreate
    if (Array.isArray(tecnicos)) {
      await prisma.otTecnico.deleteMany({ where: { ordenTrabajoId: id } });
      if (tecnicos.length > 0) {
        await prisma.otTecnico.createMany({
          data: tecnicos.map((t: { usuarioId?: string; nombreCompleto: string }) => ({
            ordenTrabajoId: id,
            usuarioId: t.usuarioId ?? null,
            nombreCompleto: t.nombreCompleto,
          })),
        });
      }
    }

    if (datosSupervision) {
      if (datosSupervision.clasificacionRCM)    updateData.supClasificacionRCM    = datosSupervision.clasificacionRCM;
      if (datosSupervision.codigoModoFallaISO)  updateData.supCodigoModoFallaISO  = datosSupervision.codigoModoFallaISO;
      if (datosSupervision.comentariosSupervisor) updateData.supComentarios        = datosSupervision.comentariosSupervisor;
      if (datosSupervision.requierePlanificacion !== undefined) updateData.supRequierePlan = datosSupervision.requierePlanificacion;
      if (estado === "revisado" || estado === "concluido") {
        updateData.supRevisadoPor = usuarioId || "supervisor";
        updateData.supRevisadoEn  = new Date();
      }
    }

    // Actualizar lineas: delete + recreate preservando adjuntos existentes
    if (lineas) {
      // Leer adjuntos actuales antes de borrar para no perderlos
      const lineasActuales = await prisma.otLinea.findMany({
        where: { ordenTrabajoId: id },
        select: { tag: true, tipoOT: true, adjuntos: true },
      });
      const adjuntosMap = new Map(
        lineasActuales.map(l => [`${l.tag.toUpperCase()}::${l.tipoOT}`, l.adjuntos])
      );

      await prisma.otLinea.deleteMany({ where: { ordenTrabajoId: id } });
      await prisma.otLinea.createMany({
        data: lineas.map((l: Record<string, unknown>) => {
          const key = `${String(l.tag).toUpperCase()}::${String(l.tipoOT)}`;
          // Preferir adjuntos del payload (si el cliente los envía), sino recuperar los existentes en BD
          const adjuntos = Array.isArray(l.adjuntos) && (l.adjuntos as unknown[]).length > 0
            ? l.adjuntos
            : (adjuntosMap.get(key) ?? []);
          return {
            ordenTrabajoId: id,
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
            adjuntos,
          };
        }),
      });
    }

    // Agregar avance diario — upsert por fecha+usuario para evitar duplicados
    if (registroDiario) {
      const rdUsuarioId = registroDiario.usuarioId ?? usuarioId ?? null;
      const rdFecha = new Date(registroDiario.fecha);
      // Buscar si ya existe un registro del mismo día y técnico
      const existing = await prisma.otRegistroDiario.findFirst({
        where: {
          ordenTrabajoId: id,
          fecha: rdFecha,
          ...(rdUsuarioId ? { usuarioId: rdUsuarioId } : { tecnico: registroDiario.tecnico }),
        },
      });
      if (existing) {
        await prisma.otRegistroDiario.update({
          where: { id: existing.id },
          data: {
            hhTrabajadas: registroDiario.hhTrabajadas,
            tareas: registroDiario.tareasEjecutadas ?? [],
            observaciones: registroDiario.observaciones ?? null,
          },
        });
      } else {
        await prisma.otRegistroDiario.create({
          data: {
            ordenTrabajoId: id,
            fecha: rdFecha,
            tecnico: registroDiario.tecnico,
            usuarioId: rdUsuarioId,
            hhTrabajadas: registroDiario.hhTrabajadas,
            tareas: registroDiario.tareasEjecutadas ?? [],
            observaciones: registroDiario.observaciones ?? null,
          },
        });
      }
      // Marcar solo el día trabajado como completada en el plan
      const diaAvance = fechaToDiaAbrev(registroDiario.fecha);
      if (diaAvance) {
        await prisma.otProgramada.updateMany({
          where: { ordenTrabajoId: id, dia: diaAvance },
          data: { estado: "completada" },
        });
      }
    }

    // Historial
    const mensajes: string[] = Array.isArray(cambios) ? cambios : cambio ? [cambio] : [];
    if (mensajes.length > 0) {
      await prisma.otHistorial.createMany({
        data: mensajes.map(msg => ({
          ordenTrabajoId: id,
          fechaHora: new Date(),
          usuarioId: usuarioId || "system",
          nombreUsuario: nombreUsuario || "Sistema",
          cambio: msg,
        })),
      });
    }

    const ot = await prisma.ordenTrabajo.update({
      where: { id },
      data: updateData,
      include,
    });

    // Propagar al plan semanal
    if (estado) {
      const estadoPlan = mapEstadoAlPlan(estado);
      // Contar cuántos días del plan están vinculados a esta OT
      const diasVinculados = await prisma.otProgramada.count({ where: { ordenTrabajoId: ot.id } });
      const esRecurrente = diasVinculados > 1;

      if (esRecurrente) {
        // OT recurrente: solo actualiza el día de inicio; los otros días se marcan vía avance diario
        if (ot.otJdeDia) {
          await prisma.otProgramada.updateMany({
            where: { ordenTrabajoId: ot.id, dia: ot.otJdeDia },
            data: { estado: estadoPlan },
          });
        }
      } else {
        // OT normal: actualiza todos los registros vinculados (suele ser solo uno)
        await prisma.otProgramada.updateMany({
          where: { ordenTrabajoId: ot.id },
          data: { estado: estadoPlan },
        });
        // Fallback por programacionSemanalId si falta el vínculo directo
        if (ot.origenPlan && ot.programacionSemanalId && ot.otJdeNumero) {
          await prisma.otProgramada.updateMany({
            where: {
              programacionSemanalId: ot.programacionSemanalId,
              numeroOT: ot.otJdeNumero,
              dia: ot.otJdeDia ?? undefined,
            },
            data: { estado: estadoPlan },
          });
        }
      }
    }

    return Response.json({ ok: true, ot: serializeOT(ot as Parameters<typeof serializeOT>[0]) });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Error interno";
    return Response.json({ ok: false, error: message }, { status: 400 });
  }
}

export async function DELETE(_req: NextRequest, { params }: Ctx) {
  const { id } = await params;
  try {
    await prisma.otHistorial.deleteMany({ where: { ordenTrabajoId: id } });
    await prisma.otTecnico.deleteMany({ where: { ordenTrabajoId: id } });
    await prisma.otLinea.deleteMany({ where: { ordenTrabajoId: id } });
    await prisma.otRegistroDiario.deleteMany({ where: { ordenTrabajoId: id } });
    await prisma.ordenTrabajo.delete({ where: { id } });
    return Response.json({ ok: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Error interno";
    return Response.json({ ok: false, error: message }, { status: 400 });
  }
}

