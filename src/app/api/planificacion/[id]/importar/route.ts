import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";
import { expandirDias } from "@/lib/planificacion/expandirDias";
import * as XLSX from "xlsx";

type Ctx = { params: Promise<{ id: string }> };

interface ExcelRow {
  control?: number | string;
  numeroOT?: string;
  tipoOT?: string;
  tipoTrabajo?: string;
  prioridad?: string;
  descripcion?: string;
  tag?: string;
  descripcionEquipo?: string;
  personas?: number | string;
  hrsTrabajo?: number | string;
  fechaInicioOt?: string;
  fechaFinOt?: string;
  diasTexto?: string;
  grupo?: string;
}

export async function POST(req: NextRequest, { params }: Ctx) {
  try {
    const { id } = await params;

    const plan = await prisma.planBorrador.findUnique({ where: { id } });
    if (!plan) return NextResponse.json({ error: "Plan no encontrado" }, { status: 404 });

    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    if (!file) return NextResponse.json({ error: "Archivo requerido" }, { status: 400 });

    const buffer = Buffer.from(await file.arrayBuffer());
    const wb = XLSX.read(buffer, { type: "buffer", cellDates: true });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rawRows: ExcelRow[] = XLSX.utils.sheet_to_json(ws, { defval: "" });

    const resultados = [];
    for (const row of rawRows) {
      const numeroOT = String(row.numeroOT ?? "").trim();
      if (!numeroOT) continue;

      const personas   = Number(row.personas ?? 1) || 1;
      const hrsTrabajo = Number(row.hrsTrabajo ?? 0);
      const hhTotal    = personas * hrsTrabajo;
      const diasTexto  = String(row.diasTexto ?? "").trim();
      const dias       = expandirDias(diasTexto);

      const parseFecha = (v: unknown) => {
        if (!v) return null;
        const d = new Date(String(v));
        return isNaN(d.getTime()) ? null : d;
      };

      const count = await prisma.planBorradorOt.count({ where: { planBorradorId: id } });

      const ot = await prisma.planBorradorOt.create({
        data: {
          planBorradorId: id,
          control:          row.control ? Number(row.control) : count + 1,
          numeroOT,
          tipoOT:           String(row.tipoOT ?? "").trim().toUpperCase(),
          tipoTrabajo:      String(row.tipoTrabajo ?? "").trim(),
          prioridad:        row.prioridad ? String(row.prioridad) : null,
          descripcion:      String(row.descripcion ?? "").trim(),
          tag:              String(row.tag ?? "").trim().toUpperCase(),
          descripcionEquipo: String(row.descripcionEquipo ?? "").trim(),
          personas, hrsTrabajo, hhTotal,
          fechaInicioOt:    parseFecha(row.fechaInicioOt),
          fechaFinOt:       parseFecha(row.fechaFinOt),
          diasTexto:        diasTexto || null,
          dias,
          grupo:            String(row.grupo ?? "Diurno"),
          personalAsignado:    [],
          personalAsignadoIds: [],
          esGuardia: false,
        },
      });
      resultados.push(ot);
    }

    return NextResponse.json({ ok: true, importadas: resultados.length });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Error importando";
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}
