// Parser flexible del listado de OTs de una parada. El Excel real varía entre
// planificadores, así que en vez de índices fijos de columna mapeamos por
// NOMBRE de encabezado (normalizado) contra una lista de sinónimos.
//
// Formato de referencia soportado (PPML060): una hoja por disciplina
// ("Electrico" / "Instrumentación" / "TESA"), encabezados en la fila 1 y las
// columnas C..M —la J ("EQUIPOS DE APOYO") se IGNORA por ser equipos—:
//   C TIPO OT · D No. OT · E DESCRIPCION DE ACTIVIDAD · F No. PERSONAS ·
//   G DURACION · H INICIO · I FIN · (J equipos, ignorada) · K No. GRUPO ·
//   L AREA · M SUPERVISOR
// Reglas propias de ese formato:
//   - Las filas de agrupación (OT padre 909003, títulos de zona) traen
//     No. PERSONAS = 0 y se descartan.
//   - "No. OT" con varios números ("921933 921927", común en TESA) genera una
//     fila por número.
//   - HH estimadas = No. PERSONAS × DURACION(horas) cuando no hay columna HH.
//   - "No. GRUPO" es un código de cuadrilla (ELE-01), no un turno: el turno
//     Día/Noche se infiere de la hora de INICIO.
//   - Fechas tipo "Sat 12/9/26 08:00" se leen como día/mes/año.

import type { DisciplinaParada, FaseParada } from "./tipos";

export type CampoImport =
  | "numeroOT"
  | "descripcion"
  | "tag"
  | "descripcionEquipo"
  | "disciplina"
  | "fase"
  | "hhEstimadas"
  | "numPersonas"
  | "duracion"
  | "fechaProg"
  | "fechaProgFin"
  | "grupo"
  | "responsable"
  | "critica";

