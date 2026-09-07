/* eslint-disable @typescript-eslint/no-require-imports */
// Carga el roster de cuadrillas de una parada desde el Excel
// `docs/plantilla_integrantes_parada.xlsx` a las tablas ParadaGrupo /
// ParadaGrupoMiembro.
//
// Uso (informe, NO escribe nada):
//   PROD_DATABASE_URL="postgresql://…" node scripts/parada-integrantes.js
//
// Uso (escribe):
//   PROD_DATABASE_URL="postgresql://…" node scripts/parada-integrantes.js --commit
//
// Flags:
//   --codigo=PPML060   código de la parada (default PPML060)
//   --xlsx=<ruta>      Excel a leer (default docs/plantilla_integrantes_parada.xlsx)
//   --commit           aplica los cambios (sin esto es solo informe / dry-run)
//   --crear-usuarios   crea como Usuario (rol 4, Técnico) a los integrantes que
//                      no coincidan con nadie del sistema, y liga TODOS los
//                      miembros a su usuario (así aparecen en Configuración).
//
// Reglas acordadas:
//   - Todos los grupos van a turno "Dia".
//   - Nadie se marca como líder (esLider = false) en esta carga.
//   - Una cuadrilla del Excel = una fila distinta de la columna GRUPO
//     (para ELEC/INST) o un código distinto (para TESA: G1..G4).
//   - El número de ParadaGrupo se resuelve así:
//       1) TESA: el dígito del código (G1→1, …, G4→4).
//       2) el grupoNumero que ya tienen las OTs de ese código (ParadaOt) —
//          así las cuadrillas que ya existen conservan su vínculo con las OTs.
//       3) las cuadrillas nuevas (sin OTs) reciben el siguiente número libre
//          de esa disciplina, después del máximo existente.
//   - Reemplaza el roster completo de cada cuadrilla del Excel
//     (deleteMany + createMany). No toca cuadrillas que no estén en el Excel.
//
// Matcheo de nombres contra Usuario:
//   1) exacto por conjunto de tokens (orden indistinto).
//   2) flexible: si TODOS los tokens del nombre del Excel están contenidos en
//      el nombre de UN solo usuario (≥2 tokens), se liga a ese — evita crear
//      duplicados de gente que ya existe con el nombre algo distinto.
//   3) con --crear-usuarios: los que siguen sin match se crean como Técnico.

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
const CREAR_USUARIOS = has("--crear-usuarios");
const CODIGO = val("codigo", "PPML060");
const XLSX_PATH = path.resolve(
  process.cwd(),
  val("xlsx", "docs/plantilla_integrantes_parada.xlsx"),
);

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

// ─── helpers ─────────────────────────────────────────────────────────────────
const DISCIPLINA_DB = { ELE: "ELEC", INS: "INST", TESA: "TESA" };
// disciplina del Usuario que se crea para un integrante de esa cuadrilla
const DISCIPLINA_USUARIO = { ELEC: "ELEC", INST: "INST", TESA: "GENERAL" };

function norm(s) {
  return String(s ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .trim();
}
function tokenSet(s) {
  return norm(s).split(" ").filter(Boolean).sort().join(" ");
}
function tokens(s) {
  return norm(s).split(" ").filter(Boolean);
}
function limpiarNombre(s) {
  return String(s ?? "").replace(/\s+/g, " ").trim();
}
function tituloCase(s) {
  return limpiarNombre(s)
    .split(" ")
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1).toLowerCase() : w))
    .join(" ");
}
function mask(u) {
  return u.replace(/:\/\/[^@]+@/, "://***@");
}

