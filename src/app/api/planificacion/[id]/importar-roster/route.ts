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

// Un mismo archivo de roster trae todas las disciplinas en bloques
// verticales dentro de la misma hoja (Instrumentistas, Electricos,
// Mecanicos, Supervisores), con las mismas columnas de mes/día. Sin este
// mapeo, el importador siempre leía "Instrumentistas" sin importar la
// disciplina del plan (ver areaToDisciplina.ts para los códigos válidos).
const SECCION_POR_DISCIPLINA: Record<string, string> = {
  INST: "Instrumentistas",
  ELEC: "Electricos",
  MEC: "Mecanicos",
};
const SECCIONES_CONOCIDAS = Object.values(SECCION_POR_DISCIPLINA).concat("Supervisores");

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

function normalizarTextoMes(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

// El roster de Generación trae el nombre en orden "Nombres Apellidos" (ej.
// "Freddy Gustavo Juvenal Machaca Martinez"), mientras Usuario.nombre está
// guardado en orden "Apellidos Nombres" (ej. "Machaca Martínez Freddy
// Gustavo Juvenal") — el mismo orden que usa el roster de E&I, por eso ese
// formato matchea directo. Ordenar alfabéticamente las palabras del nombre
// (sin tildes) da una clave que coincide sin importar el orden de origen.
function normalizarNombreOrden(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .sort()
    .join(" ");
}

// El roster de Generación es un archivo dedicado (no compartido entre
// disciplinas como el de E&I): un único listado de personal, sin secciones,
// con rótulos de mes con guión bajo ("ENERO_2026" en vez de "Enero 2026") y
// el nombre en la columna 1 en vez de la 3. Algunos rótulos vienen mal
// escritos en el origen (ej. "ABRL_2026"): en vez de exigir que el nombre del
// mes matchee el diccionario, se ancla el primer rótulo que sí resuelve y el
// resto se infiere por secuencia, ya que los meses siempre aparecen en orden
// calendario a lo largo de la fila.
interface FormatoGeneracion {
  filaDatos: number;
  nombreCol: number;
  columnasPorMes: Map<string, number>;
}

function resolverFormatoGeneracion(rows: unknown[][]): FormatoGeneracion | null {
  let filaMeses = -1;
  let etiquetas: { col: number; anio: number; mesTexto: string }[] = [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i] as unknown[];
    const matches: { col: number; anio: number; mesTexto: string }[] = [];
    for (let c = 0; c < row.length; c++) {
      const m = String(row[c] ?? "").trim().match(/^([A-Za-zÀ-ÿ]+)_(\d{4})$/);
      if (m) matches.push({ col: c, mesTexto: m[1], anio: Number(m[2]) });
    }
    if (matches.length >= 6) {
      filaMeses = i;
      etiquetas = matches;
    }
  }
  if (filaMeses < 0) return null;

  etiquetas.sort((a, b) => a.col - b.col);
  const anclaIdx = etiquetas.findIndex(e => MESES_ES[normalizarTextoMes(e.mesTexto)] !== undefined);
  if (anclaIdx < 0) return null;
  const mesAncla = MESES_ES[normalizarTextoMes(etiquetas[anclaIdx].mesTexto)];
  const anioAncla = etiquetas[anclaIdx].anio;

  const columnasPorMes = new Map<string, number>();
  etiquetas.forEach((e, idx) => {
    const totalMes = mesAncla + (idx - anclaIdx);
    const mes = ((totalMes % 12) + 12) % 12;
    const anio = anioAncla + Math.floor(totalMes / 12);
    columnasPorMes.set(`${anio}-${mes}`, e.col);
  });

  return { filaDatos: filaMeses + 3, nombreCol: 1, columnasPorMes };
}

