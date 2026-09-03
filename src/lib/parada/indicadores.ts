// Cálculo puro de los indicadores del tablero de Parada de Planta.
// Sin dependencias de Prisma ni de red: entra una `ParadaCalc` (OTs + avances)
// y sale un `TableroParada`. Regla de negocio clave: sólo las OTs de
// `fase = "ejecucion"` y sus avances (fechas 11–13) alimentan HH y avance.

import type {
  AvanceParadaCalc,
  ConteoOts,
  DiaActual,
  DisciplinaParada,
  IndicadorDisciplina,
  OtParadaCalc,
  ParadaCalc,
  PuntoSerieDiaria,
  TableroParada,
} from "./tipos";
import { DISCIPLINAS_PARADA } from "./tipos";

const MS_DIA = 86_400_000;

/** Fecha (Date o ISO) → "YYYY-MM-DD" en UTC, para comparar por día. */
export function ymd(fecha: Date | string): string {
  if (typeof fecha === "string") {
    return /^\d{4}-\d{2}-\d{2}/.test(fecha)
      ? fecha.slice(0, 10)
      : new Date(fecha).toISOString().slice(0, 10);
  }
  return fecha.toISOString().slice(0, 10);
}

function aMedianoche(fecha: Date | string): Date {
  return new Date(`${ymd(fecha)}T00:00:00.000Z`);
}

function r1(n: number): number {
  return Math.round(n * 10) / 10;
}

function r2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** % ponderado por HH estimadas; si todas las HH son 0, promedio simple. */
export function avancePonderado(
  ots: ReadonlyArray<Pick<OtParadaCalc, "hhEstimadas" | "avancePct">>,
): number {
  if (ots.length === 0) return 0;
  const sumHH = ots.reduce((s, o) => s + o.hhEstimadas, 0);
  if (sumHH > 0) {
    return ots.reduce((s, o) => s + o.hhEstimadas * o.avancePct, 0) / sumHH;
  }
  return ots.reduce((s, o) => s + o.avancePct, 0) / ots.length;
}

/** Conteo de OTs por estado. Cualquier estado no reconocido cuenta como "no iniciada". */
export function contarOts(ots: ReadonlyArray<Pick<OtParadaCalc, "estado">>): ConteoOts {
  const c: ConteoOts = {
    total: ots.length,
    terminadas: 0,
    enEjecucion: 0,
    noIniciadas: 0,
    conRetraso: 0,
  };
  for (const o of ots) {
    if (o.estado === "terminada") c.terminadas++;
    else if (o.estado === "en_ejecucion") c.enEjecucion++;
    else if (o.estado === "con_retraso") c.conRetraso++;
    else c.noIniciadas++;
  }
  return c;
}

/** % acumulado de una OT al cierre de `diaYmd` (máximo avance reportado hasta ese día). */
function pctOtAlDia(
  otId: string,
  diaYmd: string,
  avances: ReadonlyArray<AvanceParadaCalc>,
): number {
  let max = 0;
  for (const a of avances) {
    if (a.paradaOtId === otId && ymd(a.fecha) <= diaYmd && a.avancePct > max) {
      max = a.avancePct;
    }
  }
  return max;
}

function conteoVacio(): ConteoOts {
  return { total: 0, terminadas: 0, enEjecucion: 0, noIniciadas: 0, conRetraso: 0 };
}

function indicadorDisciplinaVacio(): IndicadorDisciplina {
  return { avancePct: 0, otsTotal: 0, otsTerminadas: 0, hhReal: 0, hhEst: 0 };
}

