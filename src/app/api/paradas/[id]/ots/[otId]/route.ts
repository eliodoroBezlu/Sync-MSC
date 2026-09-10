import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";
import { editarOtSchema, serialize, zodError } from "@/lib/parada/validacion";

type Ctx = { params: Promise<{ id: string; otId: string }> };

// PATCH /api/paradas/[id]/ots/[otId] — edita una OT de la parada.
export async function PATCH(req: NextRequest, { params }: Ctx) {
  try {
    const { id, otId } = await params;
    const parsed = editarOtSchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json({ ok: false, error: zodError(parsed.error) }, { status: 400 });
    }
    const d = parsed.data;
    const data: Record<string, unknown> = {};
    if (d.numeroOT !== undefined) data.numeroOT = d.numeroOT;
    if (d.descripcion !== undefined) data.descripcion = d.descripcion;
    if (d.tag !== undefined) data.tag = d.tag.toUpperCase();
    if (d.descripcionEquipo !== undefined) data.descripcionEquipo = d.descripcionEquipo;
    if (d.disciplina !== undefined) data.disciplina = d.disciplina;
    if (d.fase !== undefined) data.fase = d.fase;
    if (d.hhEstimadas !== undefined) data.hhEstimadas = d.hhEstimadas;
    if (d.fechaProg !== undefined) data.fechaProg = d.fechaProg ?? null;
    if (d.fechaProgFin !== undefined) data.fechaProgFin = d.fechaProgFin ?? null;
    if (d.grupo !== undefined) {
      data.grupo = d.grupo;
      // Cambiar el turno a "Dia" descarta la cuadrilla nocturna que hubiera.
      if (d.grupo === "Dia") data.grupoNumeroNoche = null;
    }
    if (d.grupoCodigo !== undefined) data.grupoCodigo = d.grupoCodigo;
    if (d.grupoNumero !== undefined) data.grupoNumero = d.grupoNumero;
    if (d.grupoNumeroNoche !== undefined) data.grupoNumeroNoche = d.grupoNumeroNoche;
    if (d.responsable !== undefined) data.responsable = d.responsable ?? null;
    if (d.critica !== undefined) data.critica = d.critica;
    if (d.estado !== undefined) data.estado = d.estado;
    if (d.avancePct !== undefined) data.avancePct = d.avancePct;
    if (d.observaciones !== undefined) data.observaciones = d.observaciones ?? null;
    if (d.orden !== undefined) data.orden = d.orden ?? null;
    if (d.personalAsignado !== undefined) data.personalAsignado = d.personalAsignado;
    if (d.personalAsignadoIds !== undefined) data.personalAsignadoIds = d.personalAsignadoIds;

    // Vinculación por turno: `grupoNumero` aplica sólo al turno indicado. Se
    // preserva el otro turno para que la misma OT pueda estar en Grupo N (día)
    // y Grupo M (noche) a la vez. Recalcula `grupo` según los dos slots.
    if (d.turnoSlot !== undefined) {
      const actual = await prisma.paradaOt.findUnique({
        where: { id: otId, paradaId: id },
        select: { grupo: true, grupoNumero: true, grupoNumeroNoche: true },
      });
      if (!actual) {
        return NextResponse.json({ ok: false, error: "OT no encontrada" }, { status: 404 });
      }
      // Estado actual de cada slot, con compat para OTs viejas cuya cuadrilla
      // nocturna quedó guardada en `grupoNumero` (grupo === "Noche").
      let dia = actual.grupo === "Noche" ? null : actual.grupoNumero;
      let noche =
        actual.grupoNumeroNoche ?? (actual.grupo === "Noche" ? actual.grupoNumero : null);

      const nuevo = d.grupoNumero ?? null;
      if (d.turnoSlot === "Dia") dia = nuevo;
      else noche = nuevo;

      data.grupoNumero = dia;
      data.grupoNumeroNoche = noche;
      data.grupo =
        dia != null && noche != null
          ? "Ambos"
          : noche != null
            ? "Noche"
            : dia != null
              ? "Dia"
              : d.turnoSlot; // sin cuadrilla: queda en el turno de la acción
      if (dia == null && noche == null && d.grupoCodigo === undefined) {
        data.grupoCodigo = "";
      }
    }

    const ot = await prisma.paradaOt.update({
      where: { id: otId, paradaId: id },
      data,
    });
    return NextResponse.json({ ok: true, ot: serialize(ot) });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Error interno";
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}

// DELETE /api/paradas/[id]/ots/[otId]
export async function DELETE(_req: NextRequest, { params }: Ctx) {
  try {
    const { id, otId } = await params;
    await prisma.paradaOt.delete({ where: { id: otId, paradaId: id } });
    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Error interno";
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}
