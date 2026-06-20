import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";
import * as XLSX from "xlsx";

type Ctx = { params: Promise<{ id: string }> };

const TURNO_CODIGO: Record<string, string> = {
  D: "D", N: "N", T: "T", V: "V", CS: "CS", L: "L", "": "",
};

function normalizarCodigo(v: unknown): string {
  const s = String(v ?? "").trim().toUpperCase();
  return TURNO_CODIGO[s] ?? s;
}

function calcularGrupo(asistencia: string[]): string {
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

    // Buscar solo técnicos (rol=4)
    const usuariosPorNombre = new Map<string, string>();
    const usuariosTecnicos = await prisma.usuario.findMany({
      where: { rol: 4, activo: true },
      select: { id: true, nombre: true },
    });
    for (const u of usuariosTecnicos) {
      usuariosPorNombre.set(u.nombre.trim().toLowerCase(), u.id);
    }

    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    if (!file) return NextResponse.json({ error: "Archivo requerido" }, { status: 400 });

    const buffer = Buffer.from(await file.arrayBuffer());
    const wb = XLSX.read(buffer, { type: "buffer" });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows: unknown[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });

    // ─── PASO 1: Encontrar la sección INST y el encabezado de días ───────
    const INICIO_BUSQUEDA = 740; // Fila ~741 en Excel
    let mesNumero = 0; // Enero=1, Junio=6, etc.
    let indiceDiaInicio = -1; // Índice de columna donde empieza el mes
    let indiceCol22 = -1; // Índice de columna del día 22
    let indiceCol28 = -1; // Índice de columna del día 28
    let filaEncabezado = -1;
    let filaInstrumentistas = -1;

    for (let i = INICIO_BUSQUEDA; i < rows.length; i++) {
      const row = rows[i] as unknown[];
      const col3 = String(row[3] ?? "").trim();

      // Detectar "Instrumentistas"
      if (col3 === "Instrumentistas") {
        filaInstrumentistas = i;
        continue;
      }

      // Detectar encabezado "NOMBRE" con números de días
      if (col3 === "NOMBRE" && filaInstrumentistas > 0) {
        filaEncabezado = i;
        // Buscar números 1-30 en esta fila
        for (let c = 4; c < row.length; c++) {
          const v = Number(row[c]);
          if (Number.isInteger(v) && v >= 1 && v <= 31) {
            if (indiceDiaInicio === -1) {
              indiceDiaInicio = c; // Primera columna con número (día 1)
              mesNumero = 6; // Asumimos Junio
            }
            if (v === 22) indiceCol22 = c;
            if (v === 28) indiceCol28 = c;
          }
        }
        break; // Ya encontramos el encabezado de INST
      }
    }

    if (indiceDiaInicio < 0 || indiceCol22 < 0 || indiceCol28 < 0) {
      return NextResponse.json(
        { error: "No se pudo encontrar la estructura de días en el Excel" },
        { status: 400 }
      );
    }

    // ─── PASO 2: Leer técnicos desde filaInstrumentistas+1 ───────────────
    const personas: Array<{
      nombre: string;
      usuarioId: string;
      asistencia: string[];
    }> = [];

    for (let i = filaEncabezado + 1; i < rows.length; i++) {
      const row = rows[i] as unknown[];
      const col3 = String(row[3] ?? "").trim();

      // Parar si encontramos otra sección
      if (["Supervisores", "Electricos", "Mecanicos"].includes(col3)) break;

      // Excluir filas vacías o de leyenda
      if (!col3 || /^\d+$/.test(col3)) continue;
      if (["Dias trabajados", "Turno Dia", "Turno Noche"].includes(col3)) continue;

      // **FILTRO CRÍTICO**: Solo técnicos (rol=4)
      const usuarioId = usuariosPorNombre.get(col3.toLowerCase());
      if (!usuarioId) continue;

      // Leer desde indiceDiaInicio hasta el final (max 31 días)
      const asistencia: string[] = [];
      for (let c = indiceDiaInicio; c < row.length && asistencia.length < 31; c++) {
        asistencia.push(normalizarCodigo(row[c]));
      }

      personas.push({
        nombre: col3,
        usuarioId,
        asistencia,
      });
    }

    // ─── PASO 3: Extraer solo los 7 días de la semana (22-28) ────────────
    const colInicio = indiceCol22 - indiceDiaInicio; // Índice relativo
    const colFin = indiceCol28 - indiceDiaInicio;

    // Borrar roster anterior
    await prisma.rosterSemanal.deleteMany({ where: { planBorradorId: id } });

    // Guardar técnicos con sus 7 días
    for (const p of personas) {
      const asistenciaSemana = p.asistencia.slice(colInicio, colFin + 1);
      if (asistenciaSemana.length === 0) continue;

      const grupo = calcularGrupo(asistenciaSemana);
      await prisma.rosterSemanal.create({
        data: {
          planBorradorId: id,
          nombre: p.nombre,
          usuarioId: p.usuarioId,
          disciplina: "INST",
          grupo,
          asistencia: asistenciaSemana as unknown as import("@prisma/client").Prisma.InputJsonValue,
          esContratista: false,
        },
      });
    }

    return NextResponse.json({
      ok: true,
      importados: personas.length,
      diasSemana: "22-28 (Semana 26)",
      mensaje: `${personas.length} técnicos importados correctamente`,
      debug: {
        indiceDiaInicio,
        indiceCol22,
        indiceCol28,
        colInicio,
        colFin,
      },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Error importando roster";
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}