export function calcularTablero(
  parada: ParadaCalc,
  hoy: Date = new Date(),
): TableroParada {
  const ots = parada.ots ?? [];
  const avances = parada.avances ?? [];

  const otsEjec = ots.filter((o) => o.fase === "ejecucion");
  const otsPrep = ots.filter((o) => o.fase === "preparativos");
  const idsEjec = new Set(otsEjec.map((o) => o.id));
  const avancesEjec = avances.filter((a) => idsEjec.has(a.paradaOtId));

  // ── Avance global (ponderado por HH de ejecución) ─────────────────────────
  const avanceGlobalPct = Math.round(avancePonderado(otsEjec));

  // ── Conteo de OTs ────────────────────────────────────────────────────────
  const conteoGlobal = contarOts(ots);
  const ots_: TableroParada["ots"] = {
    ...conteoGlobal,
    preparativos: otsPrep.length ? contarOts(otsPrep) : conteoVacio(),
    ejecucion: otsEjec.length ? contarOts(otsEjec) : conteoVacio(),
  };

  // ── Cumplimiento hoy = terminadas / programadas hasta hoy ─────────────────
  const hoyYmd = ymd(hoy);
  const programadasHastaHoy = otsEjec.filter(
    (o) => o.fechaProg != null && ymd(o.fechaProg) <= hoyYmd,
  );
  const terminadasProgramadas = programadasHastaHoy.filter(
    (o) => o.estado === "terminada",
  ).length;
  const cumplimientoHoy =
    programadasHastaHoy.length === 0
      ? 1
      : r2(terminadasProgramadas / programadasHastaHoy.length);

  // ── Por disciplina (sobre OTs de ejecución) ──────────────────────────────
  const porDisciplina = {} as Record<DisciplinaParada, IndicadorDisciplina>;
  for (const disc of DISCIPLINAS_PARADA) {
    const otsD = otsEjec.filter((o) => o.disciplina === disc);
    if (otsD.length === 0) {
      porDisciplina[disc] = indicadorDisciplinaVacio();
      continue;
    }
    const idsD = new Set(otsD.map((o) => o.id));
    const hhReal = avancesEjec
      .filter((a) => idsD.has(a.paradaOtId))
      .reduce((s, a) => s + a.hhPropias + a.hhApoyo, 0);
    porDisciplina[disc] = {
      avancePct: Math.round(avancePonderado(otsD)),
      otsTotal: otsD.length,
      otsTerminadas: otsD.filter((o) => o.estado === "terminada").length,
      hhReal: r1(hhReal),
      hhEst: r1(otsD.reduce((s, o) => s + o.hhEstimadas, 0)),
    };
  }

  // ── HH ───────────────────────────────────────────────────────────────────
  const hhEst = otsEjec.reduce((s, o) => s + o.hhEstimadas, 0);
  const hhReal = avancesEjec.reduce((s, a) => s + a.hhPropias + a.hhApoyo, 0);
  const factorProductividad =
    hhReal > 0 ? r2(((avanceGlobalPct / 100) * hhEst) / hhReal) : 0;

  // ── Día actual y serie diaria ────────────────────────────────────────────
  const ini = aMedianoche(parada.fechaEjecucionInicio);
  const fin = aMedianoche(parada.fechaEjecucionFin);
  const totalDias = Math.max(
    1,
    Math.round((fin.getTime() - ini.getTime()) / MS_DIA) + 1,
  );
  const h = aMedianoche(hoy);
  const previa = h.getTime() < ini.getTime();
  let indice: number;
  if (previa) indice = 1;
  else if (h.getTime() > fin.getTime()) indice = totalDias;
  else indice = Math.round((h.getTime() - ini.getTime()) / MS_DIA) + 1;

  const dias: string[] = [];
  for (let t = ini.getTime(); t <= fin.getTime(); t += MS_DIA) {
    dias.push(ymd(new Date(t)));
  }

  const sumHHEjec = otsEjec.reduce((s, o) => s + o.hhEstimadas, 0);
  const serieDiaria: PuntoSerieDiaria[] = dias.map((dia, i) => {
    const avancePlanAcum = r1(((i + 1) / totalDias) * 100);
    let avanceRealAcum: number;
    if (otsEjec.length === 0) {
      avanceRealAcum = 0;
    } else if (sumHHEjec > 0) {
      avanceRealAcum =
        otsEjec.reduce(
          (s, o) => s + o.hhEstimadas * pctOtAlDia(o.id, dia, avancesEjec),
          0,
        ) / sumHHEjec;
    } else {
      avanceRealAcum =
        otsEjec.reduce((s, o) => s + pctOtAlDia(o.id, dia, avancesEjec), 0) /
        otsEjec.length;
    }
    const hhRealDia = avancesEjec
      .filter((a) => ymd(a.fecha) === dia)
      .reduce((s, a) => s + a.hhPropias + a.hhApoyo, 0);
    return {
      fecha: dia,
      avancePlanAcum,
      avanceRealAcum: r1(avanceRealAcum),
      hhReal: r1(hhRealDia),
    };
  });

  const diaActual: DiaActual = {
    indice,
    total: totalDias,
    etiqueta: `Día ${indice} de ${totalDias}`,
    previa,
    avancePlan: r1((indice / totalDias) * 100),
    avanceReal: avanceGlobalPct,
  };

  return {
    avanceGlobalPct,
    ots: ots_,
    cumplimientoHoy,
    porDisciplina,
    hh: { hhEst: r1(hhEst), hhReal: r1(hhReal), factorProductividad },
    diaActual,
    serieDiaria,
  };
}
