// GET /api/calibracion/cumplimiento?anio=2026&vista=mes|semana&origen=todos|WG|Parada
// KPI programado vs ejecutado. Lo "ejecutado" sale de RegistroCalibracion, no de
// la columna Estado del Excel.
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { exigirRol } from "@/lib/calibracion/acceso";
import {
  agruparPorPeriodo,
  evaluarPrograma,
  totalizar,
  TOLERANCIA_ADELANTO_DIAS,
} from "@/lib/calibracion/cumplimiento";
import {
  addDays,
  dateToYmdBolivia,
  dateToYmdUtc,
  claveSemana,
  mesDe,
  normalizarTag,
  ymdToDateUtc,
  ymdToFechaBolivia,
} from "@/lib/calibracion/fechas";

export const runtime = "nodejs";

const TODOS_LOS_ROLES = [1, 2, 3, 4, 5];
const MAX_VENCIDAS = 300;

const consulta = z.object({
  anio: z.coerce.number().int().min(2014).max(2100).optional(),
  vista: z.enum(["mes", "semana"]).default("mes"),
  origen: z.enum(["todos", "WG", "Parada"]).default("todos"),
});

export async function GET(req: NextRequest) {
  const denegado = await exigirRol(req, TODOS_LOS_ROLES);
  if (denegado) return denegado;

  const parsed = consulta.safeParse(Object.fromEntries(new URL(req.url).searchParams));
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "Parámetros inválidos" }, { status: 400 });
  }
  const { vista, origen } = parsed.data;
  const hoy = dateToYmdBolivia(new Date());
  const anio = parsed.data.anio ?? Number(hoy.slice(0, 4));
  const inicio = `${anio}-01-01`;
  const fin = `${anio}-12-31`;
  const desdeRegistros = addDays(inicio, -TOLERANCIA_ADELANTO_DIAS - 60);

  const [programa, registros] = await Promise.all([
    prisma.programaCalibracion.findMany({
      where: { fechaPlan: { gte: ymdToDateUtc(desdeRegistros), lte: ymdToDateUtc(addDays(fin, 60)) } },
      select: { id: true, tag: true, fechaPlan: true, origen: true, programa: true, frecuenciaDias: true },
    }),
    prisma.registroCalibracion.findMany({
      where: { fecha: { gte: ymdToFechaBolivia(desdeRegistros) } },
      select: { tag: true, fecha: true },
    }),
  ]);

  const items = programa.map((p) => ({ ...p, fechaPlan: dateToYmdUtc(p.fechaPlan) }));
  const regs = registros.map((r) => ({ tag: normalizarTag(r.tag), fecha: dateToYmdBolivia(r.fecha) }));
  const evaluacion = evaluarPrograma(items, regs, hoy);

  const delAnio = evaluacion.items.filter(
    (i) => i.fechaPlan >= inicio && i.fechaPlan <= fin && (origen === "todos" || i.origen === origen),
  );
  const fechasRegistros = regs.map((r) => r.fecha);
  const periodos = agruparPorPeriodo(delAnio, vista, fechasRegistros, hoy);
  const clavePeriodo = (f: string): string => (vista === "mes" ? mesDe(f) : claveSemana(f));
  const periodosConDatos = new Set(fechasRegistros.map(clavePeriodo));

  const todasVencidas = delAnio
    .filter((i) => i.estado === "vencida" && periodosConDatos.has(clavePeriodo(i.fechaPlan)))
    .sort((a, b) => (b.diasAtraso ?? 0) - (a.diasAtraso ?? 0));
  const vencidas = todasVencidas
    .slice(0, MAX_VENCIDAS)
    .map(({ tag, fechaPlan, origen: o, programa: p, diasAtraso }) => ({
      tag,
      fechaPlan,
      origen: o,
      programa: p,
      diasAtraso,
    }));

  const enAnio = (f: string | null): boolean => f !== null && f >= inicio && f <= fin;
  const registrosDelAnio = regs.filter((r) => enAnio(r.fecha)).length;
  const reclamadosDelAnio = evaluacion.items.filter((i) => enAnio(i.fechaRealizada)).length;

  return NextResponse.json({
    ok: true,
    anio,
    vista,
    hoy,
    programaCargado: programa.length > 0,
    periodos,
    resumen: totalizar(periodos),
    vencidas,
    totalVencidas: todasVencidas.length,
    fueraDePrograma: Math.max(0, registrosDelAnio - reclamadosDelAnio),
  });
}
