// Único mapeo área→disciplina del sistema. Las áreas no listadas aquí
// (Chancado, Recursos Hídricos, Flotación, Filtros, Taller General/Equipos
// Industriales, Contratista TTMB, Molienda, Lubricación, Confiabilidad)
// caen en "MEC" — son áreas mecánicas sin agrupación propia todavía.
const AREA_DISCIPLINA: Record<string, string> = {
  "3320": "INST",
  "3319": "ELEC",
  "3348": "TESA",
  "3351": "CON",
};

export function areaToDisciplina(areaCodigo: string): string {
  return AREA_DISCIPLINA[areaCodigo] ?? "MEC";
}

// Inverso: disciplina de parada ("INST"/"ELEC"/"TESA") → código de área real.
// Las OT de Parada de Planta guardan `disciplina`, no `areaCodigo`; este mapeo
// las hace caer en el mismo balde de área que la programación semanal para que
// admin/planificador/supervisor las vean al filtrar por su área.
const DISCIPLINA_AREA: Record<string, string> = {
  INST: "3320",
  ELEC: "3319",
  TESA: "3348",
  CON: "3351",
};

export function disciplinaToArea(disciplina: string | null | undefined): string {
  return DISCIPLINA_AREA[(disciplina ?? "").toUpperCase()] ?? "";
}