// ─── leer Excel ──────────────────────────────────────────────────────────────
function leerPlantilla() {
  const wb = xlsx.readFile(XLSX_PATH);
  const hojaInt = wb.Sheets["Integrantes"];
  if (!hojaInt) throw new Error('El Excel no tiene la hoja "Integrantes".');
  const filas = xlsx.utils
    .sheet_to_json(hojaInt, { header: 1, defval: "" })
    .slice(1);

  // Una cuadrilla por: TESA → código; ELEC/INST → número de la columna GRUPO.
  const grupos = new Map();
  for (const r of filas) {
    const discXlsx = String(r[0] ?? "").trim().toUpperCase();
    const grupoNum = Number(r[1]) || null;
    const codigo = String(r[2] ?? "").trim().toUpperCase();
    const supervisor = String(r[3] ?? "").trim();
    const nombre = limpiarNombre(r[4]);
    if (!discXlsx || !codigo) continue;
    const disciplina = DISCIPLINA_DB[discXlsx];
    if (!disciplina) continue;

    const clave =
      disciplina === "TESA"
        ? `${disciplina}|${codigo}`
        : `${disciplina}|G${grupoNum}`;

    if (!grupos.has(clave)) {
      grupos.set(clave, {
        clave,
        disciplina,
        codigo,
        grupoNumPlantilla: grupoNum,
        supervisor: "",
        miembros: [],
        _vistos: new Set(),
      });
    }
    const g = grupos.get(clave);
    if (!g.supervisor && supervisor) g.supervisor = supervisor;
    if (nombre) {
      const k = norm(nombre);
      if (!g._vistos.has(k)) {
        g._vistos.add(k);
        g.miembros.push(nombre);
      }
    }
  }

  // dotación de apoyo (opcional) — clave por código
  const dotApoyo = new Map();
  const hojaDot = wb.Sheets["Dotacion"];
  if (hojaDot) {
    for (const r of xlsx.utils
      .sheet_to_json(hojaDot, { header: 1, defval: "" })
      .slice(1)) {
      const disc = DISCIPLINA_DB[String(r[0] ?? "").trim().toUpperCase()];
      const codigo = String(r[2] ?? "").trim().toUpperCase();
      const n = Number(r[3]);
      if (disc && codigo && Number.isFinite(n) && n > 0) {
        dotApoyo.set(`${disc}|${codigo}`, Math.trunc(n));
      }
    }
  }

  return { grupos: [...grupos.values()], dotApoyo };
}

// ─── resolver número base (fase 1) ───────────────────────────────────────────
function numeroPorRegla(g, otCodigoMap) {
  if (g.disciplina === "TESA") {
    const m = g.codigo.match(/(\d+)/);
    if (m) return { numero: Number(m[1]), fuente: "codigo TESA" };
  }
  const porOt = otCodigoMap.get(`${g.disciplina}|${g.codigo}`);
  if (porOt != null) return { numero: porOt, fuente: "OTs" };
  return { numero: null, fuente: null };
}

