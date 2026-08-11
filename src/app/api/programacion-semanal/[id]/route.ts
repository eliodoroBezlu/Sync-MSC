import { prisma } from "@/lib/prisma";
import { NextRequest } from "next/server";
import { verifyToken, COOKIE_NAME } from "@/lib/auth";
import { reconciliarTurnosGuardia } from "@/lib/planificacion/reconciliarTurnosGuardia";
import { esOpeplant } from "@/lib/opeplant";

type Ctx = { params: Promise<{ id: string }> };

const include = { otsProgramadas: true, personal: true, resumenDias: true };

function serialize(p: Record<string, unknown>) {
  return { ...p, _id: p.id };
}

const DIA_ORDEN = ["Lu", "Ma", "Mi", "Ju", "Vi", "Sa", "Do"];

// Motivos que implican que el trabajo quedó parado esperando algo externo
// (no depende del técnico) -> la fila del día siguiente nace "bloqueada" para
// que el supervisor la note. "Falta de tiempo" es una continuación normal,
// nace "en_proceso" como cualquier OT en curso.
const MOTIVOS_BLOQUEAN = new Set([
  "Falta de materiales",
  "Coordinación pendiente",
  "Equipo no disponible",
]);

type OtProgramadaRow = {
  id: string; programacionSemanalId: string; numeroOT: string; tipoOT: string;
  tipoTrabajo: string; prioridad: string | null; descripcion: string; tag: string;
  descripcionEquipo: string | null; personas: number; hrsTrabajo: number; hhTotal: number;
  personalAsignado: string[]; personalAsignadoIds: string[]; grupo: string; dia: string;
  ordenTrabajoId: string | null; ordenTrabajoNum: string | null; esGuardia: boolean;
};

// Crea (best-effort) la fila del día siguiente enlazada a la misma OrdenTrabajo,
// para que la continuación aparezca programada sin que el técnico tenga que
// buscarla manualmente. Si el día siguiente cruza a la próxima semana y esa
// semana todavía no tiene plan publicado, no se crea nada (se seguirá
// pudiendo registrar el avance a mano, como ya funcionaba antes de esta
// función) — es deliberadamente best-effort, no debe romper el flujo principal.
async function crearFilaContinuacion(
  fila: OtProgramadaRow,
  estadoNueva: string
): Promise<void> {
  const idxActual = DIA_ORDEN.indexOf(fila.dia);
  if (idxActual < 0) return;

  let programacionSemanalId = fila.programacionSemanalId;
  let diaSiguiente: string;

  if (idxActual < DIA_ORDEN.length - 1) {
    diaSiguiente = DIA_ORDEN[idxActual + 1];
  } else {
    // Do -> Lu de la próxima semana: buscar el siguiente plan publicado de la
    // misma disciplina/área.
    diaSiguiente = "Lu";
    const actual = await prisma.programacionSemanal.findUnique({
      where: { id: fila.programacionSemanalId },
      select: { disciplina: true, areaCodigo: true, fechaFin: true },
    });
    if (!actual) return;
    const siguiente = await prisma.programacionSemanal.findFirst({
      where: {
        disciplina: actual.disciplina,
        areaCodigo: actual.areaCodigo,
        fechaInicio: { gt: actual.fechaFin },
      },
      orderBy: { fechaInicio: "asc" },
      select: { id: true },
    });
    if (!siguiente) return;
    programacionSemanalId = siguiente.id;
  }

  const yaExiste = await prisma.otProgramada.findFirst({
    where: { programacionSemanalId, numeroOT: fila.numeroOT, dia: diaSiguiente, grupo: fila.grupo },
    select: { id: true },
  });
  if (yaExiste) return;

  await prisma.otProgramada.create({
    data: {
      programacionSemanalId,
      numeroOT: fila.numeroOT,
      tipoOT: fila.tipoOT,
      tipoTrabajo: fila.tipoTrabajo,
      prioridad: fila.prioridad,
      descripcion: fila.descripcion,
      tag: fila.tag,
      descripcionEquipo: fila.descripcionEquipo,
      personas: fila.personas,
      hrsTrabajo: fila.hrsTrabajo,
      hhTotal: fila.hhTotal,
      personalAsignado: fila.personalAsignado,
      personalAsignadoIds: fila.personalAsignadoIds,
      grupo: fila.grupo,
      dia: diaSiguiente,
      estado: estadoNueva,
      ordenTrabajoId: fila.ordenTrabajoId,
      ordenTrabajoNum: fila.ordenTrabajoNum,
      esGuardia: fila.esGuardia,
    },
  });
}

