import { prisma } from "@/lib/prisma";
import { NextRequest } from "next/server";

// Corrección puntual, one-off: la OT de guardia 945213 del martes (11-ago-2026)
// quedó duplicada dos veces bajo el mismo turno tras varios intentos fallidos
// de arreglarla a mano desde el modal (ver commits af2892b y 8933f9a). Este
// endpoint localiza esas dos filas exactas, valida que siguen en el estado
// roto esperado antes de tocar nada, y las reparte una por turno.
const DIURNO_TECNICOS = ["Cordova Ramos Felix", "Espejo Rospigliossi Edson Adhemar"];
const NOCTURNO_TECNICOS = ["Quispe Miranda James Chanel", "Quispe Valda José Calasanz"];

async function localizar() {
  const planes = await prisma.programacionSemanal.findMany({
    where: {
      fechaInicio: { gte: new Date("2026-08-01"), lte: new Date("2026-08-20") },
    },
    include: {
      otsProgramadas: { where: { numeroOT: "945213", dia: "Ma" } },
      personal: true,
    },
  });
  return planes.filter(p => p.otsProgramadas.length > 0);
}

export async function GET(_req: NextRequest) {
  const planes = await localizar();
  return Response.json(planes.map(p => ({
    programaId: p.id, semana: p.semana, anio: p.anio,
    disciplina: p.disciplina, areaCodigo: p.areaCodigo,
    filas: p.otsProgramadas.map(o => ({
      id: o.id, grupo: o.grupo, esGuardia: o.esGuardia, personalAsignado: o.personalAsignado,
    })),
  })));
}

export async function POST(_req: NextRequest) {
  const planes = await localizar();
  if (planes.length !== 1) {
    return Response.json({
      ok: false,
      error: `Se esperaba exactamente 1 plan con la OT 945213/Ma, se encontraron ${planes.length}. Abortado por seguridad.`,
      planes: planes.map(p => ({ id: p.id, semana: p.semana, anio: p.anio, areaCodigo: p.areaCodigo })),
    }, { status: 409 });
  }

  const plan = planes[0];
  const filas = plan.otsProgramadas;
  if (filas.length !== 2 || filas[0].grupo !== filas[1].grupo) {
    return Response.json({
      ok: false,
      error: "El estado actual ya no coincide con el duplicado esperado (2 filas, mismo grupo). Abortado por seguridad.",
      filas: filas.map(f => ({ id: f.id, grupo: f.grupo, personalAsignado: f.personalAsignado })),
    }, { status: 409 });
  }

  const idPorNombre = new Map(plan.personal.map(p => [p.nombre, p.usuarioId]));
  const idsDiurno = DIURNO_TECNICOS.map(n => idPorNombre.get(n)).filter((x): x is string => Boolean(x));
  const idsNocturno = NOCTURNO_TECNICOS.map(n => idPorNombre.get(n)).filter((x): x is string => Boolean(x));

  const [filaDiurno, filaNocturno] = filas;

  await prisma.otProgramada.update({
    where: { id: filaDiurno.id },
    data: { grupo: "Diurno", personalAsignado: DIURNO_TECNICOS, personalAsignadoIds: idsDiurno },
  });
  await prisma.otProgramada.update({
    where: { id: filaNocturno.id },
    data: { grupo: "Nocturno", personalAsignado: NOCTURNO_TECNICOS, personalAsignadoIds: idsNocturno },
  });

  return Response.json({
    ok: true,
    actualizado: [
      { id: filaDiurno.id, grupo: "Diurno", personalAsignado: DIURNO_TECNICOS },
      { id: filaNocturno.id, grupo: "Nocturno", personalAsignado: NOCTURNO_TECNICOS },
    ],
  });
}
