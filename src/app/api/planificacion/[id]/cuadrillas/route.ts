import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";
import {
  DIAS_SEMANA,
  construirMatriz,
  cachePersonalAsignado,
  seedMembresiaDesdeAsistencia,
  type CuadrillaMiembroRow,
} from "@/lib/planificacion/cuadrillas";

type Ctx = { params: Promise<{ id: string }> };

const GRUPOS_VALIDOS = new Set(["G1", "G2", "G3", "G4", "Diurno", "Nocturno"]);
const GRUPOS_G = new Set(["G1", "G2", "G3", "G4"]);

/**
 * Sembrado inicial (una sola vez, si el plan aún no tiene ninguna fila de
 * membresía): Diurno/Nocturno se derivan día a día de la asistencia real del
 * roster; G1-G4 no tienen señal en el roster, así que se heredan de
 * personalAsignado ya guardado en las OTs existentes (backfill de planes
 * creados antes de esta funcionalidad). A partir de aquí todo edita
 * CuadrillaMiembro directamente — este sembrado nunca se repite salvo
 * import de roster (que solo toca origen="roster").
 */
async function sembrarSiVacio(planBorradorId: string) {
  const existentes = await prisma.cuadrillaMiembro.count({ where: { planBorradorId } });
  if (existentes > 0) return;

  const [roster, ots] = await Promise.all([
    prisma.rosterSemanal.findMany({ where: { planBorradorId } }),
    prisma.planBorradorOt.findMany({ where: { planBorradorId } }),
  ]);
  if (roster.length === 0 && ots.length === 0) return;

  const seeds: { planBorradorId: string; grupo: string; dia: string; tecnicoNombre: string; tecnicoUsuarioId: string | null; origen: string }[] = [];

  for (const r of roster) {
    const asistencia = Array.isArray(r.asistencia) ? (r.asistencia as string[]) : [];
    for (const s of seedMembresiaDesdeAsistencia({ nombre: r.nombre, usuarioId: r.usuarioId, asistencia })) {
      seeds.push({ planBorradorId, ...s, origen: "roster" });
    }
  }

  const rosterPorNombre = new Map(roster.map(r => [r.nombre.trim().toLowerCase(), r.usuarioId]));
  for (const ot of ots) {
    if (!GRUPOS_G.has(ot.grupo) || ot.personalAsignado.length === 0 || ot.dias.length === 0) continue;
    for (const dia of ot.dias) {
      for (const nombre of ot.personalAsignado) {
        seeds.push({
          planBorradorId,
          grupo: ot.grupo,
          dia,
          tecnicoNombre: nombre,
          tecnicoUsuarioId: rosterPorNombre.get(nombre.trim().toLowerCase()) ?? null,
          origen: "manual",
        });
      }
    }
  }

  if (seeds.length > 0) {
    await prisma.cuadrillaMiembro.createMany({ data: seeds, skipDuplicates: true });
  }
}

export async function GET(_req: NextRequest, { params }: Ctx) {
  const { id } = await params;
  try {
    await sembrarSiVacio(id);
    const miembros = await prisma.cuadrillaMiembro.findMany({ where: { planBorradorId: id } });
    return NextResponse.json({ ok: true, matriz: construirMatriz(miembros as CuadrillaMiembroRow[]) });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Error obteniendo cuadrillas";
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}

interface PatchBody {
  grupo: string;
  dias: string[];
  agregar?: { nombre: string; usuarioId?: string | null }[];
  quitar?: string[];
}

export async function PATCH(req: NextRequest, { params }: Ctx) {
  const { id } = await params;
  try {
    const body = (await req.json()) as PatchBody;

    if (!GRUPOS_VALIDOS.has(body.grupo)) {
      return NextResponse.json({ ok: false, error: "Grupo inválido" }, { status: 400 });
    }
    const dias = (body.dias ?? []).filter(d => DIAS_SEMANA.includes(d));
    if (dias.length === 0) {
      return NextResponse.json({ ok: false, error: "Se requiere al menos un día válido" }, { status: 400 });
    }

    const plan = await prisma.planBorrador.findUnique({ where: { id } });
    if (!plan) return NextResponse.json({ ok: false, error: "Plan no encontrado" }, { status: 404 });
    if (plan.estado === "publicado") {
      return NextResponse.json({ ok: false, error: "El plan ya está publicado" }, { status: 400 });
    }

    const agregar = body.agregar ?? [];
    const quitar = new Set(body.quitar ?? []);

    await prisma.$transaction(async (tx) => {
      if (quitar.size > 0) {
        await tx.cuadrillaMiembro.deleteMany({
          where: { planBorradorId: id, grupo: body.grupo, dia: { in: dias }, tecnicoNombre: { in: Array.from(quitar) } },
        });
      }
      for (const dia of dias) {
        for (const t of agregar) {
          await tx.cuadrillaMiembro.upsert({
            where: { planBorradorId_grupo_dia_tecnicoNombre: { planBorradorId: id, grupo: body.grupo, dia, tecnicoNombre: t.nombre } },
            create: { planBorradorId: id, grupo: body.grupo, dia, tecnicoNombre: t.nombre, tecnicoUsuarioId: t.usuarioId ?? null, origen: "manual" },
            update: { tecnicoUsuarioId: t.usuarioId ?? null },
          });
        }
      }

      // Recalcular el cache personalAsignado/personalAsignadoIds de las OTs
      // de este grupo cuyos días programados se vieron afectados.
      const otsAfectadas = await tx.planBorradorOt.findMany({
        where: { planBorradorId: id, grupo: body.grupo },
      });
      const miembrosActualizados = await tx.cuadrillaMiembro.findMany({
        where: { planBorradorId: id, grupo: body.grupo },
      });
      for (const ot of otsAfectadas) {
        if (!ot.dias.some(d => dias.includes(d))) continue;
        const cache = cachePersonalAsignado(ot, miembrosActualizados as CuadrillaMiembroRow[]);
        await tx.planBorradorOt.update({ where: { id: ot.id }, data: cache });
      }
    });

    const miembros = await prisma.cuadrillaMiembro.findMany({ where: { planBorradorId: id } });
    return NextResponse.json({ ok: true, matriz: construirMatriz(miembros as CuadrillaMiembroRow[]) });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Error actualizando cuadrilla";
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}
