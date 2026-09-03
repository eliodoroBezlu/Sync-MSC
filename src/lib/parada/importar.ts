// Parser flexible del listado de OTs de una parada. El Excel real varía entre
// planificadores, así que en vez de índices fijos de columna mapeamos por
// NOMBRE de encabezado (normalizado) contra una lista de sinónimos.

import type { DisciplinaParada, FaseParada } from "./tipos";

export type CampoImport =
  | "numeroOT"
  | "descripcion"
  | "tag"
  | "descripcionEquipo"
  | "disciplina"
  | "fase"
  | "hhEstimadas"
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
  descripcion: ["descripcion", "job description", "detalle", "trabajo", "descripcion trabajo", "descripcion ot"],
  tag: ["tag", "equipo", "activo", "kks"],
  descripcionEquipo: ["descripcion de equipo", "descripcion equipo", "nombre equipo", "equipo descripcion"],
  disciplina: ["disciplina", "especialidad", "area", "gremio"],
  fase: ["fase", "etapa"],
  hhEstimadas: ["hh", "hh estimada", "hh estimadas", "horas hombre", "hh est", "hh plan"],
  fechaProg: ["fecha", "fecha prog", "fecha programada", "fecha inicio", "f inicio", "inicio", "fecha ejecucion"],
  fechaProgFin: ["fecha fin", "fecha final", "f fin", "fin", "fecha termino"],
  grupo: ["grupo", "turno", "cuadrilla"],
  responsable: ["responsable", "encargado", "supervisor"],
  critica: ["critica", "es critica", "ruta critica", "prioridad"],
};

/** Devuelve, por campo, el índice de columna en la fila de encabezados. */
export function mapearColumnas(encabezados: unknown[]): Partial<Record<CampoImport, number>> {
  const norm = encabezados.map(normalizarEncabezado);
  const mapa: Partial<Record<CampoImport, number>> = {};
  for (const [campo, alias] of Object.entries(SINONIMOS) as [CampoImport, string[]][]) {
    // coincidencia exacta primero, luego "empieza con" / "contiene"
    let idx = norm.findIndex((h) => h !== "" && alias.includes(h));
    if (idx === -1) {
      idx = norm.findIndex((h) => h !== "" && alias.some((a) => h === a || h.startsWith(`${a} `)));
    }
    if (idx === -1) {
      idx = norm.findIndex((h) => h !== "" && alias.some((a) => h.includes(a)));
    }
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

export function normalizarGrupo(v: unknown): "Dia" | "Noche" | "Ambos" {
  const s = normalizarEncabezado(v);
  if (/(noch|noct|night|^n$)/.test(s)) return "Noche";
  if (/(amb|both|d n|dia noche)/.test(s)) return "Ambos";
  return "Dia";
}

export function normalizarCritica(v: unknown): boolean {
  if (typeof v === "boolean") return v;
  const s = normalizarEncabezado(v);
  return /(si|sí|x|true|1|critic|alta|urgente|p1)/.test(s);
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
  responsable: string | null;
  critica: boolean;
}

export interface ResultadoParse {
  filas: FilaImportNormalizada[];
  sinDisciplina: number; // filas descartadas por disciplina no reconocida
  sinNumero: number; // filas sin N° OT
  columnas: Partial<Record<CampoImport, number>>;
}

/**
 * Convierte la matriz cruda de la hoja (fila 0 = encabezados) en filas
 * normalizadas listas para `prisma.paradaOt.create`.
 */
export function parseFilasOts(rows: unknown[][]): ResultadoParse {
  const filas: FilaImportNormalizada[] = [];
  let sinDisciplina = 0;
  let sinNumero = 0;

  if (rows.length < 2) {
    return { filas, sinDisciplina, sinNumero, columnas: {} };
  }

  const columnas = mapearColumnas(rows[0]);
  const col = (campo: CampoImport, row: unknown[]): unknown => {
    const i = columnas[campo];
    return i == null ? "" : row[i];
  };

  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    if (!row || row.every((c) => c === "" || c == null)) continue;

    const numeroOT = String(col("numeroOT", row) ?? "").trim();
    if (!numeroOT) {
      sinNumero++;
      continue;
    }

    const disciplina = normalizarDisciplina(col("disciplina", row));
    if (!disciplina) {
      sinDisciplina++;
      continue;
    }

    const responsable = String(col("responsable", row) ?? "").trim();
    filas.push({
      numeroOT,
      descripcion: String(col("descripcion", row) ?? "").trim() || `OT ${numeroOT}`,
      tag: String(col("tag", row) ?? "").trim().toUpperCase(),
      descripcionEquipo: String(col("descripcionEquipo", row) ?? "").trim(),
      disciplina,
      fase: normalizarFase(col("fase", row)),
      hhEstimadas: Number(col("hhEstimadas", row)) || 0,
      fechaProg: parseFechaImport(col("fechaProg", row)),
      fechaProgFin: parseFechaImport(col("fechaProgFin", row)),
      grupo: normalizarGrupo(col("grupo", row)),
      responsable: responsable || null,
      critica: normalizarCritica(col("critica", row)),
    });
  }

  return { filas, sinDisciplina, sinNumero, columnas };
}
