/* eslint-disable @typescript-eslint/no-require-imports */
// Unifica una cuadrilla de noche con la de día bajo el MISMO número, para el
// caso especial de trabajo continuo día/noche sobre las mismas OT.
//
// El modelo guarda un solo `grupoNumero` por OT, así que una OT no puede estar
// en "Grupo 8" y "Grupo 9" a la vez. La solución es que la cuadrilla nocturna
// pase a llamarse igual que la diurna (ej: Noche/ELEC/9 -> Noche/ELEC/8): así
// existen "Grupo 8 (Día)" y "Grupo 8 (Noche)" como dos rosters de la MISMA
// cuadrilla, y la OT compartida (grupo="Ambos", grupoNumero=8) aparece en el
// tab Día y en el tab Noche, cada uno con su gente.
//
// Qué hace:
//   1. Renombra la cuadrilla Noche/<disc>/<noche> a Noche/<disc>/<dia>.
//      (aborta si ya existe Noche/<disc>/<dia>).
//   2. Marca las OT indicadas como compartidas:
//        grupo="Ambos", grupoNumero=<dia>,
//        personalAsignado/Ids = UNIÓN del roster Día/<disc>/<dia> + Noche/<disc>/<dia>.
//
// El avance diario ya soporta día y noche por separado sobre la misma OT
// (ParadaAvanceDiario es único por [paradaOtId, fecha, turno]). El backend de
// grupos (POST /api/paradas/[id]/grupos) recompone la unión al guardar el
// roster de cualquiera de los dos turnos, así que esto no se vuelve a romper.
//
// Uso (informe, NO escribe nada):
//   PROD_DATABASE_URL="postgresql://…" node scripts/parada-unificar-cuadrilla-turnos.js
// Uso (aplica):
//   PROD_DATABASE_URL="postgresql://…" node scripts/parada-unificar-cuadrilla-turnos.js --commit
//
// Flags:
//   --codigo=PPML060      código de la parada (default PPML060)
//   --disc=ELEC           disciplina de las cuadrillas y las OT (default ELEC)
//   --dia=8               número de la cuadrilla de día (default 8)
//   --noche=9             número ACTUAL de la cuadrilla de noche a renombrar (default 9)
//   --ots=932669,948738  números de OT a compartir (default 932669,948738)
//   --commit             aplica los cambios (sin esto es sólo informe / dry-run)

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
    `Unificar ${DISC}: Noche G${N_NOCHE}  ->  Noche G${N_DIA}  (queda como Grupo ${N_DIA} día+noche)`,
  );
  console.log(`OT compartidas: ${OTS.join(", ")}`);
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

    const [gDia, gNocheAct, gNocheDestino] = await Promise.all([
      prisma.paradaGrupo.findFirst({
        where: { paradaId: parada.id, turno: "Dia", disciplina: DISC, numero: N_DIA },
        include: { miembros: true },
      }),
      prisma.paradaGrupo.findFirst({
        where: { paradaId: parada.id, turno: "Noche", disciplina: DISC, numero: N_NOCHE },
        include: { miembros: true },
      }),
      prisma.paradaGrupo.findFirst({
        where: { paradaId: parada.id, turno: "Noche", disciplina: DISC, numero: N_DIA },
        include: { miembros: true },
      }),
    ]);

    if (!gDia) {
      console.error(`No existe la cuadrilla ${DISC} Día G${N_DIA}.`);
      process.exit(1);
    }
    if (!gNocheAct && !gNocheDestino) {
      console.error(
        `No existe la cuadrilla ${DISC} Noche G${N_NOCHE} ni la G${N_DIA}. Nada para unificar.`,
      );
      process.exit(1);
    }
    if (gNocheAct && gNocheDestino) {
      console.error(
        `Colisión: ya existen ${DISC} Noche G${N_NOCHE} y ${DISC} Noche G${N_DIA}. ` +
          `Hay que fusionarlas a mano antes de correr esto.`,
      );
      process.exit(1);
    }

    const yaUnificada = !gNocheAct && gNocheDestino;
    const gNoche = gNocheDestino ?? gNocheAct;

    if (yaUnificada) {
      console.log(`La cuadrilla noche ya está como G${N_DIA}. Sólo se revisan las OT.`);
    } else {
      console.log(
        `Renombrar: ${DISC} Noche G${N_NOCHE} (id ${gNocheAct.id}) -> numero ${N_DIA}`,
      );
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

    console.log("");
    console.log(`Roster ${DISC} Día G${N_DIA}   (${gDia.miembros.length}): ${gDia.miembros.map((m) => m.nombre).join(" · ") || "—"}`);
    console.log(`Roster ${DISC} Noche         (${gNoche.miembros.length}): ${gNoche.miembros.map((m) => m.nombre).join(" · ") || "—"}`);
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
        if (!yaUnificada) {
          await tx.paradaGrupo.update({
            where: { id: gNocheAct.id },
            data: { numero: N_DIA },
          });
        }
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
    console.log(
      `OK — cuadrilla noche unificada como Grupo ${N_DIA} y ${aplicables.length} OT compartidas día/noche.`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error("\nERROR:", e.message);
  process.exit(1);
});
