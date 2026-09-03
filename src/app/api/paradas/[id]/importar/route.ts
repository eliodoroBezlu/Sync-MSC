import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { parseFilasOts, type FilaImportNormalizada } from "@/lib/parada/importar";
import { importarJsonSchema, zodError } from "@/lib/parada/validacion";
import {
  normalizarCritica,
  normalizarDisciplina,
  normalizarFase,
  normalizarGrupo,
  parseFechaImport,
} from "@/lib/parada/importar";

type Ctx = { params: Promise<{ id: string }> };

// POST /api/paradas/[id]/importar
//  - multipart con `file` (.xlsx): parser flexible por nombre de columna.
//  - JSON { filas: [...] }: pegado manual desde una tabla.
// Regla: no re-crea OTs cuyo numeroOT ya existe en la parada.
export async function POST(req: NextRequest, { params }: Ctx) {
  try {
    const { id } = await params;
    const parada = await prisma.parada.findUnique({ where: { id }, select: { id: true } });
    if (!parada) return NextResponse.json({ ok: false, error: "Parada no encontrada" }, { status: 404 });

    const contentType = req.headers.get("content-type") ?? "";
    let filas: FilaImportNormalizada[] = [];
    let sinDisciplina = 0;
    let sinNumero = 0;

    if (contentType.includes("application/json")) {
      const parsed = importarJsonSchema.safeParse(await req.json());
      if (!parsed.success) {
        return NextResponse.json({ ok: false, error: zodError(parsed.error) }, { status: 400 });
      }
      for (const f of parsed.data.filas) {
        const disc = normalizarDisciplina(f.disciplina);
        if (!f.numeroOT) { sinNumero++; continue; }
        if (!disc) { sinDisciplina++; continue; }
        filas.push({
          numeroOT: f.numeroOT.trim(),
          descripcion: f.descripcion.trim() || `OT ${f.numeroOT.trim()}`,
          tag: f.tag.trim().toUpperCase(),
          descripcionEquipo: f.descripcionEquipo.trim(),
          disciplina: disc,
          fase: normalizarFase(f.fase),
          hhEstimadas: Number(f.hhEstimadas) || 0,
          fechaProg: parseFechaImport(f.fechaProg),
          fechaProgFin: parseFechaImport(f.fechaProgFin),
          grupo: normalizarGrupo(f.grupo),
          responsable: f.responsable.trim() || null,
          critica: normalizarCritica(f.critica),
        });
      }
    } else {
      const formData = await req.formData();
      const file = formData.get("file") as File | null;
      if (!file) return NextResponse.json({ ok: false, error: "Archivo requerido" }, { status: 400 });
      const buffer = Buffer.from(await file.arrayBuffer());
      const wb = XLSX.read(buffer, { type: "buffer", cellDates: true });
      const hojaNombre = String(formData.get("hoja") ?? "") || wb.SheetNames[0];
      const ws = wb.Sheets[hojaNombre];
      if (!ws) return NextResponse.json({ ok: false, error: `Hoja "${hojaNombre}" no encontrada` }, { status: 400 });
      const rows: unknown[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });
      const res = parseFilasOts(rows);
      filas = res.filas;
      sinDisciplina = res.sinDisciplina;
      sinNumero = res.sinNumero;
      if (Object.keys(res.columnas).length === 0) {
        return NextResponse.json(
          { ok: false, error: "No se reconoció ninguna columna. ¿La primera fila tiene los encabezados?" },
          { status: 400 },
        );
      }
    }

    if (filas.length === 0) {
      return NextResponse.json(
        { ok: false, error: `Ninguna fila válida (sin N° OT: ${sinNumero}, sin disciplina: ${sinDisciplina}).` },
        { status: 400 },
      );
    }

    const existentes = await prisma.paradaOt.findMany({
      where: { paradaId: id },
      select: { numeroOT: true },
    });
    const vistos = new Set(existentes.map((o) => o.numeroOT));
    let orden = existentes.length;
    let duplicadas = 0;

    const nuevas = filas.filter((f) => {
      if (vistos.has(f.numeroOT)) { duplicadas++; return false; }
      vistos.add(f.numeroOT);
      return true;
    });

    if (nuevas.length > 0) {
      await prisma.paradaOt.createMany({
        data: nuevas.map((f) => ({
          paradaId: id,
          numeroOT: f.numeroOT,
          descripcion: f.descripcion,
          tag: f.tag,
          descripcionEquipo: f.descripcionEquipo,
          disciplina: f.disciplina,
          fase: f.fase,
          hhEstimadas: f.hhEstimadas,
          fechaProg: f.fechaProg,
          fechaProgFin: f.fechaProgFin,
          grupo: f.grupo,
          responsable: f.responsable,
          critica: f.critica,
          orden: ++orden,
        })),
      });
    }

    return NextResponse.json({
      ok: true,
      importadas: nuevas.length,
      duplicadasOmitidas: duplicadas,
      sinDisciplina,
      sinNumero,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Error importando";
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}
