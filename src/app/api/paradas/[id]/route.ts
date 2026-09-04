import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";
import { editarParadaSchema, serialize, zodError } from "@/lib/parada/validacion";

type Ctx = { params: Promise<{ id: string }> };

// GET /api/paradas/[id] — detalle con OTs, grupos y reportes.
export async function GET(_req: NextRequest, { params }: Ctx) {
  try {
    const { id } = await params;
    const parada = await prisma.parada.findUnique({
      where: { id },
      include: {
        ots: { orderBy: [{ orden: "asc" }, { numeroOT: "asc" }] },
        grupos: {
          orderBy: [{ turno: "asc" }, { disciplina: "asc" }, { numero: "asc" }],
          include: { miembros: { orderBy: { nombre: "asc" } } },
        },
        reportesDiarios: { orderBy: [{ fecha: "desc" }, { reunion: "desc" }] },
      },
    });
    if (!parada) return NextResponse.json({ error: "No encontrado" }, { status: 404 });
    return NextResponse.json(serialize(parada));
  } catch (err: unknown) {
    // Se deja el detalle en el log del servidor (visible en Railway) para poder
    // diagnosticar sin exponer internals al cliente.
    console.error("GET /api/paradas/[id] falló:", err);
    const message = err instanceof Error ? err.message : "Error interno";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// PATCH /api/paradas/[id] — edita encabezado / estado.
export async function PATCH(req: NextRequest, { params }: Ctx) {
  try {
    const { id } = await params;
    const parsed = editarParadaSchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json({ ok: false, error: zodError(parsed.error) }, { status: 400 });
    }
    const d = parsed.data;
    const data: Record<string, unknown> = {};
    if (d.nombre !== undefined) data.nombre = d.nombre;
    if (d.planta !== undefined) data.planta = d.planta ?? null;
    if (d.fechaPreparativosInicio !== undefined) data.fechaPreparativosInicio = d.fechaPreparativosInicio;
    if (d.fechaEjecucionInicio !== undefined) data.fechaEjecucionInicio = d.fechaEjecucionInicio;
    if (d.fechaEjecucionFin !== undefined) data.fechaEjecucionFin = d.fechaEjecucionFin;
    if (d.estado !== undefined) data.estado = d.estado;
    if (d.fechaCierre !== undefined) data.fechaCierre = d.fechaCierre ?? null;
    if (d.leccionesAprendidas !== undefined) data.leccionesAprendidas = d.leccionesAprendidas ?? null;
    if (d.observacionesCierre !== undefined) data.observacionesCierre = d.observacionesCierre ?? null;

    const parada = await prisma.parada.update({ where: { id }, data });
    return NextResponse.json({ ok: true, parada: serialize(parada) });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Error interno";
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}

// DELETE /api/paradas/[id] — borra la parada (cascade a OTs/grupos/avances/reportes).
export async function DELETE(_req: NextRequest, { params }: Ctx) {
  try {
    const { id } = await params;
    await prisma.parada.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Error interno";
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}
