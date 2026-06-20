import { prisma } from "@/lib/prisma";
import { NextRequest } from "next/server";

// Formato: {seq}_{TAG}_{YYMMDD}
// El número secuencial se deriva del máximo real en la BD — nunca de un contador externo.
// Esto garantiza que ningún deploy, reinicio o desincronización pueda generar números incorrectos.
const BASE_2026 = 277; // todos los certs de 2026 deben ser > 277

async function siguienteCertificado(tag: string, fecha: string): Promise<string> {
  const dateStr = fecha.slice(2, 10).replace(/-/g, ""); // YYMMDD
  const tagLimpio = tag.replace(/[/\\*?:"<>| ]/g, "").toUpperCase();

  // Calcular el siguiente número desde el máximo real existente en la BD
  const todos = await prisma.registroCalibracion.findMany({ select: { numeroCertificado: true } });
  const maxUsado = todos.reduce((max, r) => {
    const n = parseInt(r.numeroCertificado.split("_")[0], 10);
    return !isNaN(n) && n > max ? n : max;
  }, BASE_2026);

  return `${maxUsado + 1}_${tagLimpio}_${dateStr}`;
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const tag               = searchParams.get("tag");
  const resultado         = searchParams.get("resultado");
  const fechaDesde        = searchParams.get("fechaDesde");
  const fechaHasta        = searchParams.get("fechaHasta");
  const incluirArchivados = searchParams.get("incluirArchivados") === "true";
  const limit             = Math.min(Number(searchParams.get("limit") || "50"), 200);

  // Capa 3: auto-archivo — excluir registros >90 días salvo que se pida historial completo
  // y no haya filtro de fecha propio del cliente.
  const ARCHIVO_DIAS = 90;
  const fechaArchivoCorte = new Date();
  fechaArchivoCorte.setDate(fechaArchivoCorte.getDate() - ARCHIVO_DIAS);
  const aplicarFiltroArchivo = !incluirArchivados && !fechaDesde && !fechaHasta && !tag;

  let fechaFilter: Record<string, Date> = {};
  if (fechaDesde || fechaHasta) {
    if (fechaDesde) fechaFilter.gte = new Date(fechaDesde);
    if (fechaHasta) {
      const h = new Date(fechaHasta);
      h.setDate(h.getDate() + 1);
      fechaFilter.lt = h;
    }
  } else if (aplicarFiltroArchivo) {
    fechaFilter.gte = fechaArchivoCorte;
  }

  const registros = await prisma.registroCalibracion.findMany({
    where: {
      ...(tag       ? { tag: { contains: tag, mode: "insensitive" } } : {}),
      ...(resultado ? { resultadoGeneral: resultado } : {}),
      ...(Object.keys(fechaFilter).length ? { fecha: fechaFilter } : {}),
    },
    orderBy: { fecha: "desc" },
    take: limit,
  });

  return Response.json(registros.map(r => ({ ...r, _id: r.id })));
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const numeroCertificado = await siguienteCertificado(
      String(body.tag).toUpperCase(),
      body.fecha ?? new Date().toISOString().slice(0, 10),
    );

    const registro = await prisma.registroCalibracion.create({
      data: {
        numeroCertificado,
        tag: String(body.tag).toUpperCase(),
        descripcionInstrumento: body.descripcionInstrumento,
        tipoVariable: body.tipoVariable,
        patronIds: body.patronIds ?? [],
        patronCodigos: body.patronCodigos ?? [],
        tecnicoId: body.tecnicoId,
        tecnicoNombre: body.tecnicoNombre,
        supervisorId: body.supervisorId ?? null,
        supervisorNombre: body.supervisorNombre ?? null,
        fecha: new Date(body.fecha),
        temperatura: body.temperatura ?? null,
        humedad: body.humedad ?? null,
        turno: body.turno ?? null,
        unidad: body.unidad ?? null,
        puntos: body.puntos,
        puntosAntes: body.puntosAntes ?? [],
        resultadoGeneral: body.resultadoGeneral,
        observaciones: body.observaciones ?? null,
        otAsociada: body.otAsociada ?? null,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ...({ estado: body.estado ?? "revision" } as any),
        tecnicoFirma: body.tecnicoFirma ?? null,
        supervisorFirma: body.supervisorFirma ?? null,
        areaCodigo: "3320",
      },
    });

    return Response.json(
      { ok: true, registro: { ...registro, _id: registro.id } },
      { status: 201 }
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Error interno";
    return Response.json({ ok: false, error: message }, { status: 400 });
  }
}