/** minúsculas, sin acentos, sin signos ni espacios repetidos. */
export function normalizarEncabezado(s: unknown): string {
  return String(s ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const SINONIMOS: Record<CampoImport, string[]> = {
  numeroOT: ["n ot", "no ot", "nro ot", "numero ot", "ot", "orden", "orden trabajo", "n orden"],
  descripcion: [
    "descripcion",
    "descripcion de actividad",
    "descripcion actividad",
    "job description",
    "detalle",
    "trabajo",
    "descripcion trabajo",
    "descripcion ot",
  ],
  tag: ["tag", "equipo", "activo", "kks"],
  descripcionEquipo: ["descripcion de equipo", "descripcion equipo", "nombre equipo", "equipo descripcion"],
  disciplina: ["disciplina", "especialidad", "area", "gremio"],
  fase: ["fase", "etapa"],
  hhEstimadas: ["hh", "hh estimada", "hh estimadas", "horas hombre", "hh est", "hh plan"],
  numPersonas: [
    "no personas",
    "n personas",
    "nro personas",
    "numero personas",
    "personas",
    "cant personas",
    "dotacion",
    "no pers",
    "n pers",
  ],
  duracion: ["duracion", "horas", "duracion hrs", "tiempo"],
  fechaProg: ["fecha", "fecha prog", "fecha programada", "fecha inicio", "f inicio", "inicio", "fecha ejecucion"],
  fechaProgFin: ["fecha fin", "fecha final", "f fin", "fin", "fecha termino"],
  grupo: ["grupo", "no grupo", "turno", "cuadrilla"],
  responsable: ["responsable", "encargado", "supervisor"],
  critica: ["critica", "es critica", "ruta critica", "prioridad"],
};

/** Encabezados que nunca deben mapearse (p. ej. la columna J de PPML060). */
const ENCABEZADOS_IGNORADOS = ["equipos de apoyo", "equipo de apoyo"];

/** Devuelve, por campo, el índice de columna en la fila de encabezados. */
export function mapearColumnas(encabezados: unknown[]): Partial<Record<CampoImport, number>> {
  const norm = encabezados.map(normalizarEncabezado);

  const bloqueadas = new Set<number>();
  norm.forEach((h, i) => {
    if (h && ENCABEZADOS_IGNORADOS.some((b) => h === b || h.includes(b))) bloqueadas.add(i);
  });

  const mapa: Partial<Record<CampoImport, number>> = {};
  for (const [campo, alias] of Object.entries(SINONIMOS) as [CampoImport, string[]][]) {
    const buscar = (pred: (h: string) => boolean): number =>
      norm.findIndex((h, i) => h !== "" && !bloqueadas.has(i) && pred(h));
    // coincidencia exacta primero, luego "empieza con" / "contiene"
    let idx = buscar((h) => alias.includes(h));
    if (idx === -1) idx = buscar((h) => alias.some((a) => h === a || h.startsWith(`${a} `)));
    if (idx === -1) idx = buscar((h) => alias.some((a) => h.includes(a)));
    if (idx !== -1) mapa[campo] = idx;
  }
  return mapa;
}

export function normalizarDisciplina(v: unknown): DisciplinaParada | null {
  const s = normalizarEncabezado(v);
  if (!s) return null;
  if (/(elec|electric|e e|^e$)/.test(s)) return "ELEC";
  if (/(instr|inst|^i$)/.test(s)) return "INST";
  if (/(tesa|sc tesa|^sc$|scada|control)/.test(s)) return "TESA";
  return null;
}

export function normalizarFase(v: unknown): FaseParada {
  return /prep/.test(normalizarEncabezado(v)) ? "preparativos" : "ejecucion";
}

/** Turno explícito de la celda, o null si el valor no lo indica (p. ej. "ELE-01"). */
export function normalizarGrupoOpt(v: unknown): "Dia" | "Noche" | "Ambos" | null {
  const s = normalizarEncabezado(v);
  if (!s) return null;
  if (/(noch|noct|night|^n$)/.test(s)) return "Noche";
  if (/(amb|both|d n|dia noche)/.test(s)) return "Ambos";
  if (/(dia|day|diurno|^d$)/.test(s)) return "Dia";
  return null;
}

export function normalizarGrupo(v: unknown): "Dia" | "Noche" | "Ambos" {
  return normalizarGrupoOpt(v) ?? "Dia";
}

export function normalizarCritica(v: unknown): boolean {
  if (typeof v === "boolean") return v;
  const s = normalizarEncabezado(v);
  return /(si|sí|x|true|1|critic|alta|urgente|p1)/.test(s);
}

/** Turno Día (06:00–17:59) / Noche según la hora de la fecha de inicio. */
export function grupoPorHora(fecha: Date | null): "Dia" | "Noche" {
  if (!fecha) return "Dia";
  const h = fecha.getHours();
  return h >= 6 && h < 18 ? "Dia" : "Noche";
}

/** "7 hrs" → 7 · "1,5 hrs" → 1.5 · 30 → 30. */
export function parseHoras(v: unknown): number {
  if (typeof v === "number") return v > 0 ? v : 0;
  const m = String(v ?? "").match(/(\d+(?:[.,]\d+)?)/);
  return m ? Number(m[1].replace(",", ".")) || 0 : 0;
}

/** "4" → 4 · "4 pers" → 4 · 0/"" → 0. */
export function parsePersonas(v: unknown): number {
  if (typeof v === "number") return v > 0 ? Math.trunc(v) : 0;
  const m = String(v ?? "").match(/\d+/);
  return m ? Number(m[0]) : 0;
}

export function parseFechaImport(v: unknown): Date | null {
  if (v == null || v === "") return null;
  if (v instanceof Date) return isNaN(v.getTime()) ? null : v;
  // número serial de Excel
  if (typeof v === "number" && v > 0) {
    const d = new Date(Math.round((v - 25569) * 86400 * 1000));
    return isNaN(d.getTime()) ? null : d;
  }
  const s = String(v).trim();
  // dd/mm/yyyy o dd-mm-yyyy
  const m = s.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})$/);
  if (m) {
    const [, dd, mm, yy] = m;
    const anio = yy.length === 2 ? 2000 + Number(yy) : Number(yy);
    const d = new Date(anio, Number(mm) - 1, Number(dd));
    return isNaN(d.getTime()) ? null : d;
  }
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

/**
 * Fecha + hora del formato PPML060 ("Sat 12/9/26 08:00", día/mes/año, con
 * prefijo de día de semana y hora opcionales) y otros formatos habituales.
 */
export function parseFechaHoraImport(v: unknown): Date | null {
  if (v == null || v === "") return null;
  if (v instanceof Date) return isNaN(v.getTime()) ? null : v;
  if (typeof v === "number" && v > 0) {
    const d = new Date(Math.round((v - 25569) * 86400 * 1000));
    return isNaN(d.getTime()) ? null : d;
  }
  const s = String(v).trim();
  const m = s.match(/(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})(?:[ T]+(\d{1,2}):(\d{2}))?/);
  if (m) {
    const [, dd, mm, yy, hh, mi] = m;
    const anio = yy.length <= 2 ? 2000 + Number(yy) : Number(yy);
    const d = new Date(anio, Number(mm) - 1, Number(dd), Number(hh ?? "0"), Number(mi ?? "0"));
    return isNaN(d.getTime()) ? null : d;
  }
  return parseFechaImport(s);
}

