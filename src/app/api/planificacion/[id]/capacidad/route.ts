import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";
import { DIAS_SEMANA } from "@/lib/planificacion/cuadrillas";
import type { CapacidadOverride } from "@/lib/planificacion/capacidad";

type Ctx = { params: Promise<{ id: string }> };

const GRUPOS_VALIDOS = new Set(["G1", "G2", "G3", "G4", "Diurno", "Nocturno"]);

interface PatchBody {
  grupo: string;
  dia: string;
  horas: number | null; // null = volver a cálculo automático
}

// Fija (o limpia) el override manual de horas-hombre disponibles de un
// grupo en un día puntual. Ausente en capacidadOverride = automático
// (headcount de CuadrillaMiembro x 10 hrs/día), ver src/lib/planificacion/capacidad.ts.
export async function PATCH(req: NextRequest, { params }: Ctx) {
  const { id } = await params;
  try {
    const body = (await req.json()) as PatchBody;

    if (!GRUPOS_VALIDOS.has(body.grupo)) {
      return NextResponse.json({ ok: false, error: "Grupo inválido" }, { status: 400 });
    }
    if (!DIAS_SEMANA.includes(body.dia)) {
      return NextResponse.json({ ok: false, error: "Día inválido" }, { status: 400 });
    }
    if (body.horas != null && (!Number.isFinite(body.horas) || body.horas < 0)) {
      return NextResponse.json({ ok: false, error: "Horas inválidas" }, { status: 400 });
    }

    const plan = await prisma.planBorrador.findUnique({ where: { id } });
    if (!plan) return NextResponse.json({ ok: false, error: "Plan no encontrado" }, { status: 404 });
    if (plan.estado === "publicado") {
      return NextResponse.json({ ok: false, error: "El plan ya está publicado" }, { status: 400 });
    }

    const actual = (plan.capacidadOverride as CapacidadOverride | null) ?? {};
    const grupoActual = { ...(actual[body.grupo] ?? {}) };
    if (body.horas == null) {
      delete grupoActual[body.dia];
    } else {
      grupoActual[body.dia] = body.horas;
    }
    const siguiente: CapacidadOverride = { ...actual, [body.grupo]: grupoActual };
    if (Object.keys(grupoActual).length === 0) delete siguiente[body.grupo];

    const actualizado = await prisma.planBorrador.update({
      where: { id },
      data: { capacidadOverride: siguiente },
    });

    return NextResponse.json({ ok: true, capacidadOverride: actualizado.capacidadOverride });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Error actualizando capacidad";
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}
