import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { seedMembresiaDesdeAsistencia, cachePersonalAsignado, calcularGrupo, type CuadrillaMiembroRow } from "@/lib/planificacion/cuadrillas";
import { getWeekDates } from "@/lib/semana";

type Ctx = { params: Promise<{ id: string }> };

const TURNO_CODIGO: Record<string, string> = {
  D: "D", N: "N", T: "T", V: "V", CS: "CS", L: "L", "": "",
};

function normalizarCodigo(v: unknown): string {
  const s = String(v ?? "").trim().toUpperCase();
  return TURNO_CODIGO[s] ?? s;
}

// Distingue "turno diurno" de "turno normal" en celdas con código "T": ambas
// tienen el mismo texto, solo el fondo cambia (gris = guardia diurna, según
// la codificación de RRHH que no se puede alterar). theme 0 = blanco/sin
// relleno = turno normal; cualquier otro relleno sólido = turno diurno.
function esFondoGuardiaDiurna(cell: XLSX.CellObject | undefined): boolean {
  const fg = (cell?.s as { fgColor?: { theme?: number } } | undefined)?.fgColor;
  return !!fg && fg.theme !== 0;
}

const MESES_ES: Record<string, number> = {
  enero: 0, febrero: 1, marzo: 2, abril: 3, mayo: 4, junio: 5,
  julio: 6, agosto: 7, septiembre: 8, octubre: 9, noviembre: 10, diciembre: 11,
};

