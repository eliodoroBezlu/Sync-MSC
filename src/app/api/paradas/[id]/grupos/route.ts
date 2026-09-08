import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";
import { crearGrupoSchema, serialize, zodError } from "@/lib/parada/validacion";

type Ctx = { params: Promise<{ id: string }> };

// GET /api/paradas/[id]/grupos
export async function GET(_req: NextRequest, { params }: Ctx) {
  const { id } = await params;
  const grupos = await prisma.paradaGrupo.findMany({
    where: { paradaId: id },
    orderBy: [{ turno: "asc" }, { disciplina: "asc" }, { numero: "asc" }],
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
        paradaId_turno_disciplina_numero: {
          paradaId: id,
          turno: d.turno,
          disciplina: d.disciplina,
          numero: d.numero,
        },
      },
      create: {
        paradaId: id,
        turno: d.turno,
        disciplina: d.disciplina,
        numero: d.numero,
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
      // El roster de la cuadrilla es la fuente de verdad de quién ejecuta SUS
      // OT: se replica a las OT de esta cuadrilla (mismo grupoNumero + turno, y
      // disciplina salvo MIXTO) para que el técnico las vea en "Registro de OT".
      const idsMiembros = d.miembros
        .map((m) => m.usuarioId)
        .filter((x): x is string => !!x);
      const nombresMiembros = d.miembros.map((m) => m.nombre);
      const discWhere = d.disciplina !== "MIXTO" ? { disciplina: d.disciplina } : {};

      // Caso especial "Ambos": una misma cuadrilla (mismo número) trabaja la OT
      // en día y en noche. Su personal debe ser la UNIÓN de los dos turnos; si
      // no, cada guardado de un turno borraría a la gente del otro. Buscamos la
      // cuadrilla hermana (mismo número y disciplina, turno opuesto) y unimos.
      const turnoOpuesto = d.turno === "Dia" ? "Noche" : "Dia";
      const hermana = await prisma.paradaGrupo.findUnique({
        where: {
          paradaId_turno_disciplina_numero: {
            paradaId: id,
            turno: turnoOpuesto,
            disciplina: d.disciplina,
            numero: d.numero,
          },
        },
        include: { miembros: true },
      });
      const norm = (s: string) =>
        s.normalize("NFD").replace(/\p{Diacritic}/gu, "").trim().toUpperCase();
      const nombresUnion: string[] = [];
      const vistosUnion = new Set<string>();
      const idsUnion = new Set<string>();
      for (const m of [...d.miembros, ...(hermana?.miembros ?? [])]) {
        const k = norm(m.nombre);
        if (k && !vistosUnion.has(k)) {
          vistosUnion.add(k);
          nombresUnion.push(m.nombre);
        }
        if (m.usuarioId) idsUnion.add(m.usuarioId);
      }

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
        // OT propias de este turno: personal = roster de esta cuadrilla.
        prisma.paradaOt.updateMany({
          where: { paradaId: id, grupoNumero: d.numero, grupo: d.turno, ...discWhere },
          data: { personalAsignado: nombresMiembros, personalAsignadoIds: idsMiembros },
        }),
        // OT compartidas día/noche: personal = unión de las dos cuadrillas.
        prisma.paradaOt.updateMany({
          where: { paradaId: id, grupoNumero: d.numero, grupo: "Ambos", ...discWhere },
          data: { personalAsignado: nombresUnion, personalAsignadoIds: [...idsUnion] },
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