// ─── main ────────────────────────────────────────────────────────────────────
(async () => {
  console.log(`Excel : ${XLSX_PATH}`);
  console.log(`BD    : ${mask(URL)}`);
  console.log(`Parada: ${CODIGO}`);
  console.log(`Modo  : ${COMMIT ? "COMMIT (escribe)" : "DRY-RUN (solo informe)"}`);
  console.log(
    `Crear usuarios: ${CREAR_USUARIOS ? "SÍ (rol 4 para los sin match)" : "no"}`,
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

    const [otsRaw, gruposExistentes, usuarios] = await Promise.all([
      prisma.paradaOt.findMany({
        where: { paradaId: parada.id },
        select: { disciplina: true, grupoCodigo: true, grupoNumero: true },
      }),
      prisma.paradaGrupo.findMany({
        where: { paradaId: parada.id },
        include: {
          _count: { select: { miembros: true } },
          miembros: { select: { nombre: true } },
        },
      }),
      prisma.usuario.findMany({
        select: { id: true, nombre: true, apellido: true, activo: true },
      }),
    ]);

    // map disciplina|código → grupoNumero (desde las OTs, valor mayoritario)
    const otCodigoMap = new Map();
    {
      const cuenta = new Map();
      for (const o of otsRaw) {
        if (!o.grupoCodigo || o.grupoNumero == null) continue;
        const clave = `${o.disciplina}|${String(o.grupoCodigo).toUpperCase()}`;
        const inner = cuenta.get(clave) ?? new Map();
        inner.set(o.grupoNumero, (inner.get(o.grupoNumero) ?? 0) + 1);
        cuenta.set(clave, inner);
      }
      for (const [clave, inner] of cuenta) {
        let mejor = null;
        let max = -1;
        for (const [num, n] of inner) if (n > max) ((max = n), (mejor = num));
        otCodigoMap.set(clave, mejor);
      }
    }

    // grupos existentes por (disciplina, numero) — ignora turno para el match,
    // prefiere el que ya está en turno "Dia"
    const existentePorDiscNum = new Map();
    for (const g of gruposExistentes) {
      const k = `${g.disciplina}|${g.numero}`;
      if (!existentePorDiscNum.has(k) || g.turno === "Dia")
        existentePorDiscNum.set(k, g);
    }

    // números ocupados por disciplina (para asignar los nuevos)
    const ocupados = new Map(); // disciplina -> Set<number>
    for (const g of gruposExistentes) {
      const s = ocupados.get(g.disciplina) ?? new Set();
      s.add(g.numero);
      ocupados.set(g.disciplina, s);
    }

    // índice de usuarios por conjunto de tokens del nombre (match exacto)
    const idxUsuario = new Map();
    // conjunto de tokens completo por usuario (match flexible por subconjunto)
    const tokensUsuario = new Map();
    for (const u of usuarios) {
      const variantes = [
        u.nombre,
        u.apellido ? `${u.nombre} ${u.apellido}` : null,
        u.apellido ? `${u.apellido} ${u.nombre}` : null,
      ].filter(Boolean);
      for (const v of variantes) {
        const k = tokenSet(v);
        if (!k) continue;
        const arr = idxUsuario.get(k) ?? [];
        arr.push(u);
        idxUsuario.set(k, arr);
      }
      tokensUsuario.set(
        u.id,
        new Set([...tokens(u.nombre), ...tokens(u.apellido)]),
      );
    }
    const matchUsuario = (nombre) => {
      const arr = idxUsuario.get(tokenSet(nombre));
      if (arr && arr.length) {
        const unicos = [...new Map(arr.map((u) => [u.id, u])).values()];
        if (unicos.length > 1) return { estado: "ambiguo", usuario: null };
        return { estado: "ok", usuario: unicos[0] };
      }
      // match flexible: todos los tokens del Excel dentro de un único usuario
      const ts = tokens(nombre);
      if (ts.length >= 2) {
        const cand = [];
        for (const u of usuarios) {
          const set = tokensUsuario.get(u.id);
          if (ts.every((t) => set.has(t))) cand.push(u);
        }
        const unicos = [...new Map(cand.map((u) => [u.id, u])).values()];
        if (unicos.length === 1)
          return { estado: "ok~", usuario: unicos[0] };
      }
      return { estado: "sin match", usuario: null };
    };

    const { grupos, dotApoyo } = leerPlantilla();

    // Fase 1: número por regla (TESA / OTs). Si dos cuadrillas del Excel
    // reclaman el mismo número (p. ej. ELE grupo 8 y 9, ambas código "TURNO",
    // y las OTs mapean "TURNO" → n8), la primera se lo queda y la segunda
    // pasa a la fase 2 para recibir un número nuevo.
    const claimados = new Map(); // disciplina -> Set<number> reclamados en esta corrida
    for (const g of grupos) {
      const { numero, fuente } = numeroPorRegla(g, otCodigoMap);
      const yaReclamado =
        numero != null && (claimados.get(g.disciplina)?.has(numero) ?? false);
      if (numero == null || yaReclamado) {
        g.numero = null;
        g.fuente = null;
        continue;
      }
      g.numero = numero;
      g.fuente = fuente;
      for (const mapa of [claimados, ocupados]) {
        const s = mapa.get(g.disciplina) ?? new Set();
        s.add(numero);
        mapa.set(g.disciplina, s);
      }
    }

    // ids de grupos existentes ya "tomados" por un match de fase 1
    const usados = new Set();
    for (const g of grupos) {
      if (g.numero == null) continue;
      const e = existentePorDiscNum.get(`${g.disciplina}|${g.numero}`);
      if (e) usados.add(e.id);
    }

    // Fase 2: los que quedaron sin número.
    //   2a) idempotencia: si ya existe una cuadrilla de esa disciplina (creada
    //       en una corrida anterior de este script, sin OTs que la anclen) cuyo
    //       roster coincide con el del Excel, se reutiliza esa — no se duplica.
    //   2b) si no, se le da el siguiente número libre de la disciplina.
    const setNombres = (arr) =>
      new Set(arr.map((x) => norm(typeof x === "string" ? x : x.nombre)));
    const rosterCoincide = (aSet, bSet) => {
      if (aSet.size === 0 || bSet.size === 0) return false;
      let comunes = 0;
      for (const x of aSet) if (bSet.has(x)) comunes++;
      // igualdad de conjuntos, o uno contenido en el otro (re-run tras editar)
      return comunes === aSet.size || comunes === bSet.size;
    };
    const pendientes = grupos
      .filter((g) => g.numero == null)
      .sort(
        (a, b) => (a.grupoNumPlantilla ?? 999) - (b.grupoNumPlantilla ?? 999),
      );
    for (const g of pendientes) {
      const s = ocupados.get(g.disciplina) ?? new Set();
      const gSet = setNombres(g.miembros);
      const previo = gruposExistentes.find(
        (e) =>
          e.disciplina === g.disciplina &&
          !usados.has(e.id) &&
          rosterCoincide(gSet, setNombres(e.miembros)),
      );
      if (previo) {
        g.numero = previo.numero;
        g.fuente = "roster previo";
        g.existenteForzado = previo;
        usados.add(previo.id);
        s.add(previo.numero);
        ocupados.set(g.disciplina, s);
        continue;
      }
      let n = 1;
      while (s.has(n)) n++;
      g.numero = n;
      g.fuente = "nuevo";
      s.add(n);
      ocupados.set(g.disciplina, s);
    }

    // armar plan final
    const plan = grupos.map((g) => {
      const existente =
        g.existenteForzado ??
        existentePorDiscNum.get(`${g.disciplina}|${g.numero}`) ??
        null;
      const miembros = g.miembros.map((nombre) => {
        const m = matchUsuario(nombre);
        const u = m.usuario;
        const usuarioNombre = u
          ? u.apellido
            ? `${u.nombre} ${u.apellido}`
            : u.nombre
          : null;
        return {
          nombre,
          usuarioId: u?.id ?? null,
          usuarioNombre,
          match: m.estado,
        };
      });
      return {
        ...g,
        turno: "Dia",
        existente,
        dotApoyo: dotApoyo.get(`${g.disciplina}|${g.codigo}`) ?? null,
        miembros,
      };
    });
    plan.sort(
      (a, b) => a.disciplina.localeCompare(b.disciplina) || a.numero - b.numero,
    );

    // ─── usuarios a crear (--crear-usuarios) ─────────────────────────────────
    // dedup por nombre normalizado: una persona en 2 cuadrillas = 1 usuario.
    const usuariosACrear = new Map(); // norm(nombre) -> { nombre, disciplina, grupos:[] }
    for (const g of plan) {
      for (const m of g.miembros) {
        if (m.usuarioId) continue;
        const k = norm(m.nombre);
        if (!k) continue;
        const discU = DISCIPLINA_USUARIO[g.disciplina] ?? "GENERAL";
        const prev = usuariosACrear.get(k);
        if (!prev) {
          usuariosACrear.set(k, {
            nombre: tituloCase(m.nombre),
            disciplina: discU,
            grupos: [`${g.disciplina} ${g.codigo}`],
          });
        } else {
          prev.grupos.push(`${g.disciplina} ${g.codigo}`);
          // preferir disciplina específica sobre GENERAL
          if (prev.disciplina === "GENERAL" && discU !== "GENERAL")
            prev.disciplina = discU;
        }
      }
    }

    // ─── informe ─────────────────────────────────────────────────────────────
    console.log("CUADRILLAS A CARGAR");
    console.log("".padEnd(100, "─"));
    for (const g of plan) {
      const ex = g.existente
        ? `existe (n${g.existente.numero}/${g.existente.turno}, ${g.existente._count.miembros} miemb.)`
        : "NUEVA";
      console.log(
        `${g.disciplina.padEnd(5)} ${g.codigo.padEnd(8)} grupo#${String(
          g.grupoNumPlantilla ?? "?",
        ).padEnd(3)} → n${String(g.numero).padEnd(3)} [${(g.fuente ?? "?").padEnd(
          10,
        )}] ${String(g.miembros.length).padStart(2)} pers.  apoyo:${
          g.dotApoyo ?? "-"
        }  sup:"${g.supervisor}"  ${ex}`,
      );
    }

    // chequeos
    const porDiscNum = new Map();
    for (const g of plan) {
      const k = `${g.disciplina}|${g.numero}`;
      const arr = porDiscNum.get(k) ?? [];
      arr.push(`${g.codigo}#${g.grupoNumPlantilla}`);
      porDiscNum.set(k, arr);
    }
    const conflictos = [...porDiscNum.entries()].filter(([, a]) => a.length > 1);

    const dondeAparece = new Map();
    for (const g of plan)
      for (const m of g.miembros) {
        const k = norm(m.nombre);
        const arr = dondeAparece.get(k) ?? [];
        arr.push(`${g.disciplina} ${g.codigo}`);
        dondeAparece.set(k, arr);
      }
    const repetidos = [...dondeAparece.entries()].filter(([, a]) => a.length > 1);

    const sinMatch = [];
    const ambiguos = [];
    const flexList = [];
    let totalMiembros = 0;
    let totalOk = 0;
    let totalFlex = 0;
    for (const g of plan)
      for (const m of g.miembros) {
        totalMiembros++;
        if (m.match === "ok") totalOk++;
        else if (m.match === "ok~") {
          totalOk++;
          totalFlex++;
          flexList.push(
            `${g.disciplina} ${g.codigo}: "${m.nombre}"  →  "${m.usuarioNombre}"`,
          );
        } else if (m.match === "ambiguo")
          ambiguos.push(`${g.disciplina} ${g.codigo}: ${m.nombre}`);
        else sinMatch.push(`${g.disciplina} ${g.codigo}: ${m.nombre}`);
      }

    console.log("");
    console.log("RESUMEN");
    console.log("".padEnd(100, "─"));
    console.log(`Cuadrillas en el Excel      : ${plan.length}`);
    console.log(
      `  nuevas                    : ${plan.filter((g) => !g.existente).length}`,
    );
    console.log(
      `  ya existentes             : ${plan.filter((g) => g.existente).length}`,
    );
    console.log(`Personas (sin repetir/grupo): ${totalMiembros}`);
    console.log(
      `  con usuario del sistema   : ${totalOk}  (de ellos, match flexible: ${totalFlex})`,
    );
    console.log(
      `  sin match / ambiguos      : ${sinMatch.length} / ${ambiguos.length}`,
    );
    if (CREAR_USUARIOS)
      console.log(
        `  usuarios NUEVOS a crear   : ${usuariosACrear.size}  (rol 4, Técnico)`,
      );
    else
      console.log(`  (se cargan igual como texto; usuarioId = null)`);

    if (conflictos.length) {
      console.log("");
      console.log("⚠ CONFLICTOS DE NÚMERO (bloquean --commit):");
      for (const [k, a] of conflictos) console.log(`  ${k}  ←  ${a.join(", ")}`);
    }
    if (repetidos.length) {
      console.log("");
      console.log("ℹ Personas en más de una cuadrilla (se cargan en ambas):");
      for (const [k, a] of repetidos) console.log(`  ${k}  →  ${a.join(" | ")}`);
    }
    if (ambiguos.length) {
      console.log("");
      console.log("ℹ Nombres que coinciden con más de un usuario (quedan como texto):");
      for (const s of ambiguos) console.log(`  ${s}`);
    }
    if (flexList.length) {
      console.log("");
      console.log(
        `MATCH FLEXIBLE — se ligan a un usuario existente (revisá que sean la misma persona): ${flexList.length}`,
      );
      for (const s of flexList) console.log(`  ${s}`);
    }
    if (CREAR_USUARIOS && usuariosACrear.size) {
      console.log("");
      console.log("USUARIOS NUEVOS QUE SE CREARÁN (rol 4):");
      for (const [, u] of usuariosACrear)
        console.log(
          `  ${u.nombre.padEnd(38)} disc:${u.disciplina.padEnd(8)} ${[
            ...new Set(u.grupos),
          ].join(", ")}`,
        );
    } else if (!CREAR_USUARIOS && sinMatch.length) {
      console.log("");
      console.log("ℹ Nombres sin usuario en el sistema (usá --crear-usuarios):");
      for (const s of sinMatch) console.log(`  ${s}`);
    }

    // ─── commit ──────────────────────────────────────────────────────────────
    if (!COMMIT) {
      console.log("");
      console.log(
        "DRY-RUN: no se escribió nada. Repetí con --commit para aplicar.",
      );
      return;
    }
    if (conflictos.length) {
      console.error("\nAbortado: hay conflictos de número de grupo.");
      process.exit(1);
    }

    console.log("");
    console.log("APLICANDO…");

    // 1) crear los usuarios nuevos y armar mapa norm(nombre) -> id
    const nuevoIdPorNombre = new Map();
    let usuariosCreados = 0;
    if (CREAR_USUARIOS) {
      for (const [k, u] of usuariosACrear) {
        const creado = await prisma.usuario.create({
          data: {
            nombre: u.nombre,
            rol: 4,
            disciplina: u.disciplina,
            esContratista: false,
            activo: true,
          },
          select: { id: true },
        });
        nuevoIdPorNombre.set(k, creado.id);
        usuariosCreados++;
      }
      console.log(`  usuarios creados: ${usuariosCreados}`);
    }

    // 2) crear/actualizar cuadrillas y reemplazar roster
    let creados = 0;
    let actualizados = 0;
    let miembrosInsertados = 0;
    let miembrosLigados = 0;

    for (const g of plan) {
      const dotacionPropia = g.miembros.length;
      await prisma.$transaction(async (tx) => {
        let grupo;
        if (g.existente) {
          grupo = await tx.paradaGrupo.update({
            where: { id: g.existente.id },
            data: {
              dotacionPropia,
              ...(g.dotApoyo != null ? { dotacionApoyo: g.dotApoyo } : {}),
              ...(g.existente.supervisorNombre
                ? {}
                : { supervisorNombre: g.supervisor }),
            },
          });
          actualizados++;
        } else {
          grupo = await tx.paradaGrupo.create({
            data: {
              paradaId: parada.id,
              turno: g.turno,
              disciplina: g.disciplina,
              numero: g.numero,
              supervisorNombre: g.supervisor,
              dotacionPropia,
              dotacionApoyo: g.dotApoyo ?? 0,
            },
          });
          creados++;
        }
        await tx.paradaGrupoMiembro.deleteMany({
          where: { paradaGrupoId: grupo.id },
        });
        if (g.miembros.length) {
          const data = g.miembros.map((m) => {
            const nuevoId = nuevoIdPorNombre.get(norm(m.nombre)) ?? null;
            const usuarioId = m.usuarioId ?? nuevoId;
            if (usuarioId) miembrosLigados++;
            return {
              paradaGrupoId: grupo.id,
              nombre: nuevoId ? tituloCase(m.nombre) : m.nombre,
              usuarioId,
              esLider: false,
            };
          });
          await tx.paradaGrupoMiembro.createMany({ data });
          miembrosInsertados += data.length;
        }
      });
    }

    console.log("");
    console.log(
      `Listo. Usuarios nuevos: ${usuariosCreados} · cuadrillas creadas: ${creados} · actualizadas: ${actualizados} · miembros insertados: ${miembrosInsertados} (ligados a usuario: ${miembrosLigados})`,
    );
  } finally {
    await prisma.$disconnect();
  }
})().catch((e) => {
  console.error("\nERROR:", e.message);
  process.exit(1);
});
