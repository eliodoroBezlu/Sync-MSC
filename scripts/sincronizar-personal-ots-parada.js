/* eslint-disable @typescript-eslint/no-require-imports */
// Sincroniza el personal de las OT de parada con el roster de su(s) cuadrilla(s)
// y normaliza el nombre de los miembros con cuenta al de su Usuario.
//
// Para cada ParadaGrupo de la parada (turno Día u Noche):
//   1) miembro con usuarioId cuyo nombre es MÁS corto que el de su Usuario
//      (menos palabras, compartiendo alguna) => nombre := nombre completo de la
//      cuenta. No toca los que ya coinciden ni los que no tienen cuenta.
//   2) OT que ejecuta SÓLO esta cuadrilla (un único turno):
//        personalAsignadoIds := ids de los miembros con cuenta
//        personalAsignado    := nombres de TODOS los miembros (con y sin cuenta)
//      Reemplaza lo que hubiera (la cuadrilla manda).
//   3) OT compartida día/noche (grupo="Ambos"): su personal es la UNIÓN del
//      roster de su cuadrilla de día (grupoNumero) y el de su cuadrilla de
//      noche (grupoNumeroNoche), que pueden ser grupos distintos.
//
// Antes este script sólo miraba `grupoNumero` (el slot de DÍA) para decidir
// qué OT le tocan a cada grupo, incluso al procesar un grupo de NOCHE. Como
// resultado, las OT compartidas (grupo="Ambos") nunca recibían el aporte del
// lado noche: alguien que sólo estaba en la cuadrilla nocturna de una OT
// compartida quedaba sin `personalAsignadoIds` y no veía esa OT, aunque su
// cuenta y el roster estuvieran bien.
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

