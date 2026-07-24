import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";
import { expandirDias } from "@/lib/planificacion/expandirDias";
import * as XLSX from "xlsx";

type Ctx = { params: Promise<{ id: string }> };

// Layout real de la hoja "PROGRAMA" (base de datos JDE que mantienen los
// planificadores): A Estado JDE | B Estado(detalle) | C No OT | D Tipo OT |
// E Tipo Trabajo | F Prioridad | G Job Description | H Equipo |
// I Descripción de Equipo | J N° personas | K Hr Trabajo | L HH Estimada |
// M Fecha inicio | N Fecha final | O Dias | P Semana | Q Solicitante |
// R Observaciones.
const COL = {
  estadoJDE: 0, estadoDetalle: 1, numeroOT: 2, tipoOT: 3, tipoTrabajo: 4,
  prioridad: 5, descripcion: 6, tag: 7, descripcionEquipo: 8, personas: 9,
  hrsTrabajo: 10, hhEstimada: 11, fechaInicio: 12, fechaFin: 13, dias: 14,
  semana: 15, solicitante: 16, observaciones: 17,
} as const;

function parseFecha(v: unknown): Date | null {
  if (!v && v !== 0) return null;
  if (v instanceof Date) return isNaN(v.getTime()) ? null : v;
  const d = new Date(String(v));
  return isNaN(d.getTime()) ? null : d;
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
    const hojaNombre = String(formData.get("hoja") ?? "") || wb.SheetNames.find(n => n.toUpperCase() === "PROGRAMA") || wb.SheetNames[0];
    const ws = wb.Sheets[hojaNombre];
    if (!ws) return NextResponse.json({ error: `Hoja "${hojaNombre}" no encontrada` }, { status: 400 });

    const rows: unknown[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });

    let vistasSemana = 0;
    const resultados = [];
    const count0 = await prisma.planBorradorOt.count({ where: { planBorradorId: id } });
    let siguienteControl = count0 + 1;

    for (const row of rows) {
      const numeroOT = String(row[COL.numeroOT] ?? "").trim();
      const tipoOT = String(row[COL.tipoOT] ?? "").trim();
      if (!numeroOT || !/^\d+$/.test(numeroOT) || !tipoOT) continue;

      const semanaFila = Number(row[COL.semana]);
      if (!semanaFila) continue;
      vistasSemana += 1;
      if (semanaFila !== plan.semana) continue;

      const personas = Number(row[COL.personas]) || 1;
      const hrsTrabajo = Number(row[COL.hrsTrabajo]) || 0;
      const hhTotal = Number(row[COL.hhEstimada]) || personas * hrsTrabajo;
      const diasTexto = String(row[COL.dias] ?? "").trim();
      const dias = expandirDias(diasTexto);

      const ot = await prisma.planBorradorOt.create({
        data: {
          planBorradorId: id,
          control: siguienteControl++,
          numeroOT,
          tipoOT: tipoOT.toUpperCase(),
          tipoTrabajo: String(row[COL.tipoTrabajo] ?? "").trim(),
          prioridad: String(row[COL.prioridad] ?? "").trim() || null,
          descripcion: String(row[COL.descripcion] ?? "").trim() || `OT ${numeroOT}`,
          tag: String(row[COL.tag] ?? "").trim().toUpperCase(),
          descripcionEquipo: String(row[COL.descripcionEquipo] ?? "").trim(),
          personas, hrsTrabajo, hhTotal,
          fechaInicioOt: parseFecha(row[COL.fechaInicio]),
          fechaFinOt: parseFecha(row[COL.fechaFin]),
          diasTexto: diasTexto || null,
          dias,
          grupo: "Diurno",
          estadoJDE: String(row[COL.estadoJDE] ?? "").trim() || null,
          estadoDetalle: String(row[COL.estadoDetalle] ?? "").trim() || null,
          solicitante: String(row[COL.solicitante] ?? "").trim() || null,
          observaciones: String(row[COL.observaciones] ?? "").trim() || null,
          personalAsignado: [],
          personalAsignadoIds: [],
          esGuardia: false,
        },
      });
      resultados.push(ot);
    }

    if (vistasSemana > 0 && resultados.length === 0) {
      return NextResponse.json({
        ok: false,
        error: `La hoja tiene OTs pero ninguna de la semana ${plan.semana} (se vieron ${vistasSemana} filas con semana asignada, ninguna coincide).`,
      }, { status: 400 });
    }

    return NextResponse.json({ ok: true, importadas: resultados.length });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Error importando";
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}
