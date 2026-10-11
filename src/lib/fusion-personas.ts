/**
 * Fusión de personas duplicadas en Sync (la misma persona cargada dos veces).
 *
 * Las tablas operativas guardan el id de la persona como texto suelto (sin FK),
 * así que borrar un duplicado dejaba sus OT, roster y reportes apuntando a nadie.
 * Aquí todas esas referencias pasan a la persona que se conserva y recién
 * entonces se borra la otra.
 *
 *  - Columnas con un id → se reasignan.
 *  - Listas de ids (personal asignado) → se reemplaza el id; si en una misma
 *    fila ya estaban las dos, se avisa (el texto paralelo de nombres no se toca).
 *  - Competencias y desempeño (únicos por persona) → se combinan.
 *  - Los nombres guardados como texto (historial, firmas) quedan como estaban:
 *    son lo que se registró en su momento.
 *
 * La identidad sigue las reglas del padrón: no se fusionan dos cuentas del IAM.
 * Si cada registro tiene su propia ficha en el IAM, la del registro que se
 * borra se DESACTIVA en el IAM (solo si no tiene cuenta: una ficha con cuenta
 * se resuelve en el IAM Portal). Si el IAM no responde, no se fusiona nada.
 */
import { Prisma, type Usuario } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { actualizarTrabajador, type ActorIam } from "@/lib/iam-padron";

/** Columnas que guardan un Usuario.id. */
const COLUMNAS = [
  ["OtTecnico", "usuarioId"],
  ["OtHistorial", "usuarioId"],
  ["OtRegistroDiario", "usuarioId"],
  ["PersonalSemanal", "usuarioId"],
  ["RosterSemanal", "usuarioId"],
  ["CuadrillaMiembro", "tecnicoUsuarioId"],
  ["ParadaGrupo", "supervisorUsuarioId"],
  ["ParadaGrupoMiembro", "usuarioId"],
  ["ParadaReporteDiario", "supervisorUsuarioId"],
  ["ReporteTurno", "supervisorId"],
  ["RegistroCalibracion", "tecnicoId"],
  ["RegistroCalibracion", "supervisorId"],
] as const;

/** Columnas que guardan una lista de Usuario.id. */
const LISTAS = [
  ["OtProgramada", "personalAsignadoIds"],
  ["ParadaOt", "personalAsignadoIds"],
  ["PlanBorradorOt", "personalAsignadoIds"],
] as const;

const NIVELES = ["Básico", "Intermedio", "Avanzado", "Experto"];

/** Identificador SQL de la lista fija de arriba (nunca de la entrada del usuario). */
const id = (s: string) => Prisma.raw(`"${s}"`);

export interface PlanFusion {
  conservar: { id: string; nombre: string };
  eliminar: { id: string; nombre: string };
  /** "Tabla.columna" → filas que se reasignan. */
  referencias: Record<string, number>;
  competenciasCombinadas: number;
  desempenioCombinado: number;
  /** Datos de la persona eliminada que pasan a la conservada (estaban vacíos). */
  datosQuePasan: string[];
  /** Ficha del IAM (sin cuenta) del registro que se borra: se desactiva allí. */
  fichaIamDesactivada: string;
  avisos: string[];
}

export class FusionInvalida extends Error {}

type Tx = Prisma.TransactionClient;

async function cargar(tx: Tx, conservarId: string, eliminarId: string) {
  if (conservarId === eliminarId) throw new FusionInvalida("Elige dos personas distintas.");
  const [c, e] = await Promise.all([
    tx.usuario.findUnique({ where: { id: conservarId }, include: { areas: true } }),
    tx.usuario.findUnique({ where: { id: eliminarId }, include: { areas: true } }),
  ]);
  if (!c || !e) throw new FusionInvalida("Una de las dos personas ya no existe.");
  if (c.iamUserId && e.iamUserId) {
    throw new FusionInvalida(
      "Las dos tienen cuenta propia en el IAM. Si son la misma persona, desactiva una de las cuentas en el IAM Portal y vuelve a intentarlo.",
    );
  }
  // Cada persona tiene su ficha (trabajadorId es único): la del registro que se
  // borra sobra en el IAM.
  const fichaQueSobra = e.trabajadorId;
  if (e.tieneCuentaIam || e.iamUserId) {
    throw new FusionInvalida(
      `"${e.nombre}" tiene cuenta en el IAM con su propia ficha. Conserva ese registro y fusiona el otro en él, ` +
        "o resuelve primero el duplicado en el IAM Portal.",
    );
  }
  return { c, e, fichaQueSobra };
}

