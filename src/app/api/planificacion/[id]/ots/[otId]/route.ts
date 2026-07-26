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
    if ("grupoPorDia" in body) {
      const v = body.grupoPorDia;
      const esMapaValido = v && typeof v === "object" && !Array.isArray(v)
        && Object.values(v).every(x => typeof x === "string" && x.length > 0);
      data.grupoPorDia = v === null ? null : esMapaValido ? v : undefined;
      if (data.grupoPorDia === undefined) delete data.grupoPorDia;
      else data.grupoManual = true;
    }
    // personalAsignadoIds no se acepta directo: se resuelve siempre a partir
    // de CuadrillaMiembro más abajo. personalAsignado sí se acepta (drag&drop
    // manual desde el Tablero) pero queda sujeto a reconciliación contra la
    // cuadrilla vigente del grupo/día — un nombre que no es miembro de la
    // cuadrilla de ese grupo en ninguno de los días de la OT no persiste.
    if ("personalAsignado" in body) data.personalAsignado = body.personalAsignado;
    if ("diasTexto"     in body) {
      data.diasTexto = body.diasTexto;
      data.dias      = body.dias?.length ? body.dias : expandirDias(body.diasTexto ?? "");
    }
    if ("dias" in body) data.dias = body.dias;
    if ("personas" in body || "hrsTrabajo" in body) {
      const ot = await prisma.planBorradorOt.findUnique({ where: { id: otId } });
      if (!ot) return NextResponse.json({ error: "OT no encontrada" }, { status: 404 });
      const personas   = Number(body.personas   ?? ot.personas);
      const hrsTrabajo = Number(body.hrsTrabajo ?? ot.hrsTrabajo);
      data.personas   = personas;
      data.hrsTrabajo = hrsTrabajo;
      // hhTotal es el HH ESTIMADA de la semana completa (viene del Excel JDE
      // al importar), no el producto de un solo día — el formulario de
      // edición del Tablero reenvía personas/hrsTrabajo en cada guardado
      // aunque el usuario solo haya tocado otro campo (Días, Fechas), así que
      // solo se recalcula si esos valores realmente cambiaron. Y si cambian,
      // se multiplica por la cantidad de días programados: de lo contrario
      // una OT multi-día (ej. 68HH en 7 días) colapsaba a personas×hrsTrabajo
      // de un único día (10HH) con cualquier edición, sin que el usuario
      // tocara Personas ni Hrs/día.
      if (personas !== ot.personas || hrsTrabajo !== ot.hrsTrabajo) {
        const dias = (data.dias as string[] | undefined) ?? ot.dias;
        const numDias = Math.max(1, dias?.length ?? 1);
        data.hhTotal = personas * hrsTrabajo * numDias;
      }
    }
    if ("hhTotal" in body && !("personas" in body) && !("hrsTrabajo" in body)) {
      data.hhTotal = Number(body.hhTotal);
    }
    if ("fechaInicioOt" in body) data.fechaInicioOt = body.fechaInicioOt ? new Date(body.fechaInicioOt) : null;
    if ("fechaFinOt"    in body) data.fechaFinOt    = body.fechaFinOt    ? new Date(body.fechaFinOt)    : null;
    if ("hhPorDiaManual" in body) {
      const v = body.hhPorDiaManual;
      const esMapaValido = v && typeof v === "object" && !Array.isArray(v)
        && Object.values(v).every(x => typeof x === "number" && Number.isFinite(x) && x >= 0);
      data.hhPorDiaManual = v === null ? null : esMapaValido ? v : undefined;
      if (data.hhPorDiaManual === undefined) delete data.hhPorDiaManual;
    }

    let ot = await prisma.planBorradorOt.update({ where: { id: otId }, data });

    // Grupo/días/grupoPorDia/personalAsignado cambiaron: reconciliar contra la
    // cuadrilla vigente (filtra nombres que ya no son miembros del grupo
    // efectivo de cada día — nunca agrega miembros nuevos que el usuario no
    // pidió, ver cachePersonalAsignado). Se trae la cuadrilla completa del
    // plan (no solo ot.grupo) porque, con grupoPorDia, la OT puede tocar más
    // de un grupo a la vez.
    if ("grupo" in data || "dias" in data || "grupoPorDia" in data || "personalAsignado" in data) {
      const miembros = await prisma.cuadrillaMiembro.findMany({
        where: { planBorradorId: id },
      });
      const cache = cachePersonalAsignado(
        { ...ot, grupoPorDia: ot.grupoPorDia as Record<string, string> | null },
        miembros as CuadrillaMiembroRow[]
      );
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