export async function GET(_req: NextRequest, { params }: Ctx) {
  const { id } = await params;
  const programa = await prisma.programacionSemanal.findUnique({ where: { id }, include });
  if (!programa) return Response.json({ ok: false, error: "No encontrado" }, { status: 404 });
  await reconciliarTurnosGuardia([programa as unknown as Parameters<typeof reconciliarTurnosGuardia>[0][number]]);
  return Response.json(serialize(programa as Record<string, unknown>));
}

// El mensaje de conflicto del POST ("elimínalo primero si deseas
// reemplazarlo") no tenía forma de cumplirse -- no existía ningún DELETE.
// Las filas hijas (otsProgramadas/personal/resumenDias) se borran primero
// porque no tienen onDelete: Cascade en el schema.
export async function DELETE(_req: NextRequest, { params }: Ctx) {
  const { id } = await params;
  const programa = await prisma.programacionSemanal.findUnique({ where: { id } });
  if (!programa) return Response.json({ ok: false, error: "No encontrado" }, { status: 404 });

  await prisma.$transaction([
    prisma.otProgramada.deleteMany({ where: { programacionSemanalId: id } }),
    prisma.personalSemanal.deleteMany({ where: { programacionSemanalId: id } }),
    prisma.resumenDia.deleteMany({ where: { programacionSemanalId: id } }),
    prisma.programacionSemanal.delete({ where: { id } }),
  ]);

  return Response.json({ ok: true });
}

export async function PATCH(req: NextRequest, { params }: Ctx) {
  try {
    const { id } = await params;
    const body = await req.json();
    // Solo actualizar campos de nivel superior (no otsProgramadas)
    const { otsProgramadas, personal, resumenDias, ...topLevel } = body;
    void otsProgramadas; void personal; void resumenDias;
    const programa = await prisma.programacionSemanal.update({
      where: { id }, data: topLevel, include,
    });
    return Response.json({ ok: true, programa: serialize(programa as Record<string, unknown>) });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Error interno";
    return Response.json({ ok: false, error: message }, { status: 400 });
  }
}