/** Campos de identidad que pasan si la persona conservada los tiene vacíos. */
const HEREDABLES = [
  "iamUserId", "email", "jde", "celular", "puesto",
  "superintendencia", "areaTrabajo", "fechaExpiracion",
] as const satisfies readonly (keyof Usuario)[];

function heredados(c: Usuario, e: Usuario): Partial<Usuario> {
  const d: Partial<Usuario> = {};
  for (const k of HEREDABLES) {
    const vacio = c[k] === null || c[k] === "";
    if (vacio && e[k] !== null && e[k] !== "") (d as Record<string, unknown>)[k] = e[k];
  }
  if (e.tieneCuentaIam && !c.tieneCuentaIam) d.tieneCuentaIam = true;
  return d;
}

async function contar(tx: Tx, conservarId: string, eliminarId: string) {
  const referencias: Record<string, number> = {};
  for (const [tabla, col] of COLUMNAS) {
    const [{ n }] = await tx.$queryRaw<{ n: bigint }[]>`
      SELECT count(*) AS n FROM ${id(tabla)} WHERE ${id(col)} = ${eliminarId}`;
    if (n > 0) referencias[`${tabla}.${col}`] = Number(n);
  }
  const avisos: string[] = [];
  for (const [tabla, col] of LISTAS) {
    const [{ n, ambos }] = await tx.$queryRaw<{ n: bigint; ambos: bigint }[]>`
      SELECT count(*) AS n,
             count(*) FILTER (WHERE ${conservarId} = ANY(${id(col)})) AS ambos
      FROM ${id(tabla)} WHERE ${eliminarId} = ANY(${id(col)})`;
    if (n > 0) referencias[`${tabla}.${col}`] = Number(n);
    if (ambos > 0) {
      avisos.push(`${tabla}: en ${ambos} fila(s) figuraban las dos; la persona quedará repetida en esa asignación.`);
    }
  }
  return { referencias, avisos };
}

async function choques(tx: Tx, conservarId: string, eliminarId: string) {
  const [compC, compE, desC, desE] = await Promise.all([
    tx.tecnicoCompetencia.findMany({ where: { usuarioId: conservarId } }),
    tx.tecnicoCompetencia.findMany({ where: { usuarioId: eliminarId } }),
    tx.tecnicoDesempenio.findMany({ where: { usuarioId: conservarId } }),
    tx.tecnicoDesempenio.findMany({ where: { usuarioId: eliminarId } }),
  ]);
  const comp = compE.flatMap((e) => {
    const c = compC.find((x) => x.disciplina === e.disciplina);
    return c ? [{ c, e }] : [];
  });
  const des = desE.flatMap((e) => {
    const c = desC.find((x) => x.tag === e.tag && x.tipoOT === e.tipoOT);
    return c ? [{ c, e }] : [];
  });
  return { comp, des };
}

/** Qué haría la fusión, sin escribir nada. */
export async function planificarFusion(conservarId: string, eliminarId: string): Promise<PlanFusion> {
  return prisma.$transaction(async (tx) => {
    const { c, e, fichaQueSobra } = await cargar(tx, conservarId, eliminarId);
    const { referencias, avisos } = await contar(tx, conservarId, eliminarId);
    const { comp, des } = await choques(tx, conservarId, eliminarId);
    return {
      conservar: { id: c.id, nombre: c.nombre },
      eliminar: { id: e.id, nombre: e.nombre },
      referencias,
      competenciasCombinadas: comp.length,
      desempenioCombinado: des.length,
      datosQuePasan: Object.keys(heredados(c, e)),
      fichaIamDesactivada: fichaQueSobra,
      avisos,
    };
  });
}

/**
 * Reasigna todo a `conservarId` y borra `eliminarId`, en una sola transacción.
 * Si sobra una ficha del IAM, primero se desactiva allí: si el IAM no responde,
 * no se toca nada en Sync.
 */
