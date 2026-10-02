/**
 * Padrón de personas de Sync, con el IAM como fuente única (Fase 2, opción b).
 *
 * - Altas y cambios de identidad de personas SIN cuenta van primero al IAM
 *   (POST/PATCH /rbac/trabajadores) y luego se copian aquí.
 * - La sincronización trae del IAM la identidad de las personas que Sync ya
 *   tiene y las enlaza por cuenta o JDE. No agrega personas nuevas a Sync
 *   (el IAM tiene personal de otras áreas que Sync no usa).
 * - La reconciliación (una vez, la lanza un admin) además da de alta en el IAM
 *   a quienes Sync tenga y el IAM no, y completa en el IAM los datos que allí
 *   están vacíos y Sync sí tiene (JDE, disciplina, celular, área).
 *
 * Regla de copia: "el IAM completa, no borra" — un texto vacío en el IAM no
 * pisa el dato que Sync ya tiene (al migrar, el IAM tenía disciplinas vacías).
 */
import type { NextRequest } from "next/server";
import type { Usuario } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { verifyToken, COOKIE_NAME } from "@/lib/auth";
import {
  listarTrabajadores,
  crearTrabajador,
  completarTrabajador,
  IamNoDisponible,
  IamRechazo,
  type ActorIam,
  type DatosCompletar,
  type DatosTrabajador,
  type TrabajadorIam,
} from "@/lib/iam-padron";
import type { GestionPersona } from "@/lib/padron-campos";
import { MSG_IAM_NO_DISPONIBLE } from "@/lib/usuario-iam";

/** Puesto por defecto al dar de alta sin puesto (el IAM lo exige). */
const PUESTO_POR_ROL: Record<number, string> = {
  1: "Administrador", 2: "Superintendente", 3: "Supervisor",
  4: "Técnico", 5: "Planificador", 6: "Contratista",
};

