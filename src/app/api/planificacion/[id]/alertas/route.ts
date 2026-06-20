import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Ctx) {
  const { id } = await params;

  const alertas = await prisma.planConstraintAlert.findMany({
    where: { planBorradorId: id, resuelto: false },
    orderBy: [{ severidad: "asc" }, { createdAt: "desc" }],
  });

  return NextResponse.json(alertas);
}

export async function PATCH(req: NextRequest, { params }: Ctx) {
  const { id } = await params;
  const body = await req.json();
  const { alertId, resuelto } = body;

  if (!alertId) {
    return NextResponse.json({ error: "alertId requerido" }, { status: 400 });
  }

  await prisma.planConstraintAlert.update({
    where: { id: alertId },
    data: { resuelto: resuelto ?? true },
  });

  return NextResponse.json({ ok: true });
}