/** Toma el primer token de la descripción como TAG si parece un código de equipo. */
export function extraerTagDeDescripcion(desc: string): string {
  const tok = desc.trim().split(/\s+/)[0] ?? "";
  const pareceTag =
    tok.length >= 4 &&
    tok.length <= 24 &&
    /\d/.test(tok) &&
    /^[A-Za-z0-9][A-Za-z0-9./-]*$/.test(tok) &&
    tok === tok.toUpperCase();
  return pareceTag ? tok.toUpperCase() : "";
}

/** Fase de la fila: la columna manda; si no hay, se deduce por fecha de inicio. */
export function faseFila(valorCol: unknown, fechaProg: Date | null, ejecucionDesde?: Date | null): FaseParada {
  if (normalizarEncabezado(valorCol)) return normalizarFase(valorCol);
  if (ejecucionDesde && fechaProg) {
    const corte = new Date(ejecucionDesde.getFullYear(), ejecucionDesde.getMonth(), ejecucionDesde.getDate());
    const dia = new Date(fechaProg.getFullYear(), fechaProg.getMonth(), fechaProg.getDate());
    if (dia.getTime() < corte.getTime()) return "preparativos";
  }
  return "ejecucion";
}

export interface FilaImportNormalizada {
  numeroOT: string;
  descripcion: string;
  tag: string;
  descripcionEquipo: string;
  disciplina: DisciplinaParada;
  fase: FaseParada;
  hhEstimadas: number;
  fechaProg: Date | null;
  fechaProgFin: Date | null;
  grupo: "Dia" | "Noche" | "Ambos";
  /** Código crudo de cuadrilla de la columna "No. GRUPO" ("ELE-01", "TURNO"). */
  grupoCodigo: string;
  /** Correlativo 1..N por disciplina; se completa con `asignarGruposSecuenciales`. */
  grupoNumero: number | null;
  responsable: string | null;
  critica: boolean;
}

/**
 * Traduce los códigos de cuadrilla ("ELE-01", "INS-13", "TURNO") a un número
 * correlativo 1..N **por disciplina**, en orden natural y sin huecos:
 * ELE-01→1, ELE-02→2, … , TURNO→8 · INS-01→1, … , INS-11→10, INS-13→11, INS-14→12.
 * Si una disciplina no trae ningún código (caso TESA), todas sus filas quedan
 * en el grupo 1. Muta las filas recibidas.
 */
export function asignarGruposSecuenciales(filas: FilaImportNormalizada[]): void {
  const porDisciplina = new Map<DisciplinaParada, FilaImportNormalizada[]>();
  for (const f of filas) {
    const arr = porDisciplina.get(f.disciplina) ?? [];
    arr.push(f);
    porDisciplina.set(f.disciplina, arr);
  }

  for (const grupoFilas of porDisciplina.values()) {
    const codigos = [...new Set(grupoFilas.map((f) => f.grupoCodigo).filter(Boolean))].sort((a, b) =>
      a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }),
    );
    const numeroDe = new Map(codigos.map((c, i) => [c, i + 1]));
    const sinCodigos = codigos.length === 0;
    for (const f of grupoFilas) {
      f.grupoNumero = f.grupoCodigo ? numeroDe.get(f.grupoCodigo) ?? null : sinCodigos ? 1 : null;
    }
  }
}

export interface GrupoResumen {
  disciplina: DisciplinaParada;
  numero: number;
  turno: "Dia" | "Noche";
  supervisorNombre: string;
}

/** Cuenta ocurrencias y devuelve la clave más repetida (o `""`). */
function moda(valores: string[]): string {
  const cuenta = new Map<string, number>();
  for (const v of valores) if (v) cuenta.set(v, (cuenta.get(v) ?? 0) + 1);
  let mejor = "";
  let max = 0;
  for (const [v, n] of cuenta) if (n > max) ((max = n), (mejor = v));
  return mejor;
}

/**
 * Deriva las cuadrillas (disciplina + número correlativo) presentes en las
 * filas ya numeradas: turno = turno mayoritario de sus OTs, supervisor = valor
 * más frecuente de la columna "SUPERVISOR". Requiere `asignarGruposSecuenciales`
 * previo.
 */
export function resumirGrupos(filas: FilaImportNormalizada[]): GrupoResumen[] {
  const porClave = new Map<string, FilaImportNormalizada[]>();
  for (const f of filas) {
    if (f.grupoNumero == null) continue;
    const clave = `${f.disciplina}|${f.grupoNumero}`;
    const arr = porClave.get(clave) ?? [];
    arr.push(f);
    porClave.set(clave, arr);
  }

  const grupos: GrupoResumen[] = [];
  for (const [clave, arr] of porClave) {
    const [disciplina, numeroStr] = clave.split("|");
    const noche = arr.filter((f) => f.grupo === "Noche").length;
    grupos.push({
      disciplina: disciplina as DisciplinaParada,
      numero: Number(numeroStr),
      turno: noche > arr.length / 2 ? "Noche" : "Dia",
      supervisorNombre: moda(arr.map((f) => f.responsable ?? "")),
    });
  }
  return grupos.sort((a, b) => a.disciplina.localeCompare(b.disciplina) || a.numero - b.numero);
}

