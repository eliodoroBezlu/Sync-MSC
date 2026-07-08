import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";
import { checkOpeplant } from "@/lib/opeplant";

// Fuente única de verdad para el formulario: dado un N° OT + área + fecha,
// dice si pertenece al plan semanal OPEPLANT (turnero) ANTES de que exista
// ninguna OrdenTrabajo creada. Usa la misma checkOpeplant() que el POST de
// creación, para que el formulario y el backend nunca clasifiquen distinto.
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const otJdeNumero = searchParams.get("otJdeNumero");
  const areaCodigo = searchParams.get("areaCodigo");
  const fecha = searchParams.get("fecha");

  if (!otJdeNumero || !areaCodigo || !fecha) {
    return NextResponse.json({ esOpeplantPlan: false, madre: null });
  }

  const { esOpeplantPlan, planSemana } = await checkOpeplant(otJdeNumero, areaCodigo, new Date(fecha));
  if (!esOpeplantPlan || !planSemana) {
    return NextResponse.json({ esOpeplantPlan: false, madre: null });
  }

  const madre = await prisma.ordenTrabajo.findFirst({
    where: { otJdeNumero, origenPlan: true, programacionSemanalId: planSemana.id, NOT: { estado: "concluido" } },
    select: { id: true, numeroOT: true, estado: true },
  });

  return NextResponse.json({
    esOpeplantPlan: true,
    madre: madre ? { id: madre.id, numeroOT: madre.numeroOT, estado: madre.estado } : null,
  });
}
