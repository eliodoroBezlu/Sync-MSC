/* eslint-disable @typescript-eslint/no-require-imports */
// Corrige la carga del roster de Instrumentación: el loader creó cuentas de
// Usuario para los CONTRATISTAS DE PARADA (temporales) y ligó los miembros de
// cuadrilla a esas cuentas, así que aparecen como "personal con cuenta".
//
// Fuente de verdad: `docs/plantilla_integrantes_parada.xlsx`, hoja "Integrantes".
//   - Fila de NOMBRE resaltada en AMARILLO (relleno FFFF00) => contratista de
//     parada: NO debe tener cuenta.
//   - Fila sin resaltar => personal de minera / contratista fijo: se respeta.
//
// Qué hace, para la parada indicada (default PPML060) y disciplina INST:
//   1) A cada ParadaGrupoMiembro cuyo nombre coincide con un resaltado y que
//      tiene usuarioId => le pone usuarioId = null (conserva el nombre).
//   2) Quita ese usuarioId de ParadaOt.personalAsignadoIds de la parada.
//   3) Borra el Usuario huérfano, SOLO si es seguro:
//        - passwordHash == null  (nunca fijó contraseña / nunca inició sesión)
//        - rol in (4, 6)
//        - no lo referencia ningún otro ParadaGrupoMiembro fuera de este set
//      Si no pasa un guard: se reporta y NO se borra (pero el miembro igual
//      queda sin usuarioId, que es lo que arregla el color en la UI).
//
// Uso (informe, NO escribe nada):
//   PROD_DATABASE_URL="postgresql://…" node scripts/limpiar-contratistas-parada-ins.js
//
// Uso (aplica):
//   PROD_DATABASE_URL="postgresql://…" node scripts/limpiar-contratistas-parada-ins.js --commit
//
// Flags:
//   --codigo=PPML060   código de la parada (default PPML060)
//   --xlsx=<ruta>      Excel a leer (default docs/plantilla_integrantes_parada.xlsx)
//   --disciplina=INST  disciplina de las cuadrillas a corregir (default INST)
//   --extra="A;B;C"    nombres extra a tratar como contratista de parada aunque
//                      NO estén resaltados en el Excel (separador ";")
//   --commit           aplica los cambios (sin esto es solo informe / dry-run)

const path = require("path");
const xlsx = require("xlsx");
const { PrismaPg } = require("@prisma/adapter-pg");
const { PrismaClient } = require("@prisma/client");

// ─── args ────────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const has = (f) => args.includes(f);
const val = (name, def) => {
  const p = args.find((a) => a.startsWith(`--${name}=`));
  return p ? p.slice(name.length + 3) : def;
};
const COMMIT = has("--commit");
const CODIGO = val("codigo", "PPML060");
const DISCIPLINA = val("disciplina", "INST").toUpperCase();
const XLSX_PATH = path.resolve(
  process.cwd(),
  val("xlsx", "docs/plantilla_integrantes_parada.xlsx"),
);
const DISC_XLSX = { ELEC: "ELE", INST: "INS", TESA: "TESA" }[DISCIPLINA] ?? DISCIPLINA;
const EXTRA = (val("extra", "") || "")
  .split(";")
  .map((s) => s.trim())
  .filter(Boolean);

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

