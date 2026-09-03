import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";
import { crearGrupoSchema, serialize, zodError } from "@/lib/parada/validacion";

type Ctx = { params: Promise<{ id: string }> };

// GET /api/paradas/[id]/grupos
export async function GET(_req: NextRequest, { params }: Ctx) {
  const { id } = await params;
  const grupos = await prisma.paradaGrupo.findMany({
    where: { paradaId: id },
    orderBy: [{ turno: "asc" }, { disciplina: "asc" }],
    include: { miembros: { orderBy: { nombre: "asc" } } },
  });
  return NextResponse.json(
    grupos.map((g) => ({ ...serialize(g), miembros: g.miembros.map((m) => serialize(m)) })),
  );
}

// POST /api/paradas/[id]/grupos — crea/actualiza un grupo (unique turno+disciplina).
// Si el body trae `miembros`, reemplaza el roster completo del grupo.
export async function POST(req: NextRequest, { params }: Ctx) {
  try {
    const { id } = await params;
    const parsed = crearGrupoSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ ok: false, error: zodError(parsed.error) }, { status: 400 });
    }
    const d = parsed.data;
    const grupo = await prisma.paradaGrupo.upsert({
      where: {
        paradaId_turno_disciplina: {
          paradaId: id,
          turno: d.turno,
          disciplina: d.disciplina,
        },
      },
      create: {
        paradaId: id,
        turno: d.turno,
        disciplina: d.disciplina,
        supervisorNombre: d.supervisorNombre,
        supervisorUsuarioId: d.supervisorUsuarioId ?? null,
        dotacionPropia: d.dotacionPropia,
        dotacionApoyo: d.dotacionApoyo,
      },
      update: {
        supervisorNombre: d.supervisorNombre,
        supervisorUsuarioId: d.supervisorUsuarioId ?? null,
        dotacionPropia: d.dotacionPropia,
        dotacionApoyo: d.dotacionApoyo,
      },
    });

    if (d.miembros) {
      await prisma.$transaction([
        prisma.paradaGrupoMiembro.deleteMany({ where: { paradaGrupoId: grupo.id } }),
        prisma.paradaGrupoMiembro.createMany({
          data: d.miembros.map((m) => ({
            paradaGrupoId: grupo.id,
            usuarioId: m.usuarioId ?? null,
            nombre: m.nombre,
            esLider: m.esLider,
          })),
        }),
      ]);
    }

    const conMiembros = await prisma.paradaGrupo.findUnique({
      where: { id: grupo.id },
      include: { miembros: { orderBy: { nombre: "asc" } } },
    });
    return NextResponse.json(
      {
        ok: true,
        grupo: conMiembros
          ? { ...serialize(conMiembros), miembros: conMiembros.miembros.map((m) => serialize(m)) }
          : serialize(grupo),
      },
      { status: 201 },
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Error interno";
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}
