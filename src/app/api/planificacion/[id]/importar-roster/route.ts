import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";
import * as XLSX from "xlsx";

type Ctx = { params: Promise<{ id: string }> };

// Códigos de turno del roster E&I 2026
const TURNO_CODIGO: Record<string, string> = {
  D: "D",   // Turno Día
  N: "N",   // Turno Noche
  T: "T",   // Trasnochal
  V: "V",   // Vacaciones
  CS: "CS", // Comisión de Servicio
  L: "L",   // Libre / descanso
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

/**
 * Calcula columna inicial y final para una semana ISO dentro del mes
 * Ej: Junio 2026, semana 26 → lunes 22 a domingo 28
 */
function calcularColumnasParaSemana(
  semana: number,
  anio: number,
  mesNumero: number
): { colInicio: number; colFin: number; diasRango: string } {
  // Primera semana del año en ISO
  const jan4 = new Date(anio, 0, 4);
  const lunesAno = new Date(jan4);
  const dow = jan4.getDay() || 7;
  lunesAno.setDate(jan4.getDate() - dow + 1);

  // Lunes de la semana solicitada
  const lunesSemana = new Date(lunesAno);
  lunesSemana.setDate(lunesAno.getDate() + (semana - 1) * 7);

  // Domingo de esa semana
  const domingoSemana = new Date(lunesSemana);
  domingoSemana.setDate(lunesSemana.getDate() + 6);

  // Verificar si cae en el mes solicitado
  const lunesEnMes = lunesSemana.getMonth() === mesNumero - 1;

  if (!lunesEnMes) {
    return { colInicio: -1, colFin: -1, diasRango: "fuera" };
  }

  // Columna inicial (día 1 del mes = columna 0)
  const colInicio = lunesSemana.getDate() - 1;

  // Columna final (máximo día del mes)
  const ultimoDiaDelMes = new Date(anio, mesNumero, 0).getDate();
  const colFin = Math.min(domingoSemana.getDate() - 1, ultimoDiaDelMes - 1);

  return {
    colInicio,
    colFin,
    diasRango: `${lunesSemana.getDate()}-${Math.min(domingoSemana.getDate(), ultimoDiaDelMes)}`,
  };
}

export async function POST(req: NextRequest, { params }: Ctx) {
  try {
    const { id } = await params;

    const plan = await prisma.planBorrador.findUnique({ where: { id } });
    if (!plan) return NextResponse.json({ error: "Plan no encontrado" }, { status: 404 });

    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    if (!file) return NextResponse.json({ error: "Archivo requerido" }, { status: 400 });

    // Buscar usuarios técnicos (rol=4) solamente
    const usuariosPorNombre = new Map<string, { id: string; rol: number }>();
    const usuariosTecnicos = await prisma.usuario.findMany({
      where: { rol: 4, activo: true }, // Solo técnicos (rol 4 = Técnico)
      select: { id: true, nombre: true, rol: true },
    });
    for (const u of usuariosTecnicos) {
      usuariosPorNombre.set(u.nombre.trim().toLowerCase(), { id: u.id, rol: u.rol });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const wb = XLSX.read(buffer, { type: "buffer" });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows: unknown[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });

    // El roster 2026 empieza en fila 741 (índice 740)
    const INICIO = 740;
    const personas: Array<{
      nombre: string;
      disciplina: string;
      asistencia: string[];
      usuarioId: string;
    }> = [];

    let disciplinaActual = plan.disciplina;
    let encabezadoVisto = false;

    for (let i = INICIO; i < rows.length; i++) {
      const row = rows[i] as unknown[];
      const col3 = String(row[3] ?? "").trim();

      // Detectar secciones de disciplina
      if (["Instrumentistas", "Electricos", "Mecanicos", "Eléctricos", "Mecánicos"].includes(col3)) {
        disciplinaActual = col3.startsWith("Inst")
          ? "INST"
          : col3.startsWith("El")
            ? "ELEC"
            : "MEC";
        encabezadoVisto = false;
        continue;
      }

      // Fila de encabezado NOMBRE
      if (col3 === "NOMBRE") {
        encabezadoVisto = true;
        continue;
      }

      // Fila de persona: col3 tiene un nombre
      if (encabezadoVisto && col3 && col3 !== "2026" && !/^\d+$/.test(col3)) {
        // Excluir filas de sección/leyenda
        if (["Supervisores", "Dias trabajados", "Turno Dia", "Turno Noche"].includes(col3)) continue;

        // **FILTRO CRÍTICO**: Solo incluir si es técnico (rol=4) en BD
        const usuarioData = usuariosPorNombre.get(col3.toLowerCase());
        if (!usuarioData) continue; // Salta supervisores y no-técnicos

        // Leer los 30+ días del mes (columnas 4 en adelante)
        const asistencia: string[] = [];
        for (let c = 4; c < row.length && asistencia.length < 31; c++) {
          asistencia.push(normalizarCodigo(row[c]));
        }

        personas.push({
          nombre: col3,
          disciplina: disciplinaActual,
          asistencia,
          usuarioId: usuarioData.id,
        });
      }
    }

    // Filtrar por disciplina del plan
    const delPlan = personas.filter(p => p.disciplina === plan.disciplina);

    // Calcular columnas para la semana ISO (asumiendo Junio = mes 6)
    const mesNumero = 6; // Junio
    const { colInicio, colFin, diasRango } = calcularColumnasParaSemana(
      plan.semana,
      plan.anio,
      mesNumero
    );

    if (colInicio < 0) {
      return NextResponse.json(
        {
          error: `Semana ${plan.semana}/${plan.anio} no cae en Junio. Verifica la semana/año.`,
        },
        { status: 400 }
      );
    }

    // Borrar roster anterior del plan
    await prisma.rosterSemanal.deleteMany({ where: { planBorradorId: id } });

    // Guardar solo los 7 días de la semana relevante
    for (const p of delPlan) {
      const asistenciaSemana = p.asistencia.slice(colInicio, colFin + 1);
      if (asistenciaSemana.length === 0) continue;

      const grupo = calcularGrupo(asistenciaSemana);
      await prisma.rosterSemanal.create({
        data: {
          planBorradorId: id,
          nombre: p.nombre,
          usuarioId: p.usuarioId,
          disciplina: p.disciplina,
          grupo,
          asistencia: asistenciaSemana as unknown as import("@prisma/client").Prisma.InputJsonValue,
          esContratista: false,
        },
      });
    }

    return NextResponse.json({
      ok: true,
      importados: delPlan.length,
      diasSemana: diasRango,
      mensaje: `${delPlan.length} técnicos importados para semana ${plan.semana} (días ${diasRango})`,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Error importando roster";
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}
