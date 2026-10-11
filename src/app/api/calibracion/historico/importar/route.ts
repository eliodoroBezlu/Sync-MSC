// POST /api/calibracion/historico/importar — carga la planilla histórica
// 2014-2026 como registros con origen "historico". Es idempotente: el número de
// certificado es determinista (HIST-fecha-N°-TAG) y se omiten los ya cargados.
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { errorImportacion, exigirRol, leerHoja, ROLES_IMPORTACION } from "@/lib/calibracion/acceso";
import { parseHistorico } from "@/lib/calibracion/importar";
import { ymdToFechaBolivia } from "@/lib/calibracion/fechas";

export const runtime = "nodejs";
export const maxDuration = 300;

const FILAS_ENCABEZADO = 6;
const TAMANO_LOTE = 1000;
const AREA_DEFECTO = "3320";

export async function POST(req: NextRequest) {
  const denegado = await exigirRol(req, ROLES_IMPORTACION);
  if (denegado) return denegado;

  const hoja = await leerHoja(req, "ci_ReporteCalibracionPlanilla");
  if ("error" in hoja) return hoja.error;

  try {
    const { filas, omitidas } = parseHistorico(hoja.filas.slice(FILAS_ENCABEZADO));
    let nuevas = 0;

    for (let i = 0; i < filas.length; i += TAMANO_LOTE) {
      const lote = filas.slice(i, i + TAMANO_LOTE).map((c) => ({
        numeroCertificado: c.numeroCertificado,
        tag: c.tag,
        descripcionInstrumento: "",
        tipoVariable: "",
        tecnicoId: "historico",
        tecnicoNombre: c.responsable || "Histórico",
        fecha: ymdToFechaBolivia(c.fecha),
        puntos: c.puntos,
        puntosAntes: c.puntosAntes,
        resultadoGeneral: "APROBADO",
        otAsociada: c.otAsociada,
        areaCodigo: AREA_DEFECTO,
        estado: "aprobado",
        origen: "historico",
      }));
      const res = await prisma.registroCalibracion.createMany({ data: lote, skipDuplicates: true });
      nuevas += res.count;
    }

    return NextResponse.json({
      ok: true,
      leidas: filas.length,
      nuevas,
      yaExistian: filas.length - nuevas,
      omitidas,
    });
  } catch (err) {
    return errorImportacion(err, "Error al importar el histórico");
  }
}
