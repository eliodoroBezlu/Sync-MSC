import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";
import {
  CODIGOS_ASISTENCIA,
  calcularGrupo,
  seedMembresiaDesdeAsistencia,
  cachePersonalAsignado,
  type CuadrillaMiembroRow,
} from "@/lib/planificacion/cuadrillas";

type Ctx = { params: Promise<{ id: string; rosterId: string }> };

const CODIGOS_VALIDOS = new Set<string>(CODIGOS_ASISTENCIA);

interface PatchBody {
  indice: number;
  codigo: string;
}

export async function PATCH(req: NextRequest, { params }: Ctx) {
  try {
    const { id, rosterId } = await params;
    const body = (await req.json()) as PatchBody;

    const indice = Number(body.indice);
    const codigo = String(body.codigo ?? "").trim().toUpperCase();
    if (!Number.isInteger(indice) || indice < 0 || indice > 6) {
      return NextResponse.json({ ok: false, error: "Día inválido" }, { status: 400 });
    }
    if (!CODIGOS_VALIDOS.has(codigo)) {
      return NextResponse.json({ ok: false, error: "Código inválido" }, { status: 400 });
    }

    const plan = await prisma.planBorrador.findUnique({ where: { id } });
    if (!plan) return NextResponse.json({ ok: false, error: "Plan no encontrado" }, { status: 404 });
    if (plan.estado === "publicado") {
      return NextResponse.json({ ok: false, error: "No se puede editar un plan publicado" }, { status: 400 });
    }

    const roster = await prisma.rosterSemanal.findUnique({ where: { id: rosterId } });
    if (!roster || roster.planBorradorId !== id) {
      return NextResponse.json({ ok: false, error: "Técnico no encontrado en este plan" }, { status: 404 });
    }

    const asistenciaActual = Array.isArray(roster.asistencia) ? (roster.asistencia as string[]) : [];
    const asistenciaNueva = [...asistenciaActual];
    while (asistenciaNueva.length < 7) asistenciaNueva.push("");
    asistenciaNueva[indice] = codigo;

    const grupoNuevo = calcularGrupo(asistenciaNueva);

    await prisma.rosterSemanal.update({
      where: { id: rosterId },
      data: {
        asistencia: asistenciaNueva as unknown as import("@prisma/client").Prisma.InputJsonValue,
        grupo: grupoNuevo,
      },
    });

    // Resembrar membresía Diurno/Nocturno de ESTE técnico desde su asistencia
    // corregida — mismo patrón que la importación masiva: solo se tocan filas
    // origen="roster" (las curadas a mano en G1-G4 se preservan).
    await prisma.cuadrillaMiembro.deleteMany({
      where: {
        planBorradorId: id,
        grupo: { in: ["Diurno", "Nocturno"] },
        origen: "roster",
        tecnicoNombre: roster.nombre,
      },
    });
    const seeds = seedMembresiaDesdeAsistencia({
      nombre: roster.nombre,
      usuarioId: roster.usuarioId,
      asistencia: asistenciaNueva,
    });
    if (seeds.length > 0) {
      await prisma.cuadrillaMiembro.createMany({
        data: seeds.map(s => ({ planBorradorId: id, ...s, origen: "roster" })),
        skipDuplicates: true,
      });
    }

    // Reconciliar el cache personalAsignado de las OTs Diurno/Nocturno: este
    // técnico pudo dejar de cubrir un día que antes cubría, o al revés.
    const otsAfectadas = await prisma.planBorradorOt.findMany({
      where: { planBorradorId: id, grupo: { in: ["Diurno", "Nocturno"] } },
    });
    if (otsAfectadas.length > 0) {
      const miembrosVigentes = await prisma.cuadrillaMiembro.findMany({
        where: { planBorradorId: id, grupo: { in: ["Diurno", "Nocturno"] } },
      });
      for (const ot of otsAfectadas) {
        const propios = miembrosVigentes.filter(m => m.grupo === ot.grupo) as CuadrillaMiembroRow[];
        const cache = cachePersonalAsignado(ot, propios);
        if (
          cache.personalAsignado.length !== ot.personalAsignado.length ||
          cache.personalAsignado.some(n => !ot.personalAsignado.includes(n))
        ) {
          await prisma.planBorradorOt.update({ where: { id: ot.id }, data: cache });
        }
      }
    }

    return NextResponse.json({ ok: true, asistencia: asistenciaNueva, grupo: grupoNuevo });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Error actualizando asistencia";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

// Quita un contratista del roster de la semana. Restringido a filas
// esContratista=true: el personal de planta se administra únicamente vía
// re-importación del Excel, nunca por borrado manual desde aquí.
export async function DELETE(_req: NextRequest, { params }: Ctx) {
  try {
    const { id, rosterId } = await params;

    const plan = await prisma.planBorrador.findUnique({ where: { id } });
    if (!plan) return NextResponse.json({ ok: false, error: "Plan no encontrado" }, { status: 404 });
    if (plan.estado === "publicado") {
      return NextResponse.json({ ok: false, error: "No se puede editar un plan publicado" }, { status: 400 });
    }

    const roster = await prisma.rosterSemanal.findUnique({ where: { id: rosterId } });
    if (!roster || roster.planBorradorId !== id) {
      return NextResponse.json({ ok: false, error: "Técnico no encontrado en este plan" }, { status: 404 });
    }
    if (!roster.esContratista) {
      return NextResponse.json(
        { ok: false, error: "Solo se pueden quitar contratistas; el personal de planta se administra por importación" },
        { status: 400 }
      );
    }

    await prisma.rosterSemanal.delete({ where: { id: rosterId } });

    await prisma.cuadrillaMiembro.deleteMany({
      where: { planBorradorId: id, tecnicoNombre: roster.nombre },
    });

    const otsAfectadas = await prisma.planBorradorOt.findMany({
      where: { planBorradorId: id, personalAsignado: { has: roster.nombre } },
    });
    for (const ot of otsAfectadas) {
      await prisma.planBorradorOt.update({
        where: { id: ot.id },
        data: {
          personalAsignado: ot.personalAsignado.filter(n => n !== roster.nombre),
          personalAsignadoIds: roster.usuarioId
            ? ot.personalAsignadoIds.filter(uid => uid !== roster.usuarioId)
            : ot.personalAsignadoIds,
        },
      });
    }

    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Error quitando del roster";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
