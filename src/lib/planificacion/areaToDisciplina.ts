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
