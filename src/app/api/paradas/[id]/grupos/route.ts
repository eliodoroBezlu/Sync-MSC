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
      // OT: se replica a `personalAsignado` de esas OT (disciplina salvo MIXTO)
      // para que el técnico las vea en "Registro de OT". Cada turno guarda su
      // cuadrilla en su propio slot: día → grupoNumero, noche → grupoNumeroNoche.
      const idsMiembros = d.miembros
        .map((m) => m.usuarioId)
        .filter((x): x is string => !!x);
      const nombresMiembros = d.miembros.map((m) => m.nombre);
      const discWhere = d.disciplina !== "MIXTO" ? { disciplina: d.disciplina } : {};
      const esDia = d.turno === "Dia";
      const norm = (s: string) =>
        s.normalize("NFD").replace(/\p{Diacritic}/gu, "").trim().toUpperCase();

      // OT que ejecuta SÓLO esta cuadrilla (un único turno): personal = su roster.
      //  - día: grupoNumero = N y no está compartida con la noche.
      //  - noche: grupoNumeroNoche = N (o modelo viejo: grupo "Noche" + grupoNumero = N).
      const soloEsteTurnoWhere = esDia
        ? {
            paradaId: id,
            grupoNumero: d.numero,
            grupoNumeroNoche: null,
            grupo: { not: "Noche" },
            ...discWhere,
          }
        : {
            paradaId: id,
            grupo: "Noche",
            ...discWhere,
            OR: [
              { grupoNumeroNoche: d.numero },
              { grupoNumeroNoche: null, grupoNumero: d.numero },
            ],
          };

      // OT compartidas día/noche donde participa esta cuadrilla: su personal es
      // la UNIÓN del roster de su cuadrilla de día (grupoNumero) y el de su
      // cuadrilla de noche (grupoNumeroNoche), que pueden tener números distintos
      // (p. ej. Grupo 8 diurno + Grupo 9 nocturno comparten la misma OT).
      const compartidas = await prisma.paradaOt.findMany({
        where: esDia
          ? { paradaId: id, grupo: "Ambos", grupoNumero: d.numero, ...discWhere }
          : { paradaId: id, grupo: "Ambos", grupoNumeroNoche: d.numero, ...discWhere },
        select: { id: true, grupoNumero: true, grupoNumeroNoche: true },
      });

      const numsDia = new Set<number>();
      const numsNoche = new Set<number>();
      for (const o of compartidas) {
        if (o.grupoNumero != null) numsDia.add(o.grupoNumero);
        if (o.grupoNumeroNoche != null) numsNoche.add(o.grupoNumeroNoche);
      }
      const hermanas = await prisma.paradaGrupo.findMany({
        where: {
          paradaId: id,
          disciplina: d.disciplina,
          OR: [
            { turno: "Dia", numero: { in: [...numsDia] } },
            { turno: "Noche", numero: { in: [...numsNoche] } },
          ],
        },
        include: { miembros: true },
      });
      const rosterDe = (
        turno: "Dia" | "Noche",
        numero: number,
      ): { nombre: string; usuarioId: string | null }[] => {
        const src =
          turno === d.turno && numero === d.numero
            ? d.miembros ?? []
            : hermanas.find((h) => h.turno === turno && h.numero === numero)?.miembros ?? [];
        return src.map((m) => ({ nombre: m.nombre, usuarioId: m.usuarioId ?? null }));
      };

      const updatesCompartidas = compartidas.map((o) => {
        const nombres: string[] = [];
        const vistos = new Set<string>();
        const ids = new Set<string>();
        const union = [
          ...(o.grupoNumero != null ? rosterDe("Dia", o.grupoNumero) : []),
          ...(o.grupoNumeroNoche != null ? rosterDe("Noche", o.grupoNumeroNoche) : []),
        ];
        for (const m of union) {
          const k = norm(m.nombre);
          if (k && !vistos.has(k)) {
            vistos.add(k);
            nombres.push(m.nombre);
          }
          if (m.usuarioId) ids.add(m.usuarioId);
        }
        return prisma.paradaOt.update({
          where: { id: o.id },
          data: { personalAsignado: nombres, personalAsignadoIds: [...ids] },
        });
      });

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
        prisma.paradaOt.updateMany({
          where: soloEsteTurnoWhere,
          data: { personalAsignado: nombresMiembros, personalAsignadoIds: idsMiembros },
        }),
        ...updatesCompartidas,
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
