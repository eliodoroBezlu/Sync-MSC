import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { parseFilasOts, type FilaImportNormalizada } from "@/lib/parada/importar";
import { importarJsonSchema, zodError } from "@/lib/parada/validacion";
import {
  asignarGruposSecuenciales,
  normalizarCritica,
  normalizarDisciplina,
  normalizarFase,
  normalizarGrupo,
  parseFechaImport,
  resumirGrupos,
} from "@/lib/parada/importar";

type Ctx = { params: Promise<{ id: string }> };

// POST /api/paradas/[id]/importar
//  - multipart con `file` (.xlsx): parser flexible por nombre de columna. Si no
//    se indica `hoja`, se leen TODAS las hojas (una por disciplina en PPML060).
//  - JSON { filas: [...] }: pegado manual desde una tabla.
// Regla: no re-crea OTs cuyo numeroOT ya existe en la parada.
export async function POST(req: NextRequest, { params }: Ctx) {
  try {
    const { id } = await params;
    const parada = await prisma.parada.findUnique({
      where: { id },
      select: { id: true, fechaEjecucionInicio: true },
    });
    if (!parada) return NextResponse.json({ ok: false, error: "Parada no encontrada" }, { status: 404 });

    const contentType = req.headers.get("content-type") ?? "";
    const filas: FilaImportNormalizada[] = [];
    let sinDisciplina = 0;
    let sinNumero = 0;
    let seccionesOmitidas = 0;

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
          grupoCodigo: "",
          grupoNumero: null,
          responsable: f.responsable.trim() || null,
          critica: normalizarCritica(f.critica),
        });
      }
      asignarGruposSecuenciales(filas);
    } else {
      const formData = await req.formData();
      const file = formData.get("file") as File | null;
      if (!file) return NextResponse.json({ ok: false, error: "Archivo requerido" }, { status: 400 });
      const buffer = Buffer.from(await file.arrayBuffer());
      const wb = XLSX.read(buffer, { type: "buffer", cellDates: true });

      const hojaPedida = String(formData.get("hoja") ?? "").trim();
      const nombres = hojaPedida ? [hojaPedida] : wb.SheetNames;
      let columnasReconocidas = 0;

      for (const nombre of nombres) {
        const ws = wb.Sheets[nombre];
        if (!ws) {
          if (hojaPedida) {
            return NextResponse.json({ ok: false, error: `Hoja "${nombre}" no encontrada` }, { status: 400 });
          }
          continue;
        }
        const rows: unknown[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });
        const res = parseFilasOts(rows, {
          disciplinaDefault: normalizarDisciplina(nombre),
          ejecucionDesde: parada.fechaEjecucionInicio,
        });
        filas.push(...res.filas);
        sinDisciplina += res.sinDisciplina;
        sinNumero += res.sinNumero;
        seccionesOmitidas += res.seccionesOmitidas;
        columnasReconocidas += Object.keys(res.columnas).length;
      }

      if (columnasReconocidas === 0) {
        return NextResponse.json(
          { ok: false, error: "No se reconoció ninguna columna. ¿La primera fila tiene los encabezados?" },
          { status: 400 },
        );
      }
      // Re-numera las cuadrillas sobre el total (varias hojas = varias disciplinas).
      asignarGruposSecuenciales(filas);
    }

    if (filas.length === 0) {
      return NextResponse.json(
        { ok: false, error: `Ninguna fila válida (sin N° OT: ${sinNumero}, sin disciplina: ${sinDisciplina}).` },
        { status: 400 },
      );
    }

    const existentes = await prisma.paradaOt.findMany({
      where: { paradaId: id },
      select: { numeroOT: true, grupoNumero: true },
    });
    const vistos = new Set(existentes.map((o) => o.numeroOT));
    const sinCuadrilla = new Set(
      existentes.filter((o) => o.grupoNumero == null).map((o) => o.numeroOT),
    );
    let orden = existentes.length;
    let duplicadas = 0;

    const nuevas = filas.filter((f) => {
      if (vistos.has(f.numeroOT)) { duplicadas++; return false; }
      vistos.add(f.numeroOT);
      return true;
    });

    // Backfill: OTs ya cargadas (de una importación previa sin este campo) que
    // ahora sí traen cuadrilla en el listado.
    let cuadrillasBackfill = 0;
    for (const f of filas) {
      if (f.grupoNumero == null || !sinCuadrilla.has(f.numeroOT)) continue;
      sinCuadrilla.delete(f.numeroOT);
      await prisma.paradaOt.updateMany({
        where: { paradaId: id, numeroOT: f.numeroOT },
        data: { grupoCodigo: f.grupoCodigo, grupoNumero: f.grupoNumero },
      });
      cuadrillasBackfill++;
    }

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
          grupoCodigo: f.grupoCodigo,
          grupoNumero: f.grupoNumero,
          responsable: f.responsable,
          critica: f.critica,
          orden: ++orden,
        })),
      });
    }

    // Crea las cuadrillas (ParadaGrupo) que trae el listado y que aún no existen.
    // El supervisor sale de la columna "SUPERVISOR"; el turno, del turno
    // mayoritario de sus OTs. No pisa grupos ya configurados a mano (miembros,
    // dotación, supervisor cargado).
    const gruposNuevos = resumirGrupos(filas);
    const yaExisten = await prisma.paradaGrupo.findMany({
      where: { paradaId: id },
      select: { disciplina: true, numero: true, supervisorNombre: true, id: true },
    });
    const claveExistente = new Map(yaExisten.map((g) => [`${g.disciplina}|${g.numero}`, g]));
    let gruposCreados = 0;
    for (const g of gruposNuevos) {
      const previo = claveExistente.get(`${g.disciplina}|${g.numero}`);
      if (!previo) {
        await prisma.paradaGrupo.create({
          data: {
            paradaId: id,
            turno: g.turno,
            disciplina: g.disciplina,
            numero: g.numero,
            supervisorNombre: g.supervisorNombre,
          },
        });
        gruposCreados++;
      } else if (!previo.supervisorNombre && g.supervisorNombre) {
        await prisma.paradaGrupo.update({
          where: { id: previo.id },
          data: { supervisorNombre: g.supervisorNombre },
        });
      }
    }

    return NextResponse.json({
      ok: true,
      importadas: nuevas.length,
      duplicadasOmitidas: duplicadas,
      cuadrillasBackfill,
      gruposCreados,
      sinDisciplina,
      sinNumero,
      seccionesOmitidas,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Error importando";
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}
