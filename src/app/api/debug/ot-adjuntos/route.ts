import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

// Endpoint temporal de diagnóstico — muestra adjuntos de todas las OTs con un otJdeNumero dado
export async function GET(req: NextRequest) {
  const otJdeNumero = new URL(req.url).searchParams.get("otJdeNumero");
  if (!otJdeNumero) return NextResponse.json({ error: "Falta otJdeNumero" }, { status: 400 });

  const ots = await prisma.ordenTrabajo.findMany({
    where: { otJdeNumero },
    include: { lineas: true },
    orderBy: { fecha: "asc" },
  });

  const result = ots.map(ot => ({
    id: ot.id,
    numeroOT: ot.numeroOT,
    fecha: ot.fecha,
    estado: ot.estado,
    origenPlan: ot.origenPlan,
    programacionSemanalId: ot.programacionSemanalId,
    otJdeDia: ot.otJdeDia,
    lineas: ot.lineas.map(l => {
      const adjs = Array.isArray(l.adjuntos) ? l.adjuntos as { tipo?: string; nombre?: string; dataUrl?: string }[] : [];
      return {
        tag: l.tag,
        tipoOT: l.tipoOT,
        adjuntosCount: adjs.length,
        adjuntos: adjs.map(a => ({
          tipo: a.tipo,
          nombre: a.nombre,
          dataUrlPreview: typeof a.dataUrl === "string" ? a.dataUrl.slice(0, 50) + "…" : null,
        })),
      };
    }),
  }));

  return NextResponse.json({ otJdeNumero, total: ots.length, ots: result });
}
