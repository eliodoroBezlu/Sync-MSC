import { prisma } from "@/lib/prisma";
import { esOpeplant } from "@/lib/opeplant";

type OtProgramadaRow = {
  id: string;
  numeroOT: string;
  dia: string;
  grupo: string;
  esGuardia: boolean;
  tag: string | null;
  personalAsignado: string[];
};

type PersonalRow = { nombre: string; grupo: string };

const TURNOS_GUARDIA = ["Diurno", "Nocturno"];

// Las OTs OPEPLANT (guardia de planta) viven como dos filas gemelas por día
// -- una en Diurno y otra en Nocturno, mismo numeroOT+dia. Un cambio manual
// de turno hecho a una sola fila (ver PUT /api/programacion-semanal/[id],
// nuevoGrupo) puede dejar las dos filas en el mismo grupo y ninguna en el
// otro -- caso reportado: OT 945213 duplicada en Diurno. Esto reconcilia esa
// invariante en cada lectura del plan: si detecta el par duplicado y la
// cuadrilla asignada a cada fila (comparada contra el turno real de cada
// técnico en el roster) permite distinguir sin ambigüedad a qué turno
// pertenece cada una, reasigna. Si es ambiguo (sin personal asignado, o
// ambas cuadrillas apuntan al mismo turno), no adivina: deja el conflicto
// para que se corrija a mano.
export async function reconciliarTurnosGuardia(
  programas: Array<{ otsProgramadas: OtProgramadaRow[]; personal: PersonalRow[] }>
): Promise<void> {
  for (const programa of programas) {
    const rosterGrupoPorNombre = new Map(programa.personal.map(p => [p.nombre, p.grupo]));

    const porClave = new Map<string, OtProgramadaRow[]>();
    for (const ot of programa.otsProgramadas) {
      if (!esOpeplant(ot.tag, ot.esGuardia) || !TURNOS_GUARDIA.includes(ot.grupo)) continue;
      const clave = `${ot.numeroOT}|${ot.dia}`;
      porClave.set(clave, [...(porClave.get(clave) ?? []), ot]);
    }

    for (const filas of porClave.values()) {
      if (filas.length !== 2) continue;
      const [a, b] = filas;
      if (a.grupo !== b.grupo) continue; // ya están repartidas, una por turno

      const puntaje = (fila: OtProgramadaRow) =>
        fila.personalAsignado.reduce((s, nombre) => {
          const g = rosterGrupoPorNombre.get(nombre);
          return g === "Diurno" ? s + 1 : g === "Nocturno" ? s - 1 : s;
        }, 0);

      const puntajeA = puntaje(a);
      const puntajeB = puntaje(b);
      if (puntajeA === 0 && puntajeB === 0) continue; // sin cuadrilla asignada, no hay señal
      if (Math.sign(puntajeA) === Math.sign(puntajeB)) continue; // ambas apuntan igual, ambiguo

      const filaDiurno = puntajeA > puntajeB ? a : b;
      const filaNocturno = puntajeA > puntajeB ? b : a;

      await prisma.otProgramada.update({ where: { id: filaDiurno.id }, data: { grupo: "Diurno" } });
      await prisma.otProgramada.update({ where: { id: filaNocturno.id }, data: { grupo: "Nocturno" } });
      filaDiurno.grupo = "Diurno";
      filaNocturno.grupo = "Nocturno";
    }
  }
}