// El roster es un archivo único con TODOS los meses del año puestos uno al
// lado del otro en la misma fila (ej. "Enero 2026" en la columna 8, "Febrero
// 2026" en la columna 39, etc). Detectar esos rótulos evita depender de "el
// primer bloque de días que se encuentre", que siempre cae en el mes más a
// la izquierda (enero) sin importar qué semana se esté importando.
function parseEtiquetaMes(texto: unknown): { mes: number; anio: number } | null {
  const m = String(texto ?? "").trim().match(/^([A-Za-zñÑ]+)\s+(\d{4})$/);
  if (!m) return null;
  const mes = MESES_ES[m[1].toLowerCase()];
  if (mes === undefined) return null;
  return { mes, anio: Number(m[2]) };
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
    const wb = XLSX.read(buffer, { type: "buffer", cellStyles: true });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows: unknown[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });

    // ─── PASO 1: Ubicar la fila de rótulos de mes (ej. "Enero 2026") ──────
    // Se toma la ÚLTIMA fila con varios rótulos de mes encontrada en toda la
    // hoja: el archivo es un archivo histórico con bloques de años anteriores
    // más arriba, y el bloque vigente siempre es el más reciente (más abajo).
    let filaMeses = -1;
    let columnasPorMes = new Map<string, number>();
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i] as unknown[];
      const matches: { mes: number; anio: number; col: number }[] = [];
      for (let c = 0; c < row.length; c++) {
        const parsed = parseEtiquetaMes(row[c]);
        if (parsed) matches.push({ ...parsed, col: c });
      }
      if (matches.length >= 6) {
        filaMeses = i;
        columnasPorMes = new Map(matches.map(m => [`${m.anio}-${m.mes}`, m.col]));
      }
    }
    if (filaMeses < 0) {
      return NextResponse.json(
        { error: "No se encontró la fila de rótulos de mes (ej. 'Enero 2026') en el Excel" },
        { status: 400 }
      );
    }

    // ─── PASO 2: Ubicar la sección "Instrumentistas" bajo ese bloque ──────
    let filaEncabezado = -1;
    let filaInstrumentistas = -1;
    for (let i = filaMeses; i < rows.length; i++) {
      const row = rows[i] as unknown[];
      const col3 = String(row[3] ?? "").trim();
      if (col3 === "Instrumentistas") {
        filaInstrumentistas = i;
        continue;
      }
      if (col3 === "NOMBRE" && filaInstrumentistas > 0) {
        filaEncabezado = i;
        break;
      }
    }
    if (filaEncabezado < 0) {
      return NextResponse.json(
        { error: "No se pudo encontrar la sección 'Instrumentistas' en el Excel" },
        { status: 400 }
      );
    }

    // ─── PASO 3: Resolver, por cada día real de la semana del plan, la ────
    // columna absoluta que le corresponde (puede caer en dos meses distintos
    // si la semana cruza fin de mes; cada día se resuelve por separado).
    const fechasSemana = getWeekDates(plan.semana, plan.anio);
    const columnasSemana = fechasSemana.map(f => columnasPorMes.get(`${f.getFullYear()}-${f.getMonth()}`));
    const faltantes = fechasSemana
      .map((f, idx) => ({ f, col: columnasSemana[idx] }))
      .filter(x => x.col === undefined)
      .map(x => `${x.f.getDate()}/${x.f.getMonth() + 1}/${x.f.getFullYear()}`);
    if (faltantes.length > 0) {
      return NextResponse.json(
        { error: `El Excel no tiene datos para: ${faltantes.join(", ")}. Verifica que el roster tenga ese mes cargado.` },
        { status: 400 }
      );
    }
    const columnas = fechasSemana.map(f => (columnasPorMes.get(`${f.getFullYear()}-${f.getMonth()}`) as number) + (f.getDate() - 1));

    // ─── PASO 4: Leer técnicos desde filaEncabezado+1, solo los 7 días ────
    const personas: Array<{
      nombre: string;
      usuarioId: string;
      asistenciaSemana: string[];
      guardiaDiurnaSemana: boolean[];
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

      const asistenciaSemana = columnas.map(c => normalizarCodigo(row[c]));
      const guardiaDiurnaSemana = columnas.map(c => {
        const codigo = normalizarCodigo(row[c]);
        const celda = ws[XLSX.utils.encode_cell({ r: i, c })];
        return codigo === "T" && esFondoGuardiaDiurna(celda);
      });

      personas.push({ nombre: col3, usuarioId, asistenciaSemana, guardiaDiurnaSemana });
    }

    // Borrar roster anterior — se preservan los contratistas agregados a mano
    // desde el Tablero (esContratista: true), ya que no vienen del Excel y
    // una reimportación no debe borrarlos.
    await prisma.rosterSemanal.deleteMany({ where: { planBorradorId: id, esContratista: false } });

    // Guardar técnicos con sus 7 días
    let guardados = 0;
    const errores: string[] = [];
    const seedsCuadrilla: ReturnType<typeof seedMembresiaDesdeAsistencia> = [];

    for (const p of personas) {
      try {
        const grupo = calcularGrupo(p.asistenciaSemana, p.guardiaDiurnaSemana);
        await prisma.rosterSemanal.create({
          data: {
            planBorradorId: id,
            nombre: p.nombre,
            usuarioId: p.usuarioId,
            disciplina: "INST",
            grupo,
            asistencia: p.asistenciaSemana as unknown as import("@prisma/client").Prisma.InputJsonValue,
            esContratista: false,
          },
        });
        guardados++;
        seedsCuadrilla.push(
          ...seedMembresiaDesdeAsistencia({
            nombre: p.nombre,
            usuarioId: p.usuarioId,
            asistencia: p.asistenciaSemana,
            guardiaDiurna: p.guardiaDiurnaSemana,
          })
        );
      } catch (e) {
        errores.push(`${p.nombre}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    // Resembrar membresía Diurno/Nocturno desde la asistencia real recién
    // importada. Solo se tocan filas origen="roster": las curadas a mano
    // (origen="manual", incluida toda la membresía de G1-G4) se preservan —
    // skipDuplicates hace que una edición manual sobre el mismo grupo/día/
    // técnico gane sobre el valor recién sembrado.
    await prisma.cuadrillaMiembro.deleteMany({
      where: { planBorradorId: id, grupo: { in: ["Diurno", "Nocturno"] }, origen: "roster" },
    });
    if (seedsCuadrilla.length > 0) {
      await prisma.cuadrillaMiembro.createMany({
        data: seedsCuadrilla.map(s => ({ planBorradorId: id, ...s, origen: "roster" })),
        skipDuplicates: true,
      });
    }

    // Un técnico puede haber cambiado de turno (o dejado de aparecer) en el
    // nuevo Excel: reconciliar el cache personalAsignado de las OTs que tocan
    // Diurno/Nocturno (en su grupo base o en un override de grupoPorDia) para
    // que ninguna quede con gente que ya no cubre ese grupo/día.
    const otsDelPlan = await prisma.planBorradorOt.findMany({ where: { planBorradorId: id } });
    const otsAfectadas = otsDelPlan
      .map(o => ({ ...o, grupoPorDia: o.grupoPorDia as Record<string, string> | null }))
      .filter(o => o.grupo === "Diurno" || o.grupo === "Nocturno"
        || Object.values(o.grupoPorDia ?? {}).some(g => g === "Diurno" || g === "Nocturno"));
    if (otsAfectadas.length > 0) {
      const miembrosVigentes = await prisma.cuadrillaMiembro.findMany({ where: { planBorradorId: id } });
      for (const ot of otsAfectadas) {
        const cache = cachePersonalAsignado(ot, miembrosVigentes as CuadrillaMiembroRow[]);
        if (
          cache.personalAsignado.length !== ot.personalAsignado.length ||
          cache.personalAsignado.some(n => !ot.personalAsignado.includes(n))
        ) {
          await prisma.planBorradorOt.update({ where: { id: ot.id }, data: cache });
        }
      }
    }

    return NextResponse.json({
      ok: true,
      importados: guardados,
      encontrados: personas.length,
      diasSemana: `${fechasSemana[0].getDate()}/${fechasSemana[0].getMonth() + 1} - ${fechasSemana[6].getDate()}/${fechasSemana[6].getMonth() + 1} (Semana ${plan.semana})`,
      mensaje: `${guardados}/${personas.length} técnicos importados`,
      ...(errores.length > 0 && { advertencias: errores }),
      debug: { filaMeses, filaEncabezado, columnas },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Error importando roster";
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}
