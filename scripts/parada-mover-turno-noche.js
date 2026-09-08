/* eslint-disable @typescript-eslint/no-require-imports */
// Pasa cuadrillas EXISTENTES de una parada del turno "Dia" al turno "Noche"
// CONSERVANDO su número de grupo (no se renumeran desde 1).
//
// Contexto: la UI de Configuración de la parada numera los grupos por
// turno×disciplina, así que al crear el primer grupo de "Noche" arranca en
// "Grupo 1". Acá no manejamos así: la numeración de grupos es continua por
// disciplina. Este script toma los grupos de día que ya tienen su número
// (p. ej. INST 12, 6, 9, 4 y ELEC 9), les cambia el turno a "Noche" y deja el
// número intacto. De paso, borra los grupos de "Noche" VACÍOS que la UI haya
// dejado renumerados desde 1 (sin roster ni OT). Si un grupo de noche a borrar
// tiene roster u OT vinculadas, ABORTA y lo reporta para decidir a mano.
//
// Qué toca, para la parada indicada (default PPML060):
//   1) ParadaGrupo (turno "Dia" → "Noche") de los números objetivo por
//      disciplina. Conserva numero, disciplina, roster, supervisor.
//   2) ParadaOt de esas cuadrillas (grupoNumero = número, disciplina = disc):
//        grupo "Dia" → "Noche".  Las "Ambos" se reportan y NO se tocan
//        (usá --incluir-ambos para pasarlas también).
//   3) ParadaAvanceDiario de esas OT con turno "Dia" → "Noche", sólo si no
//      choca con un avance ya existente de "Noche" en la misma fecha/OT.
//      (En "preparativos" no debería haber ninguno.)
//   4) Grupos de "Noche" VACÍOS que no estén en la lista objetivo: se borran
//      (--no-limpiar-vacios para dejarlos).
//
// Uso (informe, NO escribe nada):
//   PROD_DATABASE_URL="postgresql://…" node scripts/parada-mover-turno-noche.js
// Uso (aplica):
//   PROD_DATABASE_URL="postgresql://…" node scripts/parada-mover-turno-noche.js --commit
//
// Flags:
//   --codigo=PPML060      código de la parada (default PPML060)
//   --inst=12,6,9,4       grupos de INST que pasan a Noche (default 12,6,9,4)
//   --elec=9              grupos de ELEC que pasan a Noche (default 9)
//   --tesa=               grupos de TESA que pasan a Noche (default: ninguno)
//   --incluir-ambos       también pasa a "Noche" las OT con grupo "Ambos"
//   --no-limpiar-vacios   no borra los grupos de Noche vacíos fuera de la lista
//   --commit              aplica los cambios (sin esto es sólo informe / dry-run)

const { PrismaPg } = require("@prisma/adapter-pg");
const { PrismaClient } = require("@prisma/client");

// ─── args ────────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const has = (f) => args.includes(f);
const val = (name, def) => {
  const p = args.find((a) => a.startsWith(`--${name}=`));
  return p ? p.slice(name.length + 3) : def;
};
const nums = (s) =>
  String(s ?? "")
    .split(",")
    .map((x) => Number(x.trim()))
    .filter((n) => Number.isInteger(n) && n > 0);

const COMMIT = has("--commit");
const CODIGO = val("codigo", "PPML060");
const INCLUIR_AMBOS = has("--incluir-ambos");
const LIMPIAR_VACIOS = !has("--no-limpiar-vacios");
const OBJETIVO = {
  INST: nums(val("inst", "12,6,9,4")),
  ELEC: nums(val("elec", "9")),
  TESA: nums(val("tesa", "")),
};

const URL =
  process.env.PROD_DATABASE_URL ||
  process.env.DATABASE_PUBLIC_URL ||
  process.env.DATABASE_URL;
