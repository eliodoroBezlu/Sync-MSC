/**
 * Padrón de personas de Sync, con el IAM como fuente única (Fase 2, opción b).
 *
 * - Altas y cambios de identidad de personas SIN cuenta van primero al IAM
 *   (POST/PATCH /rbac/trabajadores) y luego se copian aquí.
 * - Toda persona de Sync está enlazada a su ficha (trabajadorId obligatorio).
 *   Quien entra con una cuenta sin ficha recibe una vinculada a su cuenta.
 * - La sincronización trae del IAM la identidad de las personas que Sync ya
 *   tiene. No agrega personas nuevas a Sync (el IAM tiene personal de otras
 *   áreas que Sync no usa).
 * - Un admin puede completar en el IAM los datos que allí están vacíos y Sync
 *   sí tiene (JDE, disciplina, celular, área).
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

/**
 * Ficha de una cuenta que no la tiene: el IAM la crea ya vinculada a la cuenta
 * (o devuelve la suya, si mientras tanto la tuvo). Nunca queda una ficha suelta.
 */
export async function asegurarFichaDeCuenta(
  cuenta: { userId: string; nombre: string; rol: number; disciplina?: string | null },
  actor?: ActorIam,
): Promise<TrabajadorIam> {
  const { trabajador } = await crearTrabajador(
    {
      nomina: cuenta.nombre,
      puesto: PUESTO_POR_ROL[cuenta.rol] ?? "Técnico",
      disciplina: texto(cuenta.disciplina) ?? "GENERAL",
      userId: cuenta.userId,
    },
    actor,
  );
  return trabajador;
}

/** Usuario de Sync que hace la petición, para la auditoría del IAM. */
export async function actorDeSesion(req: NextRequest): Promise<ActorIam | undefined> {
  const token = req.cookies.get(COOKIE_NAME)?.value;
  const sesion = token ? await verifyToken(token) : null;
  if (!sesion) return undefined;
  const u = await prisma.usuario.findUnique({ where: { id: sesion.id }, select: { iamUserId: true } });
  return { id: u?.iamUserId ?? null, nombre: sesion.nombre };
}

// ─── Copia del padrón ─────────────────────────────────────────────────────────
// Toda persona de Sync está enlazada a su ficha del IAM (trabajadorId es
// obligatorio): las altas nacen allí y quien entra sin ficha recibe una.

function cambiaAlgo(u: Usuario, datos: Record<string, unknown>): boolean {
  return Object.entries(datos).some(([k, v]) => (u as Record<string, unknown>)[k] !== v);
}

export interface ResultadoPadron {
  refrescados: number;
  /** Personas cuya ficha ya no está en el IAM: requieren intervención. */
  conflictos: { nombre: string; motivo: string }[];
}

/** Trae del IAM la identidad de cada persona de Sync. No crea nada en ningún lado. */
export async function refrescarPadron(): Promise<ResultadoPadron> {
  const [trabajadores, usuarios] = await Promise.all([
    listarTrabajadores(),
    prisma.usuario.findMany(),
  ]);
  const porId = new Map(trabajadores.map((t) => [t.id, t]));
  let refrescados = 0;
  const conflictos: ResultadoPadron["conflictos"] = [];
  for (const u of usuarios) {
    const t = porId.get(u.trabajadorId);
    if (!t) {
      conflictos.push({ nombre: u.nombre, motivo: "Su ficha ya no existe en el IAM" });
      continue;
    }
    const datos = identidadDesdeTrabajador(t, u);
    if (!cambiaAlgo(u, datos)) continue;
    await prisma.usuario.update({ where: { id: u.id }, data: datos });
    refrescados++;
  }
  return { refrescados, conflictos };
}

/**
 * Completa en el IAM lo que Sync sabe y allí está vacío (JDE, disciplina,
 * celular, área), sin pisar nada. La lanza un admin; con `dry` solo informa.
 */
export async function completarPadronEnIam(opciones: { dry: boolean; actor?: ActorIam }) {
  const [trabajadores, usuarios] = await Promise.all([
    listarTrabajadores(),
    prisma.usuario.findMany(),
  ]);
  const porId = new Map(trabajadores.map((t) => [t.id, t]));
  const porCompletar: { usuario: Usuario; trabajador: TrabajadorIam; datos: DatosCompletar }[] = [];
  for (const usuario of usuarios) {
    const trabajador = porId.get(usuario.trabajadorId);
    if (!trabajador) continue;
    const datos = await faltantesEnIam(usuario, trabajador);
    if (Object.keys(datos).length) porCompletar.push({ usuario, trabajador, datos });
  }

  if (opciones.dry) {
    return {
      dry: true,
      porCompletarEnIam: porCompletar.map((c) => ({ nombre: c.usuario.nombre, campos: Object.keys(c.datos) })),
    };
  }

  let completadosEnIam = 0;
  const conflictos: { nombre: string; motivo: string }[] = [];
  const errores: { nombre: string; error: string }[] = [];
  for (const c of porCompletar) {
    try {
      const r = await completarTrabajador(c.trabajador.id, c.datos, opciones.actor);
      if (r.completados.length) completadosEnIam++;
      for (const o of r.omitidos) conflictos.push({ nombre: c.usuario.nombre, motivo: `No se completó en el IAM — ${o}` });
    } catch (e) {
      if (e instanceof IamNoDisponible) throw e;
      errores.push({ nombre: c.usuario.nombre, error: (e as Error).message });
    }
  }
  // Copiar de vuelta lo completado (mismos valores; deja la copia al día)
  const { refrescados } = await refrescarPadron();
  return { dry: false, completadosEnIam, refrescados, conflictos, errores };
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
