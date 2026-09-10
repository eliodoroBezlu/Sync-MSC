import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";
import { serialize } from "@/lib/parada/validacion";

// GET /api/paradas/activa?fecha=YYYY-MM-DD
// GET /api/paradas/activa?desde=YYYY-MM-DD&hasta=YYYY-MM-DD
//
// Devuelve la parada NO cerrada cuyo rango de ejecución cruza el día `fecha`
// (por defecto hoy) o el rango `[desde, hasta]`, junto con sus OTs y los avances
// diarios de esa ventana. Se acepta también estado "preparativos": el personal
// necesita ver sus OT de parada para prepararse antes de que alguien marque la
// parada como "ejecucion", y "Registro de OT" muestra la semana completa aunque
// hoy quede fuera del rango de la parada. No toca el flujo semanal.
function parseDia(valor: string | null): Date | null {
  if (!valor) return null;
  const d = new Date(`${valor}T12:00:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

// Normaliza un nombre para comparar: sin acentos, minúsculas, espacios simples.
function normNombre(s: string): string {
  let out = "";
  for (const ch of s.normalize("NFD")) {
    const c = ch.codePointAt(0) ?? 0;
    if (c >= 0x300 && c <= 0x36f) continue; // marcas combinantes
    out += ch;
  }
  return out.trim().toLowerCase().replace(/\s+/g, " ");
}

// ¿Los dos nombres refieren a la misma persona? (≥ 2 palabras compartidas).
function mismoNombre(a: string, b: string): boolean {
  const na = normNombre(a);
  const nb = normNombre(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  const ta = na.split(" ").filter(Boolean);
  const tb = nb.split(" ").filter(Boolean);
  return ta.filter((t) => tb.includes(t)).length >= 2;
}

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const desdeParam = parseDia(sp.get("desde"));
  const hastaParam = parseDia(sp.get("hasta"));

  // Ventana a comparar contra el rango de la parada: rango [desde, hasta] si se
  // pide, si no el día `fecha` (o hoy) completo [00:00, 23:59:59.999].
  let iniDia: Date;
  let finDia: Date;
  if (desdeParam || hastaParam) {
    const a = desdeParam ?? hastaParam!;
    const b = hastaParam ?? desdeParam!;
    iniDia = new Date(Math.min(a.getTime(), b.getTime()));
    iniDia.setHours(0, 0, 0, 0);
    finDia = new Date(Math.max(a.getTime(), b.getTime()));
    finDia.setHours(23, 59, 59, 999);
  } else {
    const base = parseDia(sp.get("fecha")) ?? new Date();
    if (Number.isNaN(base.getTime())) {
      return NextResponse.json({ ok: false, error: "fecha inválida" }, { status: 400 });
    }
    iniDia = new Date(base);
    iniDia.setHours(0, 0, 0, 0);
    finDia = new Date(base);
    finDia.setHours(23, 59, 59, 999);
  }

  const parada = await prisma.parada.findFirst({
    where: {
      estado: { not: "cerrada" },
      fechaEjecucionInicio: { lte: finDia },
      fechaEjecucionFin: { gte: iniDia },
    },
    orderBy: { fechaEjecucionInicio: "desc" },
    include: {
      ots: { orderBy: [{ orden: "asc" }, { numeroOT: "asc" }] },
    },
  });

  if (!parada) return NextResponse.json({ ok: true, parada: null });

  const avances = await prisma.paradaAvanceDiario.findMany({
    where: {
      paradaId: parada.id,
      fecha: { gte: iniDia, lte: finDia },
    },
  });

  // "Registro de OT" sólo debe listar personal CON cuenta de usuario: las
  // cuadrillas de parada de planta traen decenas de contratistas sin cuenta que
  // llenaban la pantalla del técnico en el celular. Reemplazamos personalAsignado
  // por los nombres canónicos de los usuarios asignados (por ID; y por nombre
  // para OT viejas que guardaron nombres pero no IDs).
  const idsAsignados = [
    ...new Set(parada.ots.flatMap((o) => o.personalAsignadoIds)),
  ];
  const faltanIds = parada.ots.some(
    (o) => o.personalAsignadoIds.length === 0 && o.personalAsignado.length > 0,
  );
  const usuarios = await prisma.usuario.findMany({
    where: faltanIds ? { activo: true } : { id: { in: idsAsignados } },
    select: { id: true, nombre: true, apellido: true },
  });
  const nombreDe = (u: { nombre: string; apellido: string | null }) =>
    [u.nombre, u.apellido].filter(Boolean).join(" ").trim();
  const nombrePorId = new Map(usuarios.map((u) => [u.id, nombreDe(u)]));

  const ots = parada.ots.map((o) => {
    const ids = new Set<string>(o.personalAsignadoIds);
    if (ids.size === 0 && o.personalAsignado.length > 0) {
      for (const n of o.personalAsignado) {
        const u = usuarios.find((x) => mismoNombre(nombreDe(x), n));
        if (u) ids.add(u.id);
      }
    }
    const nombres = [...ids]
      .map((id) => nombrePorId.get(id))
      .filter((x): x is string => !!x);
    return { ...serialize(o), personalAsignadoIds: [...ids], personalAsignado: nombres };
  });

  return NextResponse.json({
    ok: true,
    parada: {
      ...serialize(parada),
      ots,
      avancesHoy: avances.map((a) => serialize(a)),
    },
  });
}
