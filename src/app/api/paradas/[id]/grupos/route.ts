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
  });
  return NextResponse.json(grupos.map((g) => serialize(g)));
}

// POST /api/paradas/[id]/grupos — crea/actualiza un grupo (unique turno+disciplina).
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
    return NextResponse.json({ ok: true, grupo: serialize(grupo) }, { status: 201 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Error interno";
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}