// Actualizar estado de una OT específica dentro de la programación
export async function PUT(req: NextRequest, { params }: Ctx) {
  try {
    const { id } = await params;
    const body = await req.json();
    const { numeroOT, dia, estado, observaciones,
            pasarNoche, pasarNocheMotivo, pasarNocheNota, pasarNochePor,
            continuar, continuaMotivo, continuaNota, continuaPor,
            personalAsignado, personalAsignadoIds, todosLosDias, hhTotal } = body;

    if (!numeroOT || (!dia && !todosLosDias))
      return Response.json({ ok: false, error: "numeroOT y dia son requeridos" }, { status: 400 });

    // Editar hhTotal es una corrección administrativa (afecta HH publicadas ya
    // usadas en estadísticas) — a diferencia de estado/personal, que cualquier
    // rol autenticado puede tocar desde el plan semanal.
    if (hhTotal !== undefined) {
      const token = req.cookies.get(COOKIE_NAME)?.value;
      const session = token ? verifyToken(token) : null;
      if (!session || (session.rol !== 1 && session.rol !== 3)) {
        return Response.json({ ok: false, error: "No autorizado para editar HH" }, { status: 403 });
      }
      if (typeof hhTotal !== "number" || !Number.isFinite(hhTotal) || hhTotal < 0) {
        return Response.json({ ok: false, error: "hhTotal inválido" }, { status: 400 });
      }
    }

    // todosLosDias: una OT recurrente ocupa varias filas (una por día programado) que
    // comparten numeroOT. Al cerrar el ciclo semanal (enviar a revisión) hay que marcarlas
    // todas, no solo el día desde el que se envió — si no, el badge/botón de los otros
    // días del plan siguen mostrando el estado viejo al recargar.
    const whereBase = todosLosDias
      ? { programacionSemanalId: id, numeroOT }
      : { programacionSemanalId: id, numeroOT, dia };
    const whereGrupoMatch = !todosLosDias && body.grupo
      ? { ...whereBase, grupo: String(body.grupo) }
      : whereBase;
    // numeroOT+dia+grupo no identifica una fila única cuando hay dos OTs de
    // guardia duplicadas en el mismo grupo (el bug que esto corrige): ambas
    // matchean y el update les pega a las dos. Si el cliente manda el id de
    // la fila puntual (modal de editar técnicos), usarlo como selector exacto.
    const whereGrupo = !todosLosDias && typeof body.id === "string" && body.id
      ? { id: body.id }
      : whereGrupoMatch;

    const estadoContinua = continuar
      ? (continuaMotivo && MOTIVOS_BLOQUEAN.has(continuaMotivo) ? "bloqueada" : "en_proceso")
      : undefined;

    // Una OT de guardia (OPEPLANT) vive como dos filas gemelas por día -- una
    // en Diurno y otra en Nocturno, mismo numeroOT+dia. Pisar el grupo de una
    // sola fila con nuevoGrupo, sin más, puede dejar las dos filas en el
    // mismo turno y ninguna en el otro (bug reportado: 945213 duplicada en
    // Diurno). Si la fila que se edita es de guardia, se hace swap atómico
    // con la gemela que ya ocupa ese grupo en vez de sobrescribirla.
    if (body.nuevoGrupo) {
      const filasObjetivo = await prisma.otProgramada.findMany({
        where: whereGrupo,
        select: { id: true, esGuardia: true, tag: true, grupo: true },
      });
      // esGuardia no siempre viene seteado por el importador -- el tag
      // OPEPLANT es la fuente de verdad de respaldo (ver esOpeplant()).
      const esGuardiaObjetivo = filasObjetivo.some(f => esOpeplant(f.tag, f.esGuardia));
      if (esGuardiaObjetivo && filasObjetivo.length > 0) {
        const grupoOrigen = filasObjetivo[0].grupo;
        const candidatasGemela = await prisma.otProgramada.findMany({
          where: {
            programacionSemanalId: id, numeroOT, dia,
            grupo: String(body.nuevoGrupo),
            id: { notIn: filasObjetivo.map(f => f.id) },
          },
        });
        const gemela = candidatasGemela.find(f => esOpeplant(f.tag, f.esGuardia)) ?? null;
        if (gemela) {
          await prisma.otProgramada.update({
            where: { id: gemela.id },
            data: { grupo: grupoOrigen },
          });
        }
      }
    }

    await prisma.otProgramada.updateMany({
      where: whereGrupo,
      data: {
        ...(estado             !== undefined ? { estado } : {}),
        ...(observaciones      !== undefined ? { observaciones } : {}),
        ...(personalAsignado    !== undefined ? { personalAsignado } : {}),
        ...(personalAsignadoIds !== undefined ? { personalAsignadoIds } : {}),
        ...(body.nuevoGrupo ? { grupo: String(body.nuevoGrupo) } : {}),
        ...(hhTotal             !== undefined ? { hhTotal } : {}),
        ...(pasarNoche         !== undefined ? {
          pasarNoche,
          pasarNocheMotivo: pasarNocheMotivo ?? "",
          pasarNocheNota:   pasarNocheNota   ?? "",
          pasarNochePor:    pasarNochePor     ?? "",
          pasarNocheAt:     pasarNoche ? new Date() : null,
        } : {}),
        ...(continuar ? {
          continuaMotivo: continuaMotivo ?? "",
          continuaNota:   continuaNota   ?? "",
          continuaPor:    continuaPor    ?? "",
          continuaAt:     new Date(),
          estado:         estado ?? estadoContinua,
        } : {}),
      },
    });

    if (continuar) {
      const filas = await prisma.otProgramada.findMany({ where: whereGrupo });
      for (const fila of filas) {
        await crearFilaContinuacion(fila as OtProgramadaRow, estadoContinua ?? "en_proceso");
      }
    }

    const programa = await prisma.programacionSemanal.findUnique({ where: { id }, include });
    if (!programa) return Response.json({ ok: false, error: "No encontrado" }, { status: 404 });
    return Response.json({ ok: true, programa: serialize(programa as Record<string, unknown>) });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Error interno";
    return Response.json({ ok: false, error: message }, { status: 400 });
  }
}
