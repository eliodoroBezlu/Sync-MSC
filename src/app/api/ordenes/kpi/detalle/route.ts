import { NextRequest, NextResponse } from "next/server";
import { verifyToken, COOKIE_NAME } from "@/lib/auth";
import { AreaScope, resolveAreaScope } from "@/lib/kpiScope";
import {
  computeCumplimiento, computeReactivoHH, computeParetoCorrectivas, computeUtilizacionPorArea, computeTendencia,
  periodoSemana,
} from "@/lib/kpi";
import { getWeekDates, getSemanaAnioOffset, semanaActualBolivia } from "@/lib/semana";
import { TENDENCIA_SEMANAS } from "@/lib/kpiConfig";

// Detalle completo (pantalla /ordenes/indicadores): cumplimiento, reactivo,
// utilización por área, Pareto de correctivas y tendencia de N semanas.
export async function GET(req: NextRequest) {
  const token = req.cookies.get(COOKIE_NAME)?.value;
  const session = token ? verifyToken(token) : null;
  if (!session) {
    return NextResponse.json({ success: false, error: "No autenticado" }, { status: 401 });
  }

  const baseScope = resolveAreaScope(session);
  const { searchParams } = new URL(req.url);
  const semanaParam = searchParams.get("semana");
  const anioParam = searchParams.get("anio");
  const areaParam = searchParams.get("area");

  const actual = semanaActualBolivia();
  const semana = semanaParam ? Number(semanaParam) : actual.semana;
  const anio = anioParam ? Number(anioParam) : actual.anio;
  if (!Number.isFinite(semana) || !Number.isFinite(anio) || semana < 1 || semana > 53) {
    return NextResponse.json({ success: false, error: "Parámetros de semana inválidos" }, { status: 400 });
  }

  // Un área específica solo se puede pedir si cae dentro del alcance del usuario.
  let scope: AreaScope = baseScope;
  if (areaParam) {
    const permitido = baseScope.allAreas || baseScope.areas.includes(areaParam);
    if (!permitido) {
      return NextResponse.json({ success: false, error: "Área fuera de su alcance" }, { status: 403 });
    }
    scope = { allAreas: false, areas: [areaParam] };
  }

  const [lunes, , , , , , domingo] = getWeekDates(semana, anio);
  const periodo = periodoSemana(lunes, domingo);

  const semanasTendencia = Array.from({ length: TENDENCIA_SEMANAS }, (_, i) => {
    const offset = -(TENDENCIA_SEMANAS - 1 - i);
    const { semana: s, anio: a } = getSemanaAnioOffset(semana, anio, offset);
    const [ini, , , , , , fin] = getWeekDates(s, a);
    return { semana: s, anio: a, label: `S${s}`, periodo: periodoSemana(ini, fin) };
  });

  const [cumplimiento, reactivo, utilizacion, pareto, tendencia] = await Promise.all([
    computeCumplimiento(scope, periodo),
    computeReactivoHH(scope, periodo),
    computeUtilizacionPorArea(scope, periodo, semana, anio),
    computeParetoCorrectivas(scope, periodo),
    computeTendencia(scope, semanasTendencia),
  ]);

  return NextResponse.json({
    success: true,
    data: {
      semana, anio,
      fechaInicio: lunes, fechaFin: domingo,
      cumplimiento, reactivo, utilizacion,
      pareto: pareto.filas, totalCorrectivas: pareto.totalCorrectivas,
      tendencia,
      alcance: baseScope.allAreas ? { allAreas: true } : { allAreas: false, areas: baseScope.areas },
    },
  });
}
