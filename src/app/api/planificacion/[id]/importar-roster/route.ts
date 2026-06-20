import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";
import * as XLSX from "xlsx";

type Ctx = { params: Promise<{ id: string }> };

// Códigos de turno del roster E&I 2026
const TURNO_CODIGO: Record<string, string> = {
  D: "D",   // Turno Día
  N: "N",   // Turno Noche
  T: "L",   // Libre / descanso (en el Excel usa "T")
  V: "V",   // Vacaciones
  CS: "CS", // Comisión de Servicio
  L: "L",   // Libre (alternativo)
  "": "",
};

function normalizarCodigo(v: unknown): string {
  const s = String(v ?? "").trim().toUpperCase();
  return TURNO_CODIGO[s] ?? s;
}

function calcularGrupo(asistencia: string[]): string {
  // Determinar D o N en base a mayoría de días trabajados
  const dias = asistencia.filter(a => a === "D" || a === "N");
  if (dias.length === 0) return "Diurno";
  const nocturno = dias.filter(a => a === "N").length;
  return nocturno > dias.length / 2 ? "Nocturno" : "Diurno";
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
    const wb = XLSX.read(buffer, { type: "buffer" });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows: unknown[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });

    // El roster 2026 empieza en fila 741 (índice 740)
    // Detectar la sección relevante: buscar "NOMBRE" en col 3 después de la fila 740
    const INICIO = 740;
    const personas: Array<{
      nombre: string; disciplina: string; asistencia: string[]; diasNumericos: number[]
    }> = [];

    let disciplinaActual = plan.disciplina;
    let diasNumericos: number[] = [];
    let encabezadoVisto = false;

    for (let i = INICIO; i < rows.length; i++) {
      const row = rows[i] as unknown[];
      const col3 = String(row[3] ?? "").trim();

      // Detectar secciones de disciplina
      if (["Instrumentistas", "Electricos", "Mecanicos", "Eléctricos", "Mecánicos"].includes(col3)) {
        disciplinaActual = col3.startsWith("Inst") ? "INST"
          : col3.startsWith("El") ? "ELEC"
          : "MEC";
        encabezadoVisto = false;
        continue;
      }

      // Fila de encabezado con números de día
      if (col3 === "NOMBRE") {
        encabezadoVisto = true;
        diasNumericos = [];
        for (let c = 4; c < row.length; c++) {
          const v = row[c];
          if (typeof v === "number" && v >= 1 && v <= 31) diasNumericos.push(v);
        }
        continue;
      }

      // Fila de persona: col3 tiene un nombre (no vacío, no "2026", no "Supervisores")
      if (encabezadoVisto && col3 && col3 !== "2026" && !/^\d+$/.test(col3)) {
        // Excluir filas de sección/leyenda
        if (["Supervisores", "Dias trabajados", "Turno Dia", "Turno Noche"].includes(col3)) continue;

        const asistencia: string[] = [];
        for (let c = 4; c < row.length; c++) {
          const v = row[c];
          if (diasNumericos.length > 0 && c - 4 >= diasNumericos.length) break;
          asistencia.push(normalizarCodigo(v));
        }

        personas.push({ nombre: col3, disciplina: disciplinaActual, asistencia, diasNumericos });
      }
    }

    // Filtrar por disciplina del plan y guardar en BD
    const delPlan = personas.filter(p => p.disciplina === plan.disciplina);

    // Borrar roster anterior del plan
    await prisma.rosterSemanal.deleteMany({ where: { planBorradorId: id } });

    for (const p of delPlan) {
      const grupo = calcularGrupo(p.asistencia);
      await prisma.rosterSemanal.create({
        data: {
          planBorradorId: id,
          nombre: p.nombre,
          disciplina: p.disciplina,
          grupo,
          asistencia: p.asistencia as string[] as unknown as import("@prisma/client").Prisma.InputJsonValue,
          esContratista: false,
        },
      });
    }

    return NextResponse.json({ ok: true, importados: delPlan.length, total: personas.length });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Error importando roster";
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}