export async function fusionarPersonas(
  conservarId: string,
  eliminarId: string,
  actor?: ActorIam,
): Promise<PlanFusion> {
  const previo = await planificarFusion(conservarId, eliminarId);
  await actualizarTrabajador(previo.fichaIamDesactivada, { activo: false }, actor);
  return prisma.$transaction(async (tx) => {
    const { c, e, fichaQueSobra } = await cargar(tx, conservarId, eliminarId);
    const { referencias, avisos } = await contar(tx, conservarId, eliminarId);
    const { comp, des } = await choques(tx, conservarId, eliminarId);

    // 1) Competencias y desempeño: combinar los que chocan y mover el resto
    for (const { c: a, e: b } of comp) {
      await tx.tecnicoCompetencia.update({
        where: { id: a.id },
        data: {
          nivel: NIVELES[Math.max(NIVELES.indexOf(a.nivel), NIVELES.indexOf(b.nivel), 0)],
          competencias: [...new Set([...a.competencias, ...b.competencias])],
          certificado: a.certificado || b.certificado,
          validaHasta: [a.validaHasta, b.validaHasta]
            .filter((d): d is Date => d !== null)
            .sort((x, y) => y.getTime() - x.getTime())[0] ?? null,
        },
      });
      await tx.tecnicoCompetencia.delete({ where: { id: b.id } });
    }
    for (const { c: a, e: b } of des) {
      const total = a.otasCompletadas + b.otasCompletadas;
      const pondera = (x: number, y: number) =>
        total > 0 ? (x * a.otasCompletadas + y * b.otasCompletadas) / total : x;
      await tx.tecnicoDesempenio.update({
        where: { id: a.id },
        data: {
          otasCompletadas: total,
          tiempoPromedio: pondera(a.tiempoPromedio, b.tiempoPromedio),
          eficiencia: pondera(a.eficiencia, b.eficiencia),
          ultimaFecha: [a.ultimaFecha, b.ultimaFecha]
            .filter((d): d is Date => d !== null)
            .sort((x, y) => y.getTime() - x.getTime())[0] ?? null,
        },
      });
      await tx.tecnicoDesempenio.delete({ where: { id: b.id } });
    }
    await tx.tecnicoCompetencia.updateMany({ where: { usuarioId: eliminarId }, data: { usuarioId: conservarId } });
    await tx.tecnicoDesempenio.updateMany({ where: { usuarioId: eliminarId }, data: { usuarioId: conservarId } });

    // 2) Referencias sueltas
    for (const [tabla, col] of COLUMNAS) {
      await tx.$executeRaw`
        UPDATE ${id(tabla)} SET ${id(col)} = ${conservarId} WHERE ${id(col)} = ${eliminarId}`;
    }
    for (const [tabla, col] of LISTAS) {
      await tx.$executeRaw`
        UPDATE ${id(tabla)} SET ${id(col)} = array_replace(${id(col)}, ${eliminarId}, ${conservarId})
        WHERE ${eliminarId} = ANY(${id(col)})`;
    }

    // 3) Áreas asignadas: la unión
    const propias = new Set(c.areas.map((a) => a.areaCodigo));
    const nuevas = e.areas.filter((a) => !propias.has(a.areaCodigo));
    if (nuevas.length) {
      await tx.usuarioArea.createMany({
        data: nuevas.map((a) => ({ usuarioId: conservarId, areaCodigo: a.areaCodigo })),
      });
    }

    // 4) Identidad: lo que la conservada tiene vacío. Los únicos se liberan antes.
    const datos = heredados(c, e);
    await tx.usuario.update({
      where: { id: eliminarId },
      data: { iamUserId: null, email: null },
    });
    if (Object.keys(datos).length) await tx.usuario.update({ where: { id: conservarId }, data: datos });
    await tx.usuario.delete({ where: { id: eliminarId } });

    console.log(
      `[fusión] "${e.nombre}" (${e.id}) → "${c.nombre}" (${c.id}): ` +
        `${Object.values(referencias).reduce((s, n) => s + n, 0)} referencias reasignadas`,
    );
    return {
      conservar: { id: c.id, nombre: c.nombre },
      eliminar: { id: e.id, nombre: e.nombre },
      referencias,
      competenciasCombinadas: comp.length,
      desempenioCombinado: des.length,
      datosQuePasan: Object.keys(datos),
      fichaIamDesactivada: fichaQueSobra,
      avisos,
    };
  }, { timeout: 30_000 });
}
