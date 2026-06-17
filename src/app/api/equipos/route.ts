import { prisma } from "@/lib/prisma";
import { NextRequest } from "next/server";

const MAPEO_JDE: Record<string, string> = {
  EMT: "MOTORES", MIL: "MOTORES", AEM: "VARIADORES DE FREC",
  PTF: "TRANSFORMADORES", TRF: "TRANSFORMADORES", PGC: "GENERADORES",
  PMP: "BOMBAS", VLV: "VALVULAS", CMP: "COMPRESORES",
  TPM: "CAJAS ENGR", HDS: "SIST HIDRÁULICOS", LBS: "SIST LUBRICACIÓN",
  SLC: "CINTAS", TNS: "TANQUES", SNT: "SENSORES",
  HLE: "PUENTES GRUA", HTE: "INTERCAMBIADORES", GAH: "PULMONES AIRE",
  VTE: "PULMONES AIRE", FLH: "TUBERIAS", FLT: "TUBERIAS", PRF: "TUBERIAS",
};

function enriquecer(eq: Record<string, unknown>): Record<string, unknown> {
  if (eq.categoriaISO) return eq;
  const cat = MAPEO_JDE[eq.tipoEquipo as string] ?? null;
  return cat ? { ...eq, categoriaISO: cat } : eq;
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const q      = searchParams.get("q") || "";
  const area   = searchParams.get("area");
  const all    = searchParams.get("all") === "true";
  const nivel  = searchParams.get("nivel");
  const parent = searchParams.get("parent");
  const tipo   = searchParams.get("tipo");
  const crit   = searchParams.get("crit");
  const tag    = searchParams.get("tag");
  const limit  = Math.min(Number(searchParams.get("limit") || (all ? "5000" : "20")), 5000);
  const page   = Number(searchParams.get("page") || "0");

  const equipos = await prisma.equipo.findMany({
    where: {
      ...(all ? {} : { activo: true }),
      ...(tag  ? { tag: tag.toUpperCase() } : {}),
      ...(q.length >= 2 && !tag ? {
        OR: [
          { tag: { contains: q.toUpperCase() } },
          { descripcion: { contains: q, mode: "insensitive" } },
        ],
      } : {}),
      ...(area   ? { areaCodigo: area } : {}),
      ...(nivel  ? { nivel: Number(nivel) } : {}),
      ...(parent ? { parentTag: parent.toUpperCase() } : {}),
      ...(tipo   ? { tipoEquipo: tipo } : {}),
      ...(crit   ? { criticidad: crit } : {}),
    },
    orderBy: (q.length >= 2 || tag)
      ? { tag: "asc" }
      : [{ areaCodigo: "asc" }, { nivel: "asc" }, { tag: "asc" }],
    take: (q.length >= 2 && !all) ? Math.min(limit * 3, 60) : limit,
    skip: page * limit,
  });

  return Response.json(equipos.map(e => enriquecer({ ...e, _id: e.id })));
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    if (Array.isArray(body)) {
      let inserted = 0, modified = 0;
      for (const eq of body) {
        const tag = String(eq.tag).toUpperCase().trim();
        // Ensure area exists before inserting equipment (FK constraint)
        if (eq.areaCodigo && eq.areaCodigo !== "0") {
          await prisma.area.upsert({
            where: { codigo: String(eq.areaCodigo) },
            update: {},
            create: {
              codigo: String(eq.areaCodigo),
              nombre: String(eq.descripcionArea || eq.areaCodigo),
              superintendencia: "",
            },
          });
        }
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { descripcionArea, ...eqData } = eq as Record<string, unknown>;
        const existing = await prisma.equipo.findUnique({ where: { tag } });
        if (existing) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          await prisma.equipo.update({ where: { tag }, data: eqData as any });
          modified++;
        } else {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          await prisma.equipo.create({ data: { ...(eqData as any), tag } });
          inserted++;
        }
      }
      return Response.json({ ok: true, inserted, modified }, { status: 201 });
    }

    const tag = String(body.tag).toUpperCase().trim();
    const equipo = await prisma.equipo.upsert({
      where: { tag },
      update: body,
      create: { ...body, tag },
    });
    return Response.json({ ok: true, equipo: { ...equipo, _id: equipo.id } }, { status: 201 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Error interno";
    return Response.json({ ok: false, error: message }, { status: 400 });
  }
}