export interface ResultadoParse {
  filas: FilaImportNormalizada[];
  sinDisciplina: number; // filas descartadas por disciplina no reconocida
  sinNumero: number; // filas sin N° OT
  seccionesOmitidas: number; // filas de agrupación (padre / títulos de zona)
  columnas: Partial<Record<CampoImport, number>>;
}

export interface OpcionesParse {
  /** Disciplina a usar si la fila no trae AREA reconocible (p. ej. el nombre de la hoja). */
  disciplinaDefault?: DisciplinaParada | null;
  /** Inicio de la fase de ejecución; las OT programadas antes se marcan "preparativos". */
  ejecucionDesde?: Date | null;
}

/**
 * Convierte la matriz cruda de la hoja (fila 0 = encabezados) en filas
 * normalizadas listas para `prisma.paradaOt.create`.
 */
export function parseFilasOts(rows: unknown[][], opts: OpcionesParse = {}): ResultadoParse {
  const filas: FilaImportNormalizada[] = [];
  let sinDisciplina = 0;
  let sinNumero = 0;
  let seccionesOmitidas = 0;

  if (rows.length < 2) {
    return { filas, sinDisciplina, sinNumero, seccionesOmitidas, columnas: {} };
  }

  const columnas = mapearColumnas(rows[0]);
  const col = (campo: CampoImport, row: unknown[]): unknown => {
    const i = columnas[campo];
    return i == null ? "" : row[i];
  };
  const hayColPersonas = columnas.numPersonas != null;
  const hayColHH = columnas.hhEstimadas != null;

  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    if (!row || row.every((c) => c === "" || c == null)) continue;

    const numeroRaw = String(col("numeroOT", row) ?? "").trim();
    if (!numeroRaw) {
      sinNumero++;
      continue;
    }

    const personas = parsePersonas(col("numPersonas", row));
    // Filas de agrupación (OT padre, títulos de zona): traen No. PERSONAS = 0.
    if (hayColPersonas && personas < 1) {
      seccionesOmitidas++;
      continue;
    }

    const disciplina = normalizarDisciplina(col("disciplina", row)) ?? opts.disciplinaDefault ?? null;
    if (!disciplina) {
      sinDisciplina++;
      continue;
    }

    const descripcion = String(col("descripcion", row) ?? "").trim();
    const horas = parseHoras(col("duracion", row));
    const hhCol = Number(col("hhEstimadas", row)) || 0;
    const hhEstimadas = hayColHH ? hhCol : Math.round(personas * horas * 100) / 100;

    const fechaProg = parseFechaHoraImport(col("fechaProg", row));
    const fechaProgFin = parseFechaHoraImport(col("fechaProgFin", row));
    const grupoCrudo = String(col("grupo", row) ?? "").trim();
    const grupo = normalizarGrupoOpt(grupoCrudo) ?? grupoPorHora(fechaProg);
    // El código de cuadrilla ("ELE-01") sólo se guarda si NO es un turno suelto
    // ("Día"/"Noche"), que ya quedó capturado en `grupo`.
    const grupoCodigo = normalizarGrupoOpt(grupoCrudo) ? "" : grupoCrudo.toUpperCase();
    const responsable = String(col("responsable", row) ?? "").trim() || null;
    const tagCol = String(col("tag", row) ?? "").trim().toUpperCase();
    const tag = tagCol || extraerTagDeDescripcion(descripcion);
    const critica = normalizarCritica(col("critica", row));
    const fase = faseFila(col("fase", row), fechaProg, opts.ejecucionDesde);
    const descripcionEquipo = String(col("descripcionEquipo", row) ?? "").trim();

    // "No. OT" con varios números ("921933 921927"): una fila por número.
    const numeros = numeroRaw.split(/[\s,;/]+/).filter((n) => /^\d{3,}$/.test(n));
    const lista = numeros.length > 0 ? numeros : [numeroRaw];

    for (const numeroOT of lista) {
      filas.push({
        numeroOT,
        descripcion: descripcion || `OT ${numeroOT}`,
        tag,
        descripcionEquipo,
        disciplina,
        fase,
        hhEstimadas,
        fechaProg,
        fechaProgFin,
        grupo,
        grupoCodigo,
        grupoNumero: null,
        responsable,
        critica,
      });
    }
  }

  asignarGruposSecuenciales(filas);
  return { filas, sinDisciplina, sinNumero, seccionesOmitidas, columnas };
}
