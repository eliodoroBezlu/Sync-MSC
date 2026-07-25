import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";
import { expandirDias } from "@/lib/planificacion/expandirDias";
import { cachePersonalAsignado, type CuadrillaMiembroRow } from "@/lib/planificacion/cuadrillas";

type Ctx = { params: Promise<{ id: string; otId: string }> };

export async function PATCH(req: NextRequest, { params }: Ctx) {
  try {
    const { id, otId } = await params;
    const body = await req.json();

    const data: Record<string, unknown> = {};

    const campos = [
      "numeroOT", "tipoOT", "tipoTrabajo", "prioridad", "descripcion",
      "tag", "descripcionEquipo", "grupo", "esGuardia",
      "seleccionada", "motivoNoProgramada", "comentarioNoProgramada",
    ];
    for (const c of campos) {
      if (c in body) data[c] = body[c];
    }
    // Un cambio de grupo hecho a mano (formulario de edición) queda fijo:
    // Balancear ya no lo va a recalcular, ver balancear/route.ts.
    if ("grupo" in body) data.grupoManual = true;
    // personalAsignadoIds no se acepta directo: se resuelve siempre a partir
    // de CuadrillaMiembro más abajo. personalAsignado sí se acepta (drag&drop
    // manual desde el Tablero) pero queda sujeto a reconciliación contra la
    // cuadrilla vigente del grupo/día — un nombre que no es miembro de la
    // cuadrilla de ese grupo en ninguno de los días de la OT no persiste.
    if ("personalAsignado" in body) data.personalAsignado = body.personalAsignado;
    if ("personas" in body || "hrsTrabajo" in body) {
      const ot = await prisma.planBorradorOt.findUnique({ where: { id: otId } });
      if (!ot) return NextResponse.json({ error: "OT no encontrada" }, { status: 404 });
      const personas   = Number(body.personas   ?? ot.personas);
      const hrsTrabajo = Number(body.hrsTrabajo ?? ot.hrsTrabajo);
      data.personas   = personas;
      data.hrsTrabajo = hrsTrabajo;
      data.hhTotal    = personas * hrsTrabajo;
    }
    if ("hhTotal" in body && !("personas" in body) && !("hrsTrabajo" in body)) {
      data.hhTotal = Number(body.hhTotal);
    }
    if ("fechaInicioOt" in body) data.fechaInicioOt = body.fechaInicioOt ? new Date(body.fechaInicioOt) : null;
    if ("fechaFinOt"    in body) data.fechaFinOt    = body.fechaFinOt    ? new Date(body.fechaFinOt)    : null;
    if ("diasTexto"     in body) {
      data.diasTexto = body.diasTexto;
      data.dias      = body.dias?.length ? body.dias : expandirDias(body.diasTexto ?? "");
    }
    if ("dias" in body) data.dias = body.dias;

    let ot = await prisma.planBorradorOt.update({ where: { id: otId }, data });

    // Grupo/días/personalAsignado cambiaron: reconciliar contra la cuadrilla
    // vigente (filtra nombres que ya no son miembros del grupo/día — nunca
    // agrega miembros nuevos que el usuario no pidió, ver cachePersonalAsignado).
    if ("grupo" in data || "dias" in data || "personalAsignado" in data) {
      const miembros = await prisma.cuadrillaMiembro.findMany({
        where: { planBorradorId: id, grupo: ot.grupo },
      });
      const cache = cachePersonalAsignado(ot, miembros as CuadrillaMiembroRow[]);
      ot = await prisma.planBorradorOt.update({ where: { id: otId }, data: cache });
    }

    return NextResponse.json({ ok: true, ot: { ...ot, _id: ot.id } });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Error interno";
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}

export async function DELETE(_req: NextRequest, { params }: Ctx) {
  const { otId } = await params;
  try {
    await prisma.planBorradorOt.delete({ where: { id: otId } });
    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Error interno";
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}