function texto(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

export function gestionDe(
  u: Pick<Usuario, "iamUserId" | "tieneCuentaIam" | "trabajadorId">,
): GestionPersona {
  return {
    usaSync: u.iamUserId !== null,
    cuentaIam: u.tieneCuentaIam || u.iamUserId !== null,
    enPadron: u.trabajadorId !== null,
  };
}

/** Identidad local a partir del Trabajador del IAM ("el IAM completa, no borra"). */
export function identidadDesdeTrabajador(
  t: TrabajadorIam,
  actual?: Partial<Pick<Usuario,
    "nombre" | "jde" | "puesto" | "superintendencia" | "areaTrabajo" | "disciplina" | "celular">>,
) {
  return {
    trabajadorId: t.id,
    tieneCuentaIam: t.userId !== null,
    nombre: texto(t.nomina) ?? actual?.nombre ?? "Sin nombre",
    jde: texto(t.jde) ?? actual?.jde ?? null,
    puesto: texto(t.puesto) ?? actual?.puesto ?? null,
    superintendencia: texto(t.superintendencia) ?? actual?.superintendencia ?? null,
    areaTrabajo: texto(t.area) ?? actual?.areaTrabajo ?? null,
    disciplina: texto(t.disciplina) ?? actual?.disciplina ?? "GENERAL",
    celular: texto(t.celular) ?? actual?.celular ?? null,
    esContratista: t.esContratista,
    activo: t.activo,
  };
}

/**
 * Traduce campos de Sync al formato del Trabajador del IAM. Solo incluye lo que
 * viene. Con `paraAlta`: completa el puesto (obligatorio en el IAM) desde el
 * rol, omite los vacíos y no envía `activo` (el alta no lo admite).
 * En una edición, un texto vaciado se envía como "" para que el IAM lo borre.
 */
export async function datosTrabajadorDesde(
  campos: Record<string, unknown>,
  opciones: { paraAlta?: boolean } = {},
): Promise<DatosTrabajador> {
  const alta = opciones.paraAlta === true;
  const d: DatosTrabajador = {};
  const viene = (k: string) => campos[k] !== undefined;
  /** Texto a enviar: en alta se omite si está vacío; en edición, "" lo borra. */
  const valor = (v: unknown) => texto(v) ?? (alta ? undefined : "");

  if (viene("nombre")) d.nomina = texto(campos.nombre) ?? undefined;
  const puesto = texto(campos.puesto);
  if (puesto && puesto.length >= 2) d.puesto = puesto;
  else if (alta) d.puesto = PUESTO_POR_ROL[Number(campos.rol)] ?? "Técnico";
  if (viene("jde")) d.jde = valor(texto(campos.jde)?.replace(/\.0+$/, ""));
  if (viene("disciplina")) d.disciplina = texto(campos.disciplina) ?? "GENERAL";
  if (viene("esContratista")) d.esContratista = campos.esContratista === true;
  if (viene("celular")) d.celular = valor(campos.celular);
  if (viene("activo") && !alta) d.activo = campos.activo === true || campos.activo === "true";

  // Sync guarda el NOMBRE del área; el IAM toma el código (y de él deriva la
  // superintendencia). Las áreas de Sync se sincronizan desde el IAM, así que
  // el código existe allí.
  const areaNombre = texto(campos.areaTrabajo);
  if (areaNombre) {
    const area = await prisma.area.findFirst({
      where: { nombre: { equals: areaNombre, mode: "insensitive" } },
      select: { codigo: true },
    });
    if (area) d.areaCodigo = area.codigo;
    else d.area = areaNombre;
  }
  if (!d.areaCodigo && viene("superintendencia")) {
    d.superintendencia = valor(campos.superintendencia);
  }
  // Solo las claves con valor, para que el objeto refleje exactamente lo que se envía
  return Object.fromEntries(Object.entries(d).filter(([, v]) => v !== undefined)) as DatosTrabajador;
}

/**
 * Lo que Sync sabe de la persona y su ficha del IAM tiene vacío. Es el camino
 * inverso de "el IAM completa, no borra": aquí Sync completa al IAM, sin pisar.
 */
export async function faltantesEnIam(
  u: Pick<Usuario, "jde" | "disciplina" | "celular" | "areaTrabajo">,
  t: TrabajadorIam,
): Promise<DatosCompletar> {
  const d: DatosCompletar = {};
  const jde = texto(u.jde)?.replace(/\.0+$/, "");
  if (jde && !texto(t.jde)) d.jde = jde;
  const disciplina = texto(u.disciplina);
  if (disciplina && !texto(t.disciplina)) d.disciplina = disciplina;
  const celular = texto(u.celular);
  if (celular && !texto(t.celular)) d.celular = celular;
  const areaNombre = texto(u.areaTrabajo);
  if (areaNombre && !texto(t.areaCodigo)) {
    const area = await prisma.area.findFirst({
      where: { nombre: { equals: areaNombre, mode: "insensitive" } },
      select: { codigo: true },
    });
    if (area) d.areaCodigo = area.codigo;
  }
  return d;
}

/** Usuario de Sync que hace la petición, para la auditoría del IAM. */
export async function actorDeSesion(req: NextRequest): Promise<ActorIam | undefined> {
  const token = req.cookies.get(COOKIE_NAME)?.value;
  const sesion = token ? await verifyToken(token) : null;
  if (!sesion) return undefined;
  const u = await prisma.usuario.findUnique({ where: { id: sesion.id }, select: { iamUserId: true } });
  return { id: u?.iamUserId ?? null, nombre: sesion.nombre };
}

// ─── Enlace persona ↔ trabajador ──────────────────────────────────────────────

export type AccionPadron =
  | { tipo: "refrescar"; usuarioId: string; trabajador: TrabajadorIam }
  | { tipo: "enlazar"; usuarioId: string; trabajador: TrabajadorIam; via: "cuenta" | "jde" }
  | { tipo: "sinPar"; usuarioId: string; nombre: string; jde: string | null }
  // Tiene cuenta en el IAM pero esa cuenta no tiene ficha de trabajador. No se
  // crea una desde aquí: quedaría suelta, sin vínculo con la cuenta (el servicio
  // no puede vincularlas). Se le crea y vincula la ficha en el IAM Portal.
  | { tipo: "cuentaSinFicha"; usuarioId: string; nombre: string }
  | { tipo: "conflicto"; usuarioId: string; nombre: string; motivo: string };

type UsuarioParaPlan = Pick<Usuario, "id" | "nombre" | "jde" | "iamUserId" | "trabajadorId">;

/**
 * Decide, sin escribir nada, qué pasa con cada persona de Sync frente al
 * padrón del IAM. Un trabajador solo puede quedar enlazado a una persona.
 */
export function planificarPadron(
  usuarios: UsuarioParaPlan[],
  trabajadores: TrabajadorIam[],
): AccionPadron[] {
  const porId = new Map(trabajadores.map((t) => [t.id, t]));
  const porCuenta = new Map(trabajadores.filter((t) => t.userId).map((t) => [t.userId!, t]));
  const porJde = new Map<string, TrabajadorIam[]>();
  for (const t of trabajadores) {
    const j = texto(t.jde);
    if (j) porJde.set(j, [...(porJde.get(j) ?? []), t]);
  }

  const acciones: AccionPadron[] = [];
  const tomados = new Set<string>();

  // 1) Los ya enlazados reclaman primero su trabajador
  for (const u of usuarios.filter((x) => x.trabajadorId)) {
    const t = porId.get(u.trabajadorId!);
    if (t) {
      acciones.push({ tipo: "refrescar", usuarioId: u.id, trabajador: t });
      tomados.add(t.id);
    } else {
      acciones.push({
        tipo: "conflicto", usuarioId: u.id, nombre: u.nombre,
        motivo: "Su trabajador ya no existe en el IAM",
      });
    }
  }

  // 2) Los demás: por cuenta del IAM y, si no, por JDE (solo si es inequívoco)
  for (const u of usuarios.filter((x) => !x.trabajadorId)) {
    const porSuCuenta = u.iamUserId ? porCuenta.get(u.iamUserId) : undefined;
    const jde = texto(u.jde);
    const candidatosJde = jde ? porJde.get(jde) ?? [] : [];
    const t = porSuCuenta ?? (candidatosJde.length === 1 ? candidatosJde[0] : undefined);

    if (!t && candidatosJde.length > 1) {
      acciones.push({
        tipo: "conflicto", usuarioId: u.id, nombre: u.nombre,
        motivo: `Hay ${candidatosJde.length} trabajadores con el JDE ${jde} en el IAM`,
      });
    } else if (!t && u.iamUserId) {
      acciones.push({ tipo: "cuentaSinFicha", usuarioId: u.id, nombre: u.nombre });
    } else if (!t) {
      acciones.push({ tipo: "sinPar", usuarioId: u.id, nombre: u.nombre, jde });
    } else if (tomados.has(t.id)) {
      acciones.push({
        tipo: "conflicto", usuarioId: u.id, nombre: u.nombre,
        motivo: `El trabajador "${t.nomina}" ya está enlazado a otra persona de Sync (¿duplicado?)`,
      });
    } else {
      acciones.push({
        tipo: "enlazar", usuarioId: u.id, trabajador: t, via: porSuCuenta ? "cuenta" : "jde",
      });
      tomados.add(t.id);
    }
  }

  // 3) Antes de proponer un alta, descartar duplicados probables por nombre: una
  //    ficha libre cuyo nombre contiene todas las palabras del otro (p. ej.
  //    "Philippe Guyon" ⊂ "Guyon Philippe Pierre Georges") y sin JDE que lo
  //    contradiga. Va después de los enlaces: una ficha puede quedar tomada por JDE.
  const libres = trabajadores
    .filter((t) => !tomados.has(t.id))
    .map((t) => ({ t, palabras: palabrasDe(t.nomina) }));
  return acciones.map((a): AccionPadron => {
    if (a.tipo !== "sinPar") return a;
    const propias = palabrasDe(a.nombre);
    const parecidas = libres.filter(
      (x) => mismoNombreProbable(propias, x.palabras) && !(a.jde && x.t.jde && x.t.jde !== a.jde),
    );
    if (parecidas.length === 0) return a;
    const fichas = parecidas
      .map((x) => `"${x.t.nomina}"${x.t.ci ? ` (CI ${x.t.ci})` : x.t.jde ? ` (JDE ${x.t.jde})` : ""}`)
      .join(", ");
    return {
      tipo: "conflicto", usuarioId: a.usuarioId, nombre: a.nombre,
      motivo:
        `Posible duplicado de ${fichas} en el IAM, así que no se da de alta. ` +
        (a.jde
          ? `En el IAM Portal, ponle a esa ficha el JDE ${a.jde} si es la misma persona (o su propio JDE si es otra) y vuelve a enlazar.`
          : "Complétale el JDE en Sync y en esa ficha del IAM Portal para distinguirlas, y vuelve a enlazar."),
    };
  });
}

/** Palabras de un nombre, sin tildes ni mayúsculas (ignora iniciales sueltas). */
function palabrasDe(nombre: string): Set<string> {
  return new Set(
    nombre.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z ]/g, " ").split(/\s+/).filter((w) => w.length > 1),
  );
}

