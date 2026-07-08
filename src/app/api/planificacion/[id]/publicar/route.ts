import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";
import { validarPlan } from "@/lib/planificacion/validarPlan";
import { mapEstadoAlPlan } from "@/lib/otEstado";

type Ctx = { params: Promise<{ id: string }> };

function lunesDeSemana(semana: number, anio: number): Date {
  // ISO week → Monday
  const jan4 = new Date(anio, 0, 4);
  const lunes = new Date(jan4);
  const dow = jan4.getDay() || 7;
  lunes.setDate(jan4.getDate() - dow + 1 + (semana - 1) * 7);
  return lunes;
}

function fechaDia(lunes: Date, offsetDia: number): Date {
  const d = new Date(lunes);
  d.setDate(lunes.getDate() + offsetDia);
  return d;
}

const DIA_OFFSET: Record<string, number> = {
  Lu: 0, Ma: 1, Mi: 2, Ju: 3, Vi: 4, Sa: 5, Do: 6,
};

export async function POST(_req: NextRequest, { params }: Ctx) {
  const { id } = await params;

  const borrador = await prisma.planBorrador.findUnique({
    where: { id },
    include: { ots: true, roster: true },
  });
  if (!borrador) return NextResponse.json({ error: "Plan no encontrado" }, { status: 404 });
  if (borrador.estado === "publicado") return NextResponse.json({ error: "Ya publicado" }, { status: 400 });

  const lunes  = lunesDeSemana(borrador.semana, borrador.anio);
  const sabado = fechaDia(lunes, 5);

  const totalHH   = borrador.ots.reduce((s, o) => s + o.hhTotal, 0);

  try {
    // Validar plan ANTES de publicar
    const alerts = await validarPlan(
      id,
      borrador.ots as unknown as Parameters<typeof validarPlan>[1],
      borrador.roster as unknown as Parameters<typeof validarPlan>[2],
      borrador.semana,
      borrador.anio,
      borrador.disciplina
    );

    // Guardar alertas
    for (const alert of alerts) {
      await prisma.planConstraintAlert.create({
        data: {
          planBorradorId: id,
          tipo: alert.tipo,
          severidad: alert.severidad,
          mensaje: alert.mensaje,
          detalles: (alert.detalles ?? null) as unknown as import("@prisma/client").Prisma.InputJsonValue,
        },
      });
    }

    // Si hay errores CRÍTICOS, bloquear publicación
    const errores = alerts.filter(a => a.severidad === "error");
    if (errores.length > 0) {
      return NextResponse.json({
        ok: false,
        error: `No se puede publicar: ${errores.length} errores críticos`,
        alertas: errores,
      }, { status: 400 });
    }

    const resultado = await prisma.$transaction(async (tx) => {
      // Crear o actualizar ProgramacionSemanal
      const ps = await tx.programacionSemanal.upsert({
        where: { semana_anio_disciplina: { semana: borrador.semana, anio: borrador.anio, disciplina: borrador.disciplina } },
        create: {
          semana: borrador.semana,
          anio: borrador.anio,
          disciplina: borrador.disciplina,
          areaCodigo: borrador.areaCodigo,
          fechaInicio: lunes,
          fechaFin: sabado,
          hhProgramadasSemana: totalHH,
          estado: "publicado",
          subidoPor: borrador.creadoPor,
        },
        update: {
          hhProgramadasSemana: totalHH,
          estado: "publicado",
          updatedAt: new Date(),
        },
      });

      // Limpiar OTs y personal anteriores
      await tx.otProgramada.deleteMany({ where: { programacionSemanalId: ps.id } });
      await tx.personalSemanal.deleteMany({ where: { programacionSemanalId: ps.id } });

      // OTs que JDE sigue reportando de semanas anteriores (trabajos que se
      // extienden más de una semana) ya tienen una OrdenTrabajo abierta con
      // su propio historial de avances. Si no las enlazamos aquí, Registro
      // las muestra como "no iniciada" / "Registrar 1er día" y el técnico no
      // puede continuar (crear una OT nueva choca con el numeroOT único).
      const numerosOT = Array.from(new Set(borrador.ots.map(o => o.numeroOT)));
      const otsExistentes = await tx.ordenTrabajo.findMany({
        where: { numeroOT: { in: numerosOT }, estado: { not: "concluido" } },
        select: { id: true, numeroOT: true, estado: true },
      });
      const existentePorNumero = new Map(otsExistentes.map(o => [o.numeroOT, o]));

      // Crear OtProgramada por cada día de cada OtBorrador
      for (const ot of borrador.ots) {
        const diasOt: string[] = ot.dias.length > 0 ? ot.dias : ["Lu", "Ma", "Mi", "Ju", "Vi"];
        const continuacion = existentePorNumero.get(ot.numeroOT);
        for (const dia of diasOt) {
          const offset = DIA_OFFSET[dia] ?? 0;
          const fechaDiaOt = fechaDia(lunes, offset);
          await tx.otProgramada.create({
            data: {
              programacionSemanalId: ps.id,
              numeroOT:         ot.numeroOT,
              tipoOT:           ot.tipoOT,
              tipoTrabajo:      ot.tipoTrabajo,
              prioridad:        ot.prioridad ?? null,
              descripcion:      ot.descripcion,
              tag:              ot.tag,
              descripcionEquipo: ot.descripcionEquipo ?? "",
              personas:         ot.personas,
              hrsTrabajo:       ot.hrsTrabajo,
              hhTotal:          ot.personas * ot.hrsTrabajo,
              personalAsignado:    ot.personalAsignado,
              personalAsignadoIds: ot.personalAsignadoIds,
              grupo:            ot.grupo,
              dia,
              esGuardia:        ot.esGuardia,
              estado:           continuacion ? mapEstadoAlPlan(continuacion.estado) : "no_iniciada",
              ordenTrabajoId:   continuacion?.id,
              ordenTrabajoNum:  ot.numeroOT,
              // fechaInicio not in schema — store via dia field
            },
          });
          void fechaDiaOt;
        }
      }

      // Crear PersonalSemanal del roster
      for (const r of borrador.roster) {
        await tx.personalSemanal.create({
          data: {
            programacionSemanalId: ps.id,
            usuarioId: r.usuarioId ?? null,
            nombre: r.nombre,
            grupo: r.grupo,
            esContratista: r.esContratista,
            asistencia: r.asistencia as unknown as import("@prisma/client").Prisma.InputJsonValue,
          },
        });
      }

      // Marcar borrador como publicado
      await tx.planBorrador.update({
        where: { id },
        data: { estado: "publicado", publicadoEn: new Date(), programacionSemanalId: ps.id },
      });

      return ps;
    });

    return NextResponse.json({ ok: true, programacionSemanalId: resultado.id });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Error publicando";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