// ─── helpers ─────────────────────────────────────────────────────────────────
function norm(s) {
  return String(s ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .trim();
}
const tokenSet = (s) => norm(s).split(" ").filter(Boolean).sort().join(" ");

function esAmarillo(cell) {
  const s = cell && cell.s;
  if (!s || s.patternType !== "solid") return false;
  let rgb = (s.fgColor && s.fgColor.rgb) || "";
  if (rgb.length === 8) rgb = rgb.slice(2); // saca alfa FFxxxxxx
  return rgb.toUpperCase() === "FFFF00";
}

// ─── leer Excel: resaltados vs no-resaltados de la disciplina ─────────────────
function leerPlantilla() {
  const wb = xlsx.readFile(XLSX_PATH, { cellStyles: true });
  const ws = wb.Sheets["Integrantes"];
  if (!ws) throw new Error('El Excel no tiene la hoja "Integrantes".');
  const ref = xlsx.utils.decode_range(ws["!ref"]);

  const resaltados = new Map(); // tokenSet -> { nombre, codigos:Set }
  const minera = new Map(); // tokenSet -> nombre (no resaltado)

  for (let R = ref.s.r + 1; R <= ref.e.r; R++) {
    const at = (C) => ws[xlsx.utils.encode_cell({ r: R, c: C })];
    const disc = String((at(0) || {}).v ?? "").trim().toUpperCase();
    if (disc !== DISC_XLSX) continue;
    const codigo = String((at(2) || {}).v ?? "").trim().toUpperCase();
    const nomCell = at(4);
    const nombre = String((nomCell || {}).v ?? "").replace(/\s+/g, " ").trim();
    if (!nombre || nombre.toLowerCase() === "undefined") continue;

    const ts = tokenSet(nombre);
    if (esAmarillo(nomCell)) {
      const cur = resaltados.get(ts) ?? { nombre, codigos: new Set() };
      if (codigo) cur.codigos.add(codigo);
      resaltados.set(ts, cur);
    } else {
      if (!minera.has(ts)) minera.set(ts, nombre);
    }
  }
  return { resaltados, minera };
}

async function main() {
  console.log(`Parada        : ${CODIGO}`);
  console.log(`Disciplina    : ${DISCIPLINA}`);
  console.log(`Excel         : ${XLSX_PATH}`);
  console.log(`Base          : ${mask(URL)}`);
  console.log(`Modo          : ${COMMIT ? "COMMIT (aplica cambios)" : "DRY-RUN (solo informe)"}`);
  console.log("");

  const { resaltados, minera } = leerPlantilla();

  // Nombres extra pasados por --extra: se tratan como contratista de parada
  // aunque no estén resaltados. Si el nombre figura como minera en el Excel,
  // se saca de esa lista para que sí se procese.
  for (const nombre of EXTRA) {
    const ts = tokenSet(nombre);
    minera.delete(ts);
    if (!resaltados.has(ts)) {
      resaltados.set(ts, { nombre, codigos: new Set(["(--extra)"]) });
    }
  }

  console.log(
    `Contratistas de parada (resaltados en el Excel${EXTRA.length ? ` + ${EXTRA.length} extra` : ""}): ${resaltados.size}`,
  );
  for (const { nombre, codigos } of resaltados.values()) {
    console.log(`  · ${nombre}${codigos.size ? `  [${[...codigos].join(", ")}]` : ""}`);
  }
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
      where: { paradaId: parada.id, disciplina: DISCIPLINA },
      include: { miembros: true },
      orderBy: [{ turno: "asc" }, { numero: "asc" }],
    });

    // Miembros a desligar: nombre coincide con un resaltado y tiene usuarioId.
    const aDesligar = []; // { miembroId, usuarioId, nombre, grupo }
    const chocaConMinera = []; // resaltado cuyo tokenSet también es de minera (no tocar)
    for (const g of grupos) {
      for (const m of g.miembros) {
        const ts = tokenSet(m.nombre);
        if (!resaltados.has(ts)) continue;
        if (minera.has(ts)) {
          chocaConMinera.push({ nombre: m.nombre, grupo: g.numero });
          continue;
        }
        if (!m.usuarioId) continue; // ya está como nombre suelto
        aDesligar.push({
          miembroId: m.id,
          usuarioId: m.usuarioId,
          nombre: m.nombre,
          grupo: `${g.turno} G${g.numero}`,
        });
      }
    }

    const usuarioIds = [...new Set(aDesligar.map((x) => x.usuarioId))];
    const usuarios = usuarioIds.length
      ? await prisma.usuario.findMany({ where: { id: { in: usuarioIds } } })
      : [];
    const usuarioPorId = new Map(usuarios.map((u) => [u.id, u]));

    // ¿Algún usuario a borrar está referenciado por OTROS miembros (otra
    // disciplina / otra parada) que NO estamos desligando?
    const refsExternas = usuarioIds.length
      ? await prisma.paradaGrupoMiembro.findMany({
          where: { usuarioId: { in: usuarioIds } },
          select: { id: true, usuarioId: true, grupo: { select: { disciplina: true, paradaId: true } } },
        })
      : [];
    const idsDesligar = new Set(aDesligar.map((x) => x.miembroId));
    const refExternaPorUsuario = new Map();
    for (const r of refsExternas) {
      if (idsDesligar.has(r.id)) continue;
      const arr = refExternaPorUsuario.get(r.usuarioId) ?? [];
      arr.push(r);
      refExternaPorUsuario.set(r.usuarioId, arr);
    }

    // Clasificar cada usuario: BORRAR o CONSERVAR (con motivo).
    const aBorrar = [];
    const aConservar = [];
    for (const uid of usuarioIds) {
      const u = usuarioPorId.get(uid);
      if (!u) {
        aConservar.push({ uid, nombre: "(no existe)", motivo: "el Usuario ya no existe" });
        continue;
      }
      const nombreU = [u.nombre, u.apellido].filter(Boolean).join(" ");
      const motivos = [];
      if (u.passwordHash) motivos.push("tiene contraseña (cuenta real)");
      if (![4, 6].includes(u.rol)) motivos.push(`rol ${u.rol} (no es técnico/contratista)`);
      if (refExternaPorUsuario.has(uid)) {
        const d = [...new Set(refExternaPorUsuario.get(uid).map((r) => r.grupo.disciplina))];
        motivos.push(`lo usan otras cuadrillas [${d.join(", ")}]`);
      }
      if (motivos.length) aConservar.push({ uid, nombre: nombreU, motivo: motivos.join("; ") });
      else aBorrar.push({ uid, nombre: nombreU, disciplina: u.disciplina, rol: u.rol });
    }

    // OTs de la parada que referencian a estos usuarios en personalAsignadoIds.
    const ots = await prisma.paradaOt.findMany({
      where: { paradaId: parada.id },
      select: { id: true, numeroOT: true, personalAsignado: true, personalAsignadoIds: true },
    });
    const idsBorrarSet = new Set(aBorrar.map((x) => x.uid));
    const otsAlimpiar = ots.filter((o) => o.personalAsignadoIds.some((id) => idsBorrarSet.has(id)));

    // ─── Informe ───────────────────────────────────────────────────────────────
    console.log(`Cuadrillas ${DISCIPLINA} en la parada : ${grupos.length}`);
    console.log(`Miembros a desligar (usuarioId -> null): ${aDesligar.length}`);
    for (const x of aDesligar) console.log(`  · ${x.grupo.padEnd(10)} ${x.nombre}`);
    console.log("");
    console.log(`Usuarios a BORRAR: ${aBorrar.length}`);
    for (const x of aBorrar) console.log(`  ✗ ${x.nombre}  (${x.disciplina}, rol ${x.rol})`);
    console.log("");
    if (aConservar.length) {
      console.log(`Usuarios que NO se borran (se revisan a mano): ${aConservar.length}`);
      for (const x of aConservar) console.log(`  ! ${x.nombre} — ${x.motivo}`);
      console.log("");
    }
    if (otsAlimpiar.length) {
      console.log(`OTs a las que se les quita el id de personalAsignadoIds: ${otsAlimpiar.length}`);
      for (const o of otsAlimpiar) console.log(`  · ${o.numeroOT}`);
      console.log("");
    }
    if (chocaConMinera.length) {
      console.log(`ATENCIÓN — resaltados que también figuran como minera (NO se tocan):`);
      for (const x of chocaConMinera) console.log(`  ? G${x.grupo} ${x.nombre}`);
      console.log("");
    }

    // Resaltados del Excel que no aparecieron en ninguna cuadrilla.
    const vistos = new Set(aDesligar.map((x) => tokenSet(x.nombre)));
    const noVistos = [...resaltados.values()].filter((r) => !vistos.has(tokenSet(r.nombre)));
    if (noVistos.length) {
      console.log(`Resaltados del Excel sin miembro con cuenta en la parada (nada que hacer):`);
      for (const r of noVistos) console.log(`  - ${r.nombre}`);
      console.log("");
    }

    if (!COMMIT) {
      console.log("DRY-RUN: no se escribió nada. Repetí con --commit para aplicar.");
      return;
    }

    // ─── Aplicar ──────────────────────────────────────────────────────────────
    // Pocas sentencias (updateMany + updates de OT + deleteMany) para no pasar
    // el timeout de transacción con la latencia al proxy de Railway.
    const miembroIds = aDesligar.map((x) => x.miembroId);
    await prisma.$transaction(
      async (tx) => {
        if (miembroIds.length) {
          await tx.paradaGrupoMiembro.updateMany({
            where: { id: { in: miembroIds } },
            data: { usuarioId: null },
          });
        }
        for (const o of otsAlimpiar) {
          await tx.paradaOt.update({
            where: { id: o.id },
            data: { personalAsignadoIds: o.personalAsignadoIds.filter((id) => !idsBorrarSet.has(id)) },
          });
        }
        if (idsBorrarSet.size) {
          await tx.usuario.deleteMany({ where: { id: { in: [...idsBorrarSet] } } });
        }
      },
      { timeout: 60000, maxWait: 20000 },
    );

    console.log("");
    console.log(`OK — ${aDesligar.length} miembros desligados, ${aBorrar.length} usuarios borrados, ${otsAlimpiar.length} OTs limpiadas.`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