export async function POST(req: NextRequest, { params }: Ctx) {
  try {
    const { id } = await params;

    const plan = await prisma.planBorrador.findUnique({ where: { id } });
    if (!plan) return NextResponse.json({ error: "Plan no encontrado" }, { status: 404 });

    // Buscar solo técnicos (rol=4)
    const usuariosPorNombre = new Map<string, string>();
    const usuariosPorNombreOrdenado = new Map<string, string>();
    const usuariosTecnicos = await prisma.usuario.findMany({
      where: { rol: 4, activo: true },
      select: { id: true, nombre: true },
    });
    for (const u of usuariosTecnicos) {
      usuariosPorNombre.set(u.nombre.trim().toLowerCase(), u.id);
      usuariosPorNombreOrdenado.set(normalizarNombreOrden(u.nombre), u.id);
    }

    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    if (!file) return NextResponse.json({ error: "Archivo requerido" }, { status: 400 });

    const buffer = Buffer.from(await file.arrayBuffer());
    const wb = XLSX.read(buffer, { type: "buffer", cellStyles: true });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows: unknown[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });

    // ─── PASO 1/2: Ubicar rótulos de mes y desde dónde leer personas ───────
    // Dos formatos posibles según el área: el roster de E&I trae todas las
    // disciplinas en secciones dentro de una misma hoja ("Enero 2026", nombre
    // en col 3); el de Generación es un archivo dedicado con un solo listado
    // sin secciones ("ENERO_2026" con guión bajo, nombre en col 1). Se
    // detecta primero el formato Generación porque su separador de rótulo
    // ("_") es mutuamente excluyente con el de E&I (espacio).
    const formatoGeneracion = resolverFormatoGeneracion(rows);

    let columnasPorMes: Map<string, number>;
    let filaEncabezado: number;
    let nombreCol: number;
    let seccionBuscada: string | null = null;

    if (formatoGeneracion) {
      columnasPorMes = formatoGeneracion.columnasPorMes;
      filaEncabezado = formatoGeneracion.filaDatos - 1;
      nombreCol = formatoGeneracion.nombreCol;
    } else {
      // Se toma la ÚLTIMA fila con varios rótulos de mes encontrada en toda
      // la hoja: el archivo es un archivo histórico con bloques de años
      // anteriores más arriba, y el bloque vigente siempre es el más
      // reciente (más abajo).
      let filaMeses = -1;
      columnasPorMes = new Map<string, number>();
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

      // Ubicar la sección de la disciplina del plan bajo ese bloque
      seccionBuscada = SECCION_POR_DISCIPLINA[plan.disciplina];
      if (!seccionBuscada) {
        return NextResponse.json(
          { error: `No hay una sección de roster configurada para la disciplina "${plan.disciplina}"` },
          { status: 400 }
        );
      }
      nombreCol = 3;
      let filaSeccion = -1;
      filaEncabezado = -1;
      for (let i = filaMeses; i < rows.length; i++) {
        const row = rows[i] as unknown[];
        const col3 = String(row[3] ?? "").trim();
        if (col3 === seccionBuscada) {
          filaSeccion = i;
          continue;
        }
        if (col3 === "NOMBRE" && filaSeccion > 0) {
          filaEncabezado = i;
          break;
        }
      }
      if (filaEncabezado < 0) {
        return NextResponse.json(
          { error: `No se pudo encontrar la sección '${seccionBuscada}' en el Excel` },
          { status: 400 }
        );
      }
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
      const nombre = String(row[nombreCol] ?? "").trim();

      if (formatoGeneracion) {
        // El listado termina en la fila de resumen "NÚMERO DE PERSONAS EN
        // SITIÓ"; después vienen solo filas de leyenda de códigos.
        if (/^N[UÚ]MERO/i.test(nombre)) break;
        // Filas vacías son separadores visuales entre personas, no el fin.
        if (!nombre) continue;
      } else {
        // Parar si encontramos el inicio de otra sección (cualquiera menos
        // la que se está leyendo, ya que esa ya quedó atrás en filaSeccion)
        if (SECCIONES_CONOCIDAS.includes(nombre) && nombre !== seccionBuscada) break;

        // Excluir filas vacías o de leyenda
        if (!nombre || /^\d+$/.test(nombre)) continue;
        if (["Dias trabajados", "Turno Dia", "Turno Noche"].includes(nombre)) continue;
      }

      // **FILTRO CRÍTICO**: Solo técnicos (rol=4)
      // El formato Generación trae el nombre en orden inverso al de la BD
      // (ver normalizarNombreOrden); el fallback solo se activa para ese
      // formato, así que el matching de E&I (que ya matchea directo) no cambia.
      const usuarioId =
        usuariosPorNombre.get(nombre.toLowerCase()) ??
        (formatoGeneracion ? usuariosPorNombreOrdenado.get(normalizarNombreOrden(nombre)) : undefined);
      if (!usuarioId) continue;

      const asistenciaSemana = columnas.map(c => normalizarCodigo(row[c]));
      const guardiaDiurnaSemana = columnas.map(c => {
        const codigo = normalizarCodigo(row[c]);
        // El roster de Generación no distingue "turno normal" de "guardia
        // diurna" por relleno de celda como el de E&I: el código "T" ya
        // significa "Trabajo Dia" sin ambigüedad.
        if (formatoGeneracion) return codigo === "T";
        const celda = ws[XLSX.utils.encode_cell({ r: i, c })];
        return codigo === "T" && esFondoGuardiaDiurna(celda);
      });

      personas.push({ nombre, usuarioId, asistenciaSemana, guardiaDiurnaSemana });
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
            disciplina: plan.disciplina,
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
      debug: { formato: formatoGeneracion ? "generacion" : "seccionado", filaEncabezado, columnas },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Error importando roster";
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}
