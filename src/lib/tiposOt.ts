// Fuente única de verdad para clasificar/mostrar el tipo de una OT en toda la
// app. Existen dos formatos en producción que no deben verse ni clasificarse
// distinto según su origen:
//  - Import JDE (planificación semanal): letra sola  P | T | C | R | S
//  - Formulario de registro técnico:      código completo PDM|PMT|PMP|CMP|PTJ|CMR
// (S / "5S" = Orden y Limpieza, solo existe en el lado de planificación).

export type FamiliaTipoOt = "P" | "T" | "C" | "R" | "S";
export type CodigoTipoOt = "PDM" | "PMT" | "PMP" | "CMP" | "PTJ" | "CMR";

interface InfoFamilia {
  labelLetra: string; // texto legible cuando el origen solo trae la letra (import JDE)
  nombre: string;
  color: { bg: string; color: string };
}

const FAMILIAS: Record<FamiliaTipoOt, InfoFamilia> = {
  P: { labelLetra: "PdM", nombre: "Predictivo", color: { bg: "#dbeafe", color: "#1d4ed8" } },
  T: { labelLetra: "PMT", nombre: "Preventivo", color: { bg: "#ede9fe", color: "#7c3aed" } },
  C: { labelLetra: "CMP", nombre: "Correctivo Planificado", color: { bg: "#fee2e2", color: "#dc2626" } },
  R: { labelLetra: "CMR", nombre: "Correctivo No Planificado", color: { bg: "#fecdd3", color: "#9f1239" } },
  S: { labelLetra: "5S", nombre: "Orden y Limpieza", color: { bg: "#dcfce7", color: "#166534" } },
};

const CODIGO_COMPLETO_A_FAMILIA: Record<string, FamiliaTipoOt> = {
  PDM: "P",
  PMT: "T",
  PMP: "T",
  CMP: "C",
  PTJ: "C",
  CMR: "R",
  "5S": "S",
};

const LETRA_A_CODIGO_COMPLETO: Record<string, CodigoTipoOt> = {
  P: "PDM",
  T: "PMT",
  C: "CMP",
  R: "CMR",
};

function familiaDe(rawUpper: string): FamiliaTipoOt | null {
  if (rawUpper in FAMILIAS) return rawUpper as FamiliaTipoOt;
  return CODIGO_COMPLETO_A_FAMILIA[rawUpper] ?? null;
}

/** Texto legible + color unificado para mostrar un tipoOT en cualquier pantalla. */
export function tipoOtDisplay(raw: string | null | undefined): { texto: string; color: { bg: string; color: string } } {
  if (!raw) return { texto: "?", color: { bg: "#f1f5f9", color: "#475569" } };
  const key = raw.trim().toUpperCase();
  const familia = familiaDe(key);
  if (!familia) return { texto: raw, color: { bg: "#f1f5f9", color: "#475569" } };
  const esLetraSola = key.length === 1;
  return { texto: esLetraSola ? FAMILIAS[familia].labelLetra : key, color: FAMILIAS[familia].color };
}

/** Nombre completo de la categoría (para tooltips/filtros), o null si no se reconoce. */
export function tipoOtNombre(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const familia = familiaDe(raw.trim().toUpperCase());
  return familia ? FAMILIAS[familia].nombre : null;
}

/**
 * Convierte la letra sola de una OT planificada (import JDE) al código
 * completo que exige el formulario de registro técnico. Si ya viene con
 * código completo lo respeta; "5S" no tiene equivalente en el registro
 * técnico (no es un tipo de mantenimiento) y devuelve "".
 */
export function normalizarACodigoCompleto(raw: string | null | undefined): CodigoTipoOt | "" {
  if (!raw) return "";
  const key = raw.trim().toUpperCase();
  if (key in LETRA_A_CODIGO_COMPLETO) return LETRA_A_CODIGO_COMPLETO[key];
  if (key in CODIGO_COMPLETO_A_FAMILIA && key !== "5S") return key as CodigoTipoOt;
  return "";
}

export function esCorrectivo(raw: string | null | undefined): boolean {
  if (!raw) return false;
  return familiaDe(raw.trim().toUpperCase()) === "C" || familiaDe(raw.trim().toUpperCase()) === "R";
}
