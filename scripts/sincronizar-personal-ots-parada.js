/* eslint-disable @typescript-eslint/no-require-imports */
// Sincroniza el personal de las OT de parada con el roster de su cuadrilla y
// normaliza el nombre de los miembros con cuenta al de su Usuario.
//
// Para cada ParadaGrupo de la parada:
//   1) miembro con usuarioId cuyo nombre es MÁS corto que el de su Usuario
//      (menos palabras, compartiendo alguna) => nombre := nombre completo de la
//      cuenta. No toca los que ya coinciden ni los que no tienen cuenta.
//   2) OT de la cuadrilla (grupoNumero = grupo.numero, grupo = turno o "Ambos",
//      y disciplina = grupo.disciplina salvo MIXTO):
//        personalAsignadoIds := ids de los miembros con cuenta
//        personalAsignado    := nombres de TODOS los miembros (con y sin cuenta)
//      Reemplaza lo que hubiera (la cuadrilla manda).
//
// Uso (informe, NO escribe nada):
//   PROD_DATABASE_URL="postgresql://…" node scripts/sincronizar-personal-ots-parada.js
// Uso (aplica):
//   PROD_DATABASE_URL="postgresql://…" node scripts/sincronizar-personal-ots-parada.js --commit
//
// Flags:
//   --codigo=PPML060     código de la parada (default PPML060)
//   --disciplina=INST    solo esa disciplina (default: todas)
//   --commit             aplica los cambios (sin esto es solo informe / dry-run)

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
const DISC = (val("disciplina", "") || "").toUpperCase();

const URL =
  process.env.PROD_DATABASE_URL ||
  process.env.DATABASE_PUBLIC_URL ||
  process.env.DATABASE_URL;
if (!URL) {
  console.error("Falta PROD_DATABASE_URL / DATABASE_PUBLIC_URL / DATABASE_URL en el entorno.");
  process.exit(1);
}
const esRailway = /rlwy\.net|railway|proxy\.rlwy/.test(URL);
const mask = (u) => u.replace(/:\/\/[^@]+@/, "://***@");

function norm(s) {
  return String(s ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .trim();
}
const tokens = (s) => norm(s).split(" ").filter(Boolean);
const shared = (a, b) => {
  const sb = new Set(tokens(b));
  return tokens(a).filter((t) => sb.has(t)).length;
};

async function main() {
  console.log(`Parada     : ${CODIGO}`);
  console.log(`Disciplina : ${DISC || "(todas)"}`);
  console.log(`Base       : ${mask(URL)}`);
  console.log(`Modo       : ${COMMIT ? "COMMIT (aplica cambios)" : "DRY-RUN (solo informe)"}`);
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

    const grupos = await prisma.paradaGrupo.findMany({
      where: { paradaId: parada.id, ...(DISC ? { disciplina: DISC } : {}) },
      include: { miembros: true },
      orderBy: [{ disciplina: "asc" }, { turno: "asc" }, { numero: "asc" }],
    });

    const uids = [
      ...new Set(grupos.flatMap((g) => g.miembros.map((m) => m.usuarioId).filter(Boolean))),
    ];
    const usuarios = uids.length
      ? await prisma.usuario.findMany({ where: { id: { in: uids } } })
      : [];
    const nombreCuenta = new Map(
      usuarios.map((u) => [u.id, [u.nombre, u.apellido].filter(Boolean).join(" ").replace(/\s+/g, " ").trim()]),
    );

    const normalizaciones = []; // { miembroId, de, a, grupo }
    const updatesOt = []; // { where, nombres, ids, otNums, grupo }

    for (const g of grupos) {
      const label = `${g.disciplina} ${g.turno} G${g.numero}`;
      const nombresEfectivos = [];
      const ids = [];

      for (const m of g.miembros) {
        let nombre = m.nombre;
        if (m.usuarioId) {
          ids.push(m.usuarioId);
          const full = nombreCuenta.get(m.usuarioId);
          if (
            full &&
            full !== m.nombre &&
            tokens(full).length > tokens(m.nombre).length &&
            shared(full, m.nombre) >= 1
          ) {
            normalizaciones.push({ miembroId: m.id, de: m.nombre, a: full, grupo: label });
            nombre = full;
          }
        }
        nombresEfectivos.push(nombre);
      }

      const where = {
        paradaId: parada.id,
        grupoNumero: g.numero,
        OR: [{ grupo: g.turno }, { grupo: "Ambos" }],
        ...(g.disciplina !== "MIXTO" ? { disciplina: g.disciplina } : {}),
      };
      const ots = await prisma.paradaOt.findMany({
        where,
        select: { id: true, numeroOT: true },
      });

      updatesOt.push({
        where,
        nombres: nombresEfectivos,
        ids,
        otNums: ots.map((o) => o.numeroOT),
        grupo: label,
      });
    }

    // ─── Informe ───────────────────────────────────────────────────────────────
    console.log(`Cuadrillas: ${grupos.length}`);
    console.log("");
    for (const u of updatesOt) {
      console.log(`── ${u.grupo}`);
      console.log(`   personal (${u.nombres.length}, con cuenta ${u.ids.length}): ${u.nombres.join(" · ") || "—"}`);
      console.log(`   OT afectadas (${u.otNums.length}): ${u.otNums.join(", ") || "—"}`);
    }
    console.log("");
    console.log(`Nombres a normalizar (miembro con cuenta): ${normalizaciones.length}`);
    for (const n of normalizaciones) {
      console.log(`   · ${n.grupo}: "${n.de}"  →  "${n.a}"`);
    }
    console.log("");

    const totalOts = updatesOt.reduce((s, u) => s + u.otNums.length, 0);
    console.log(`Total OT a actualizar: ${totalOts}`);

    if (!COMMIT) {
      console.log("");
      console.log("DRY-RUN: no se escribió nada. Repetí con --commit para aplicar.");
      return;
    }

    // ─── Aplicar ──────────────────────────────────────────────────────────────
    await prisma.$transaction(
      async (tx) => {
        for (const n of normalizaciones) {
          await tx.paradaGrupoMiembro.update({
            where: { id: n.miembroId },
            data: { nombre: n.a },
          });
        }
        for (const u of updatesOt) {
          await tx.paradaOt.updateMany({
            where: u.where,
            data: { personalAsignado: u.nombres, personalAsignadoIds: u.ids },
          });
        }
      },
      { timeout: 60000, maxWait: 20000 },
    );

    console.log("");
    console.log(`OK — ${normalizaciones.length} nombres normalizados, ${totalOts} OT sincronizadas.`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