/** Uno de los nombres contiene todas las palabras del otro, que tiene al menos dos. */
function mismoNombreProbable(a: Set<string>, b: Set<string>): boolean {
  const [menor, mayor] = a.size <= b.size ? [a, b] : [b, a];
  if (menor.size < 2) return false;
  for (const w of menor) if (!mayor.has(w)) return false;
  return true;
}

function cambiaAlgo(u: Usuario, datos: Record<string, unknown>): boolean {
  return Object.entries(datos).some(([k, v]) => (u as Record<string, unknown>)[k] !== v);
}

/** Aplica refrescos y enlaces de un plan. Devuelve cuántas filas cambiaron. */
async function aplicarEnlaces(acciones: AccionPadron[], usuarios: Map<string, Usuario>) {
  let refrescados = 0;
  let enlazados = 0;
  for (const a of acciones) {
    if (a.tipo !== "refrescar" && a.tipo !== "enlazar") continue;
    const u = usuarios.get(a.usuarioId)!;
    const datos = identidadDesdeTrabajador(a.trabajador, u);
    if (!cambiaAlgo(u, datos)) continue;
    await prisma.usuario.update({ where: { id: u.id }, data: datos });
    if (a.tipo === "enlazar") enlazados++;
    else refrescados++;
  }
  return { refrescados, enlazados };
}

