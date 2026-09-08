/* eslint-disable @typescript-eslint/no-require-imports */
// Marca OT de una parada como COMPARTIDAS entre una cuadrilla de día y una de
// noche (caso especial de trabajo continuo día/noche sobre la misma OT).
//
// El modelo tiene un solo `grupoNumero` por OT, así que "compartir" se resuelve:
//   - grupo            = "Ambos"  (aparece en la pestaña Día y en la de Noche)
//   - grupoNumero      = número de la cuadrilla de DÍA (su "casa")
//   - personalAsignado / personalAsignadoIds = UNIÓN del roster de las dos
//     cuadrillas, para que todos los técnicos de ambos turnos la vean en
//     "Registro de OT" y ambos supervisores la reporten en su turno.
//
// El avance diario ya soporta día y noche por separado sobre la misma OT
// (ParadaAvanceDiario es único por [paradaOtId, fecha, turno]).
//
// OJO: si después editás el roster de la cuadrilla de DÍA desde la UI, el
// backend re-sincroniza el personal de sus OT y volvería a dejar sólo el roster
// de esa cuadrilla en estas OT. Si pasa, volvé a correr este script.
//
// Uso (informe, NO escribe nada):
//   PROD_DATABASE_URL="postgresql://…" node scripts/parada-ot-compartida.js
// Uso (aplica):
//   PROD_DATABASE_URL="postgresql://…" node scripts/parada-ot-compartida.js --commit
//
// Flags:
//   --codigo=PPML060       código de la parada (default PPML060)
//   --disc=ELEC            disciplina de las cuadrillas y las OT (default ELEC)
//   --dia=8                número de la cuadrilla de día (default 8)
//   --noche=9             número de la cuadrilla de noche (default 9)
//   --ots=932669,948738   números de OT a compartir (default 932669,948738)
//   --commit              aplica los cambios (sin esto es sólo informe / dry-run)

const { PrismaPg } = require("@prisma/adapter-pg");
const { PrismaClient } = require("@prisma/client");

const args = process.argv.slice(2);
const has = (f) => args.includes(f);
const val = (name, def) => {
  const p = args.find((a) => a.startsWith(`--${name}=`));
  return p ? p.slice(name.length + 3) : def;
};

const COMMIT = has("--commit");
const CODIGO = val("codigo", "PPML060");
const DISC = val("disc", "ELEC").toUpperCase();
const N_DIA = Number(val("dia", "8"));
const N_NOCHE = Number(val("noche", "9"));
const OTS = String(val("ots", "932669,948738"))
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

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
const norm = (s) =>
  String(s ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .trim();

async function main() {
  console.log(`Parada : ${CODIGO}`);
  console.log(`Base   : ${mask(URL)}`);
  console.log(`Modo   : ${COMMIT ? "COMMIT (aplica cambios)" : "DRY-RUN (solo informe)"}`);
  console.log(
    `Compartir ${DISC}: cuadrilla día G${N_DIA}  +  cuadrilla noche G${N_NOCHE}`,
  );
  console.log(`OT: ${OTS.join(", ")}`);
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

    const [gDia, gNoche] = await Promise.all([
      prisma.paradaGrupo.findFirst({
        where: { paradaId: parada.id, turno: "Dia", disciplina: DISC, numero: N_DIA },
        include: { miembros: true },
      }),
      prisma.paradaGrupo.findFirst({
        where: { paradaId: parada.id, turno: "Noche", disciplina: DISC, numero: N_NOCHE },
        include: { miembros: true },
      }),
    ]);
    if (!gDia) {
      console.error(`No existe la cuadrilla ${DISC} Día G${N_DIA}.`);
      process.exit(1);
    }
    if (!gNoche) {
      console.error(`No existe la cuadrilla ${DISC} Noche G${N_NOCHE}.`);
      process.exit(1);
    }

    // Unión de roster: nombres (dedup por normalizado) e ids.
    const nombres = [];
    const vistos = new Set();
    const ids = new Set();
    for (const g of [gDia, gNoche]) {
      for (const m of g.miembros) {
        const k = norm(m.nombre);
        if (k && !vistos.has(k)) {
          vistos.add(k);
          nombres.push(m.nombre);
        }
        if (m.usuarioId) ids.add(m.usuarioId);
      }
    }
    const idsArr = [...ids];

    console.log(`Roster ${DISC} Día G${N_DIA}   (${gDia.miembros.length}): ${gDia.miembros.map((m) => m.nombre).join(" · ") || "—"}`);
    console.log(`Roster ${DISC} Noche G${N_NOCHE} (${gNoche.miembros.length}): ${gNoche.miembros.map((m) => m.nombre).join(" · ") || "—"}`);
    console.log(`Unión (${nombres.length} personas, ${idsArr.length} con cuenta): ${nombres.join(" · ")}`);
    console.log("");

    const ots = await prisma.paradaOt.findMany({
      where: { paradaId: parada.id, numeroOT: { in: OTS } },
      select: {
        id: true,
        numeroOT: true,
        disciplina: true,
        fase: true,
        grupo: true,
        grupoNumero: true,
        personalAsignado: true,
        personalAsignadoIds: true,
      },
    });
    const encontradas = new Set(ots.map((o) => o.numeroOT));
    for (const n of OTS)
      if (!encontradas.has(n)) console.log(`⚠ OT ${n}: no existe en la parada.`);

    console.log("CAMBIOS POR OT");
    console.log("".padEnd(72, "─"));
    const aplicables = [];
    for (const o of ots) {
      const problemas = [];
      if (o.disciplina !== DISC) problemas.push(`disciplina ${o.disciplina} ≠ ${DISC}`);
      if (o.fase !== "ejecucion") problemas.push(`fase ${o.fase}`);
      console.log(
        `  OT ${o.numeroOT}  actual: grupo="${o.grupo}" grupoNumero=${o.grupoNumero} ` +
          `personal=${o.personalAsignado.length} (ids ${o.personalAsignadoIds.length})` +
          (problemas.length ? `   ⚠ ${problemas.join("; ")}` : ""),
      );
      console.log(
        `           nuevo : grupo="Ambos" grupoNumero=${N_DIA} personal=${nombres.length} (ids ${idsArr.length})`,
      );
      if (!problemas.length) aplicables.push(o);
    }
    console.log("");
    console.log(`OT a actualizar: ${aplicables.length} / ${OTS.length}`);

    if (!COMMIT) {
      console.log("");
      console.log("DRY-RUN: no se escribió nada. Repetí con --commit para aplicar.");
      return;
    }
    if (!aplicables.length) {
      console.error("Nada aplicable. Abortado.");
      process.exit(1);
    }

    await prisma.$transaction(
      async (tx) => {
        for (const o of aplicables) {
          await tx.paradaOt.update({
            where: { id: o.id },
            data: {
              grupo: "Ambos",
              grupoNumero: N_DIA,
              personalAsignado: nombres,
              personalAsignadoIds: idsArr,
            },
          });
        }
      },
      { timeout: 60000, maxWait: 20000 },
    );

    console.log("");
    console.log(`OK — ${aplicables.length} OT marcadas como compartidas día/noche.`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error("\nERROR:", e.message);
  process.exit(1);
});
