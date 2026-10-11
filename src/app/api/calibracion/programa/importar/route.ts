// POST /api/calibracion/programa/importar — carga el programa de calibración
// (hoja "Base Datos Calibracion"). Solo toma TAG, fecha planificada y metadatos:
// ignora las columnas Estado y Fecha Realizada (no son confiables).
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { errorImportacion, exigirRol, leerHoja, ROLES_IMPORTACION } from "@/lib/calibracion/acceso";
import { parsePrograma } from "@/lib/calibracion/importar";
import { ymdToDateUtc } from "@/lib/calibracion/fechas";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const denegado = await exigirRol(req, ROLES_IMPORTACION);
  if (denegado) return denegado;

  const hoja = await leerHoja(req, "Base Datos Calibracion");
  if ("error" in hoja) return hoja.error;

  try {
    const [encabezado, ...datos] = hoja.filas;
    const { filas, omitidas } = parsePrograma(encabezado ?? [], datos);

    const resultados = await prisma.$transaction(
      filas.map((f) =>
        prisma.programaCalibracion.upsert({
          where: {
            tag_fechaPlan_programa: {
              tag: f.tag,
              fechaPlan: ymdToDateUtc(f.fechaPlan),
              programa: f.programa,
            },
          },
          create: { ...f, fechaPlan: ymdToDateUtc(f.fechaPlan) },
          update: {
            semanaIso: f.semanaIso,
            frecuenciaDias: f.frecuenciaDias,
            origen: f.origen,
            otModelo: f.otModelo,
            tipoServicio: f.tipoServicio,
            horasEstimadas: f.horasEstimadas,
          },
          select: { createdAt: true, updatedAt: true },
        }),
      ),
    );
    const nuevas = resultados.filter((r) => r.createdAt.getTime() === r.updatedAt.getTime()).length;
    return NextResponse.json({
      ok: true,
      leidas: filas.length,
      nuevas,
      actualizadas: filas.length - nuevas,
      omitidas,
    });
  } catch (err) {
    return errorImportacion(err, "Error al importar el programa");
  }
}