/** Lo que necesita intervención humana: conflictos y cuentas sin ficha de trabajador. */
function avisosDe(acciones: AccionPadron[]): { nombre: string; motivo: string }[] {
  return acciones.flatMap((a) => {
    if (a.tipo === "conflicto") return [{ nombre: a.nombre, motivo: a.motivo }];
    if (a.tipo === "cuentaSinFicha") {
      return [{
        nombre: a.nombre,
        motivo: "Tiene cuenta en el IAM pero no ficha de trabajador: hay que crearla y vincularla a su cuenta en el IAM",
      }];
    }
    return [];
  });
}

export interface ResultadoPadron {
  refrescados: number;
  enlazados: number;
  creadosEnIam: number;
  sinPar: { nombre: string; jde: string | null }[];
  conflictos: { nombre: string; motivo: string }[];
  errores: { nombre: string; error: string }[];
}

/**
 * Trae la identidad de las personas desde el IAM y enlaza las que se puedan
 * enlazar con seguridad. No crea nada en ningún lado.
 */
export async function refrescarPadron(): Promise<ResultadoPadron> {
  const [trabajadores, usuarios] = await Promise.all([
    listarTrabajadores(),
    prisma.usuario.findMany(),
  ]);
  const acciones = planificarPadron(usuarios, trabajadores);
  const { refrescados, enlazados } = await aplicarEnlaces(
    acciones, new Map(usuarios.map((u) => [u.id, u])),
  );
  return {
    refrescados, enlazados, creadosEnIam: 0,
    sinPar: acciones.flatMap((a) => (a.tipo === "sinPar" ? [{ nombre: a.nombre, jde: a.jde }] : [])),
    conflictos: avisosDe(acciones),
    errores: [],
  };
}

/**
 * Reconciliación (una vez, la lanza un admin): enlaza como `refrescarPadron` y
 * además da de alta en el IAM a las personas de Sync que no están allí.
 * Con `dry` solo informa qué haría.
 */
