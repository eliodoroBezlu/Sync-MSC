import { NextRequest, NextResponse } from "next/server";
import { verifyToken, COOKIE_NAME } from "@/lib/auth";
import { resolveAreaScope } from "@/lib/kpiScope";
import { computeCumplimiento, computeReactivoHH, computeParetoCorrectivas, periodoDia, periodoSemana } from "@/lib/kpi";
import { semanaActualBolivia } from "@/lib/semana";

// Resumen de KPIs para la franja compacta de /ordenes — 4 tarjetas semáforo.
// Acotado server-side por rol/área de la sesión (ver resolveAreaScope).
export async function GET(req: NextRequest) {
  const token = req.cookies.get(COOKIE_NAME)?.value;
  const session = token ? verifyToken(token) : null;
  if (!session) {
    return NextResponse.json({ success: false, error: "No autenticado" }, { status: 401 });
  }

  const scope = resolveAreaScope(session);
  const { semana, anio, fechaInicio, fechaFin } = semanaActualBolivia();
  const periodoSemanaActual = periodoSemana(fechaInicio, fechaFin);
  const periodoHoy = periodoDia(new Date());

  const [cumplimiento, reactivoHoy, reactivoSemana, pareto] = await Promise.all([
    computeCumplimiento(scope, periodoSemanaActual),
    computeReactivoHH(scope, periodoHoy),
    computeReactivoHH(scope, periodoSemanaActual),
    computeParetoCorrectivas(scope, periodoSemanaActual, 1),
  ]);

  return NextResponse.json({
    success: true,
    data: {
      semana,
      anio,
      cumplimientoSemana: cumplimiento,
      reactivoHoy,
      reactivoSemana,
      correctivasNoProgramadasSemana: pareto.totalCorrectivas,
    },
  });
}
