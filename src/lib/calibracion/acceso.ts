import { NextRequest, NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { COOKIE_NAME, verifyToken } from "@/lib/auth";
import { ErrorImportacion } from "./importar.ts";

export const ROLES_IMPORTACION = [1, 2]; // Admin, Superintendente
export const MAX_BYTES_EXCEL = 25 * 1024 * 1024;

export const MAX_FILAS_EXCEL = 100_000;

type Fila = (string | number | null)[];

function respuestaInvalida(error: string): NextResponse {
  return NextResponse.json({ ok: false, error }, { status: 400 });
}

/** Respuesta de error de importación: solo expone el mensaje si es de validación propia. */
export function errorImportacion(err: unknown, generico: string): NextResponse {
  if (err instanceof ErrorImportacion) return respuestaInvalida(err.message);
  console.error(generico, err);
  return NextResponse.json({ ok: false, error: generico }, { status: 500 });
}

/** Devuelve la respuesta de error si no hay sesión o el rol no alcanza; null si puede seguir. */
export async function exigirRol(
  req: NextRequest,
  roles: readonly number[],
): Promise<NextResponse | null> {
  const token = req.cookies.get(COOKIE_NAME)?.value;
  const sesion = token ? await verifyToken(token) : null;
  if (!sesion) return NextResponse.json({ ok: false, error: "No autenticado" }, { status: 401 });
  if (!roles.includes(sesion.rol)) {
    return NextResponse.json({ ok: false, error: "Sin permiso para esta acción" }, { status: 403 });
  }
  return null;
}

/** Lee el .xlsx del campo "archivo" del formulario y devuelve las filas de la hoja pedida. */
export async function leerHoja(
  req: NextRequest,
  nombreHoja: string,
): Promise<{ filas: Fila[] } | { error: NextResponse }> {
  const form = await req.formData().catch(() => null);
  const archivo = form?.get("archivo");
  if (!(archivo instanceof File)) {
    return { error: NextResponse.json({ ok: false, error: "Falta el archivo" }, { status: 400 }) };
  }
  if (!archivo.name.toLowerCase().endsWith(".xlsx") || archivo.size > MAX_BYTES_EXCEL) {
    return {
      error: NextResponse.json(
        { ok: false, error: "Debe ser un .xlsx de hasta 25 MB" },
        { status: 400 },
      ),
    };
  }
  const bytes = Buffer.from(await archivo.arrayBuffer());
  if (bytes.subarray(0, 4).toString("latin1") !== "PK\u0003\u0004") {
    return { error: respuestaInvalida("El archivo no es un .xlsx válido") };
  }
  let libro: XLSX.WorkBook;
  try {
    libro = XLSX.read(bytes, {
      type: "buffer",
      sheets: nombreHoja,
      cellFormula: false,
      cellHTML: false,
      cellStyles: false,
    });
  } catch {
    return { error: respuestaInvalida("No se pudo leer el archivo Excel") };
  }
  const hoja = libro.Sheets[nombreHoja];
  if (!hoja) return { error: respuestaInvalida(`No se encontró la hoja "${nombreHoja}"`) };
  const rango = hoja["!ref"] ? XLSX.utils.decode_range(hoja["!ref"]) : null;
  if (rango && rango.e.r - rango.s.r + 1 > MAX_FILAS_EXCEL) {
    return { error: respuestaInvalida(`La hoja supera el máximo de ${MAX_FILAS_EXCEL} filas`) };
  }
  const filas = XLSX.utils.sheet_to_json<Fila>(hoja, { header: 1, raw: false, defval: "" });
  return { filas };
}