export async function reconciliarPadron(opciones: { dry: boolean; actor?: ActorIam }) {
  const [trabajadores, usuarios] = await Promise.all([
    listarTrabajadores(),
    prisma.usuario.findMany(),
  ]);
  const acciones = planificarPadron(usuarios, trabajadores);
  const porId = new Map(usuarios.map((u) => [u.id, u]));
  const sinPar = acciones.filter((a): a is Extract<AccionPadron, { tipo: "sinPar" }> => a.tipo === "sinPar");
  const conflictos = avisosDe(acciones);

  // Fichas del IAM a las que les falta algo que Sync sabe
  const porCompletar: { usuario: Usuario; trabajador: TrabajadorIam; datos: DatosCompletar }[] = [];
  for (const a of acciones) {
    if (a.tipo !== "refrescar" && a.tipo !== "enlazar") continue;
    const usuario = porId.get(a.usuarioId)!;
    const datos = await faltantesEnIam(usuario, a.trabajador);
    if (Object.keys(datos).length) porCompletar.push({ usuario, trabajador: a.trabajador, datos });
  }

  if (opciones.dry) {
    return {
      dry: true,
      porEnlazar: acciones.filter((a) => a.tipo === "enlazar").length,
      yaEnlazados: acciones.filter((a) => a.tipo === "refrescar").length,
      porCrearEnIam: sinPar.map((a) => ({ nombre: a.nombre, jde: a.jde })),
      porCompletarEnIam: porCompletar.map((c) => ({ nombre: c.usuario.nombre, campos: Object.keys(c.datos) })),
      conflictos,
    };
  }

  // Primero completar el IAM; así el enlace siguiente copia de vuelta los mismos valores
  let completadosEnIam = 0;
  const errores: { nombre: string; error: string }[] = [];
  const conflictosAlta: { nombre: string; motivo: string }[] = [];
  for (const c of porCompletar) {
    try {
      const r = await completarTrabajador(c.trabajador.id, c.datos, opciones.actor);
      if (r.completados.length) completadosEnIam++;
      for (const o of r.omitidos) conflictosAlta.push({ nombre: c.usuario.nombre, motivo: `No se completó en el IAM — ${o}` });
    } catch (e) {
      if (e instanceof IamNoDisponible) throw e;
      errores.push({ nombre: c.usuario.nombre, error: (e as Error).message });
    }
  }

  const enlaces = await aplicarEnlaces(acciones, porId);
  const refrescados = enlaces.refrescados;
  let enlazados = enlaces.enlazados;

  let creadosEnIam = 0;
  for (const a of sinPar) {
    const u = porId.get(a.usuarioId)!;
    try {
      const datos = await datosTrabajadorDesde({ ...u }, { paraAlta: true });
      const { trabajador, creado } = await crearTrabajador(datos, opciones.actor);
      // Alta idempotente: el IAM pudo devolver alguien que otra fila ya tiene
      const ocupado = await prisma.usuario.findUnique({
        where: { trabajadorId: trabajador.id }, select: { nombre: true },
      });
      if (ocupado) {
        conflictosAlta.push({
          nombre: u.nombre,
          motivo: `El IAM ya tenía a "${trabajador.nomina}" y está enlazado a "${ocupado.nombre}" (¿duplicado?)`,
        });
        continue;
      }
      await prisma.usuario.update({ where: { id: u.id }, data: identidadDesdeTrabajador(trabajador, u) });
      if (creado) creadosEnIam++;
      else enlazados++;
    } catch (e) {
      errores.push({ nombre: u.nombre, error: (e as Error).message });
    }
  }

  return {
    dry: false,
    refrescados, enlazados, creadosEnIam, completadosEnIam,
    conflictos: [...conflictos, ...conflictosAlta],
    errores,
  };
}

/**
 * Garantiza que una persona de Sync esté en el padrón del IAM (alta idempotente
 * por JDE) y la enlaza. Para personas aún no reconciliadas que se editan.
 */
export async function asegurarEnPadron(u: Usuario, actor?: ActorIam): Promise<TrabajadorIam> {
  const datos = await datosTrabajadorDesde({ ...u }, { paraAlta: true });
  const { trabajador } = await crearTrabajador(datos, actor);
  const ocupado = await prisma.usuario.findUnique({
    where: { trabajadorId: trabajador.id }, select: { id: true, nombre: true },
  });
  if (ocupado && ocupado.id !== u.id) {
    throw new ErrorPadron(
      `En el IAM, "${trabajador.nomina}" ya está enlazado a otra persona de Sync ("${ocupado.nombre}"). ` +
        "Revisa si es un duplicado antes de editar.",
      409,
    );
  }
  await prisma.usuario.update({ where: { id: u.id }, data: identidadDesdeTrabajador(trabajador, u) });
  return trabajador;
}

/** Error de negocio del padrón, con el status HTTP que corresponde. */
export class ErrorPadron extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

/** Traduce los errores del padrón a la respuesta HTTP de las rutas de Sync. */
export function respuestaDeError(err: unknown): Response {
  if (err instanceof IamNoDisponible) {
    console.error("💥 [padrón] IAM no disponible:", err.message);
    return Response.json({ ok: false, iamNoDisponible: true, error: MSG_IAM_NO_DISPONIBLE }, { status: 503 });
  }
  if (err instanceof IamRechazo && (err.status === 401 || err.status === 403)) {
    // Es Sync (su API key) quien no está autorizado, no el usuario: un 401 hacia
    // el navegador parecería una sesión vencida.
    console.error("💥 [padrón] El IAM rechazó la API key de Sync:", err.message);
    return Response.json(
      { ok: false, error: "Sync no está autorizado en el IAM (revisa IAM_API_KEY). No se guardó ningún cambio." },
      { status: 502 },
    );
  }
  if (err instanceof IamRechazo || err instanceof ErrorPadron) {
    return Response.json({ ok: false, error: err.message }, { status: err.status });
  }
  const message = err instanceof Error ? err.message : "Error interno";
  return Response.json({ ok: false, error: message }, { status: 400 });
}