// Combina dos rosters (nombre/usuarioId) en una lista sin duplicados por
// nombre normalizado, preservando el orden de aparición.
function unirRosters(...rosters) {
  const nombres = [];
  const vistos = new Set();
  const ids = new Set();
  for (const roster of rosters) {
    for (const m of roster) {
      const k = norm(m.nombre);
      if (k && !vistos.has(k)) {
        vistos.add(k);
        nombres.push(m.nombre);
      }
      if (m.usuarioId) ids.add(m.usuarioId);
    }
  }
  return { nombres, ids: [...ids] };
}

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
    // roster efectivo (con nombres ya normalizados) por grupo, clave "disc|turno|numero"
    const rosterPorGrupo = new Map();

    for (const g of grupos) {
      const label = `${g.disciplina} ${g.turno} G${g.numero}`;
      if (g.disciplina === "MIXTO" || g.miembros.length === 0) continue;

      const roster = [];
      for (const m of g.miembros) {
        let nombre = m.nombre;
        if (m.usuarioId) {
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
        roster.push({ nombre, usuarioId: m.usuarioId ?? null });
      }
      rosterPorGrupo.set(`${g.disciplina}|${g.turno}|${g.numero}`, roster);
    }

    // ─── 1) OT que ejecuta sólo un turno (roster = el de su única cuadrilla) ──
    const updatesSolo = []; // { where, nombres, ids, otNums, grupo }
    for (const g of grupos) {
      const label = `${g.disciplina} ${g.turno} G${g.numero}`;
      if (g.disciplina === "MIXTO" || g.miembros.length === 0) {
        console.log(`── ${label}  (saltado: ${g.disciplina === "MIXTO" ? "MIXTO" : "sin roster"})`);
        continue;
      }
      const roster = rosterPorGrupo.get(`${g.disciplina}|${g.turno}|${g.numero}`);
      const esDia = g.turno === "Dia";
      const where = esDia
        ? {
            paradaId: parada.id,
            disciplina: g.disciplina,
            grupoNumero: g.numero,
            grupoNumeroNoche: null,
            grupo: { not: "Noche" },
          }
        : {
            paradaId: parada.id,
            disciplina: g.disciplina,
            grupo: "Noche",
            OR: [
              { grupoNumeroNoche: g.numero },
              { grupoNumeroNoche: null, grupoNumero: g.numero },
            ],
          };
      const ots = await prisma.paradaOt.findMany({ where, select: { id: true, numeroOT: true } });
      const nombres = roster.map((m) => m.nombre);
      const ids = roster.map((m) => m.usuarioId).filter(Boolean);
      updatesSolo.push({ where, nombres, ids, otNums: ots.map((o) => o.numeroOT), grupo: label });
    }

    // ─── 2) OT compartidas día/noche (grupo="Ambos"): unión de ambos rosters ──
    const compartidas = await prisma.paradaOt.findMany({
      where: {
        paradaId: parada.id,
        grupo: "Ambos",
        ...(DISC ? { disciplina: DISC } : {}),
      },
      select: { id: true, numeroOT: true, disciplina: true, grupoNumero: true, grupoNumeroNoche: true },
    });
    // Agrupar por (disciplina, día, noche): todas las OT de un mismo par comparten el mismo roster.
    const pares = new Map(); // key -> { disciplina, dia, noche, otIds: [], otNums: [] }
    for (const o of compartidas) {
      const key = `${o.disciplina}|${o.grupoNumero}|${o.grupoNumeroNoche}`;
      if (!pares.has(key)) {
        pares.set(key, { disciplina: o.disciplina, dia: o.grupoNumero, noche: o.grupoNumeroNoche, otIds: [], otNums: [] });
      }
      const p = pares.get(key);
      p.otIds.push(o.id);
      p.otNums.push(o.numeroOT);
    }
    const updatesAmbos = []; // { where, nombres, ids, otNums, grupo }
    for (const p of pares.values()) {
      const rosterDia = p.dia != null ? rosterPorGrupo.get(`${p.disciplina}|Dia|${p.dia}`) ?? [] : [];
      const rosterNoche = p.noche != null ? rosterPorGrupo.get(`${p.disciplina}|Noche|${p.noche}`) ?? [] : [];
      const { nombres, ids } = unirRosters(rosterDia, rosterNoche);
      const label = `${p.disciplina} Ambos G${p.dia ?? "-"}(día)+G${p.noche ?? "-"}(noche)`;
      updatesAmbos.push({
        where: { id: { in: p.otIds } },
        nombres,
        ids,
        otNums: p.otNums,
        grupo: label,
      });
    }

    // ─── Informe ───────────────────────────────────────────────────────────────
    console.log(`Cuadrillas: ${grupos.length}`);
    console.log("");
    for (const u of updatesSolo) {
      console.log(`── ${u.grupo}`);
      console.log(`   personal (${u.nombres.length}, con cuenta ${u.ids.length}): ${u.nombres.join(" · ") || "—"}`);
      console.log(`   OT afectadas (${u.otNums.length}): ${u.otNums.join(", ") || "—"}`);
    }
    if (updatesAmbos.length) {
      console.log("\n── OT compartidas día/noche (\"Ambos\") ──");
      for (const u of updatesAmbos) {
        console.log(`── ${u.grupo}`);
        console.log(`   personal (${u.nombres.length}, con cuenta ${u.ids.length}): ${u.nombres.join(" · ") || "—"}`);
        console.log(`   OT afectadas (${u.otNums.length}): ${u.otNums.join(", ") || "—"}`);
      }
    }
    console.log("");
    console.log(`Nombres a normalizar (miembro con cuenta): ${normalizaciones.length}`);
    for (const n of normalizaciones) {
      console.log(`   · ${n.grupo}: "${n.de}"  →  "${n.a}"`);
    }
    console.log("");

    const totalOts =
      updatesSolo.reduce((s, u) => s + u.otNums.length, 0) +
      updatesAmbos.reduce((s, u) => s + u.otNums.length, 0);
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
        for (const u of [...updatesSolo, ...updatesAmbos]) {
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