if (!URL) {
  console.error(
    "Falta PROD_DATABASE_URL / DATABASE_PUBLIC_URL / DATABASE_URL en el entorno.",
  );
  process.exit(1);
}
const esRailway = /rlwy\.net|railway|proxy\.rlwy/.test(URL);
const mask = (u) => u.replace(/:\/\/[^@]+@/, "://***@");

// ─── main ────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`Parada : ${CODIGO}`);
  console.log(`Base   : ${mask(URL)}`);
  console.log(`Modo   : ${COMMIT ? "COMMIT (aplica cambios)" : "DRY-RUN (solo informe)"}`);
  console.log(
    `Objetivo Noche : INST[${OBJETIVO.INST.join(",") || "—"}]  ELEC[${OBJETIVO.ELEC.join(",") || "—"}]  TESA[${OBJETIVO.TESA.join(",") || "—"}]`,
  );
  console.log(
    `OT "Ambos" : ${INCLUIR_AMBOS ? "se pasan a Noche" : "se dejan como están"}   ·   limpiar grupos Noche vacíos: ${LIMPIAR_VACIOS ? "sí" : "no"}`,
  );
  console.log("");

  const prisma = new PrismaClient({
    adapter: new PrismaPg({
      connectionString: URL,
      ssl: esRailway ? { rejectUnauthorized: false } : undefined,
    }),
  });

  try {
    const parada = await prisma.parada.findUnique({ where: { codigo: CODIGO } });
    if (!parada) {
      console.error(`No existe ninguna Parada con código "${CODIGO}".`);
      process.exit(1);
    }
    console.log(`Estado de la parada: ${parada.estado}`);
    console.log("");

    const [grupos, ots, avances] = await Promise.all([
      prisma.paradaGrupo.findMany({
        where: { paradaId: parada.id },
        include: { _count: { select: { miembros: true } } },
        orderBy: [{ turno: "asc" }, { disciplina: "asc" }, { numero: "asc" }],
      }),
      prisma.paradaOt.findMany({
        where: { paradaId: parada.id },
        select: {
          id: true,
          numeroOT: true,
          disciplina: true,
          grupo: true,
          grupoNumero: true,
        },
      }),
      prisma.paradaAvanceDiario.findMany({
        where: { paradaId: parada.id },
        select: { id: true, paradaOtId: true, fecha: true, turno: true },
      }),
    ]);

    // OT por disciplina|numero
    const otsPorDiscNum = new Map();
    for (const o of ots) {
      if (o.grupoNumero == null) continue;
      const k = `${o.disciplina}|${o.grupoNumero}`;
      const arr = otsPorDiscNum.get(k) ?? [];
      arr.push(o);
      otsPorDiscNum.set(k, arr);
    }
    const contarOtGrupo = (g) =>
      (otsPorDiscNum.get(`${g.disciplina}|${g.numero}`) ?? []).filter(
        (o) => o.grupo === g.turno || o.grupo === "Ambos",
      ).length;

    // ─── foto actual ─────────────────────────────────────────────────────────
    console.log("ESTADO ACTUAL DE LAS CUADRILLAS");
    console.log("".padEnd(72, "─"));
    for (const turno of ["Dia", "Noche"]) {
      const delTurno = grupos.filter((g) => g.turno === turno);
      console.log(`  ${turno.toUpperCase()}  (${delTurno.length} grupos)`);
      if (delTurno.length === 0) console.log("    —");
      for (const g of delTurno) {
        console.log(
          `    ${g.disciplina.padEnd(5)} G${String(g.numero).padEnd(3)} ` +
            `roster:${String(g._count.miembros).padStart(2)}  ` +
            `OT:${String(contarOtGrupo(g)).padStart(2)}  ` +
            `sup:"${g.supervisorNombre || "—"}"`,
        );
      }
    }
    console.log("");

    const idxGrupo = new Map(); // `${turno}|${disc}|${numero}` -> grupo
    for (const g of grupos) idxGrupo.set(`${g.turno}|${g.disciplina}|${g.numero}`, g);

    // ─── plan ────────────────────────────────────────────────────────────────
    const aMover = []; // { grupo, otsFlip:[], otsAmbos:[], avancesFlip:[], avancesChoque:[] }
    const faltantes = []; // números objetivo sin grupo de día
    const colisionOcupada = []; // grupo Noche existente con roster/OT que bloquea el move
    const gruposNocheVacios = []; // grupos Noche a borrar (vacíos, fuera de objetivo)

    const objetivoSet = new Set();
    for (const [disc, arr] of Object.entries(OBJETIVO))
      for (const n of arr) objetivoSet.add(`${disc}|${n}`);

    for (const [disc, arr] of Object.entries(OBJETIVO)) {
      for (const n of arr) {
        const gDia = idxGrupo.get(`Dia|${disc}|${n}`);
        if (!gDia) {
          faltantes.push(`${disc} G${n}`);
          continue;
        }
        const gNocheChoque = idxGrupo.get(`Noche|${disc}|${n}`);
        if (gNocheChoque) {
          const rosterN = gNocheChoque._count.miembros;
          const otN = contarOtGrupo(gNocheChoque);
          if (rosterN > 0 || otN > 0) {
            colisionOcupada.push({ grupo: gNocheChoque, rosterN, otN });
            continue; // no se puede mover gDia a Noche N: el número está tomado
          }
          gruposNocheVacios.push(gNocheChoque); // vacío → se borra antes del move
        }

        const cuadrillaOts = otsPorDiscNum.get(`${disc}|${n}`) ?? [];
        const otsFlip = cuadrillaOts.filter((o) => o.grupo === "Dia");
        const otsAmbos = cuadrillaOts.filter((o) => o.grupo === "Ambos");
        const flipIds = new Set(
          [...otsFlip, ...(INCLUIR_AMBOS ? otsAmbos : [])].map((o) => o.id),
        );
        const avancesFlip = [];
        const avancesChoque = [];
        const nocheKeys = new Set(
          avances
            .filter((a) => a.turno === "Noche")
            .map((a) => `${a.paradaOtId}|${+new Date(a.fecha)}`),
        );
        for (const a of avances) {
          if (a.turno !== "Dia" || !flipIds.has(a.paradaOtId)) continue;
          if (nocheKeys.has(`${a.paradaOtId}|${+new Date(a.fecha)}`))
            avancesChoque.push(a);
          else avancesFlip.push(a);
        }
        aMover.push({ grupo: gDia, disc, n, otsFlip, otsAmbos, avancesFlip, avancesChoque });
      }
    }

    // grupos Noche vacíos fuera del objetivo (renumerados desde 1 por la UI)
    for (const g of grupos) {
      if (g.turno !== "Noche") continue;
      if (objetivoSet.has(`${g.disciplina}|${g.numero}`)) continue;
      if (gruposNocheVacios.includes(g)) continue;
      const roster = g._count.miembros;
      const ot = contarOtGrupo(g);
      if (roster === 0 && ot === 0) {
        if (LIMPIAR_VACIOS) gruposNocheVacios.push(g);
      } else {
        colisionOcupada.push({ grupo: g, rosterN: roster, otN: ot, fueraObjetivo: true });
      }
    }

    // ─── informe del plan ────────────────────────────────────────────────────
    console.log("PLAN");
    console.log("".padEnd(72, "─"));

    if (faltantes.length) {
      console.log(`⚠ Números objetivo SIN grupo de día (no se pueden mover):`);
      for (const f of faltantes) console.log(`    ${f}`);
      console.log("");
    }

    console.log(`Grupos Día → Noche (conservan número): ${aMover.length}`);
    for (const m of aMover) {
      console.log(
        `  ${m.disc} G${m.n}  ·  roster:${m.grupo._count.miembros}  ` +
          `OT "Dia"→"Noche": ${m.otsFlip.length}` +
          (m.otsFlip.length ? ` [${m.otsFlip.map((o) => o.numeroOT).join(", ")}]` : "") +
          (m.otsAmbos.length
            ? `  ·  OT "Ambos": ${m.otsAmbos.length} [${m.otsAmbos
                .map((o) => o.numeroOT)
                .join(", ")}] ${INCLUIR_AMBOS ? "(se pasan)" : "(SE DEJAN)"}`
            : "") +
          (m.avancesFlip.length ? `  ·  avances Dia→Noche: ${m.avancesFlip.length}` : "") +
          (m.avancesChoque.length
            ? `  ·  ⚠ avances que NO se mueven (choque): ${m.avancesChoque.length}`
            : ""),
      );
    }
    console.log("");

    console.log(`Grupos "Noche" VACÍOS a borrar: ${gruposNocheVacios.length}`);
    for (const g of gruposNocheVacios)
      console.log(`  ✗ ${g.disciplina} Noche G${g.numero}  (id ${g.id})`);
    console.log("");

    if (colisionOcupada.length) {
      console.log(
        `⛔ BLOQUEANTE — grupos "Noche" con roster/OT que impiden el cambio:`,
      );
      for (const c of colisionOcupada)
        console.log(
          `  ${c.grupo.disciplina} Noche G${c.grupo.numero}  roster:${c.rosterN}  OT:${c.otN}` +
            (c.fueraObjetivo ? "  (fuera del objetivo)" : "  (choca con un número objetivo)"),
        );
      console.log("");
      console.log(
        "Resolvé estos grupos a mano (borralos o reasignales número) y volvé a correr.",
      );
    }

    // TESA: recordatorio
    const tesaNoche = grupos.filter((g) => g.turno === "Noche" && g.disciplina === "TESA");
    console.log(
      `TESA en turno Noche tras el plan: ${
        tesaNoche.filter((g) => !gruposNocheVacios.includes(g)).length
      } (debe ser 0)`,
    );
    console.log("");

    if (!COMMIT) {
      console.log("DRY-RUN: no se escribió nada. Repetí con --commit para aplicar.");
      return;
    }
    if (colisionOcupada.length) {
      console.error("Abortado: hay grupos 'Noche' con roster/OT sin resolver.");
      process.exit(1);
    }

    // ─── aplicar ─────────────────────────────────────────────────────────────
    let gruposBorrados = 0;
    let gruposMovidos = 0;
    let otsMovidas = 0;
    let avancesMovidos = 0;

    await prisma.$transaction(
      async (tx) => {
        // 1) borrar grupos Noche vacíos (libera los números antes del move)
        if (gruposNocheVacios.length) {
          const r = await tx.paradaGrupo.deleteMany({
            where: { id: { in: gruposNocheVacios.map((g) => g.id) } },
          });
          gruposBorrados = r.count;
        }
        // 2) mover cada grupo de día a noche + sus OT + sus avances
        for (const m of aMover) {
          await tx.paradaGrupo.update({
            where: { id: m.grupo.id },
            data: { turno: "Noche" },
          });
          gruposMovidos++;

          const flipIds = [
            ...m.otsFlip.map((o) => o.id),
            ...(INCLUIR_AMBOS ? m.otsAmbos.map((o) => o.id) : []),
          ];
          if (flipIds.length) {
            const r = await tx.paradaOt.updateMany({
              where: { id: { in: flipIds } },
              data: { grupo: "Noche" },
            });
            otsMovidas += r.count;
          }
          if (m.avancesFlip.length) {
            const r = await tx.paradaAvanceDiario.updateMany({
              where: { id: { in: m.avancesFlip.map((a) => a.id) } },
              data: { turno: "Noche" },
            });
            avancesMovidos += r.count;
          }
        }
      },
      { timeout: 60000, maxWait: 20000 },
    );

    console.log("");
    console.log(
      `OK — grupos borrados: ${gruposBorrados} · grupos Día→Noche: ${gruposMovidos} · OT movidas: ${otsMovidas} · avances movidos: ${avancesMovidos}`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error("\nERROR:", e.message);
  process.exit(1);
});
