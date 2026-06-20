type DiaSemana = "Lu" | "Ma" | "Mi" | "Ju" | "Vi" | "Sa" | "Do";

const TODOS: DiaSemana[] = ["Lu", "Ma", "Mi", "Ju", "Vi", "Sa", "Do"];
const LABORAL: DiaSemana[] = ["Lu", "Ma", "Mi", "Ju", "Vi"];

const DIA_MAP: Record<string, DiaSemana> = {
  lu: "Lu", lun: "Lu", lunes: "Lu",
  ma: "Ma", mar: "Ma", martes: "Ma",
  mi: "Mi", mie: "Mi", mié: "Mi", miercoles: "Mi", miércoles: "Mi",
  ju: "Ju", jue: "Ju", jueves: "Ju",
  vi: "Vi", vie: "Vi", viernes: "Vi",
  sa: "Sa", sab: "Sa", sáb: "Sa", sabado: "Sa", sábado: "Sa",
  do: "Do", dom: "Do", domingo: "Do",
};

function parseDia(s: string): DiaSemana | null {
  return DIA_MAP[s.toLowerCase().trim()] ?? null;
}

/**
 * Convierte el texto libre de la columna O del Excel a un array de DiaSemana.
 * Ejemplos:
 *   "Lu a Do"   → ["Lu","Ma","Mi","Ju","Vi","Sa","Do"]
 *   "Lu a Sa"   → ["Lu","Ma","Mi","Ju","Vi","Sa"]
 *   "Lu y Ju"   → ["Lu","Ju"]
 *   "Domingo"   → ["Do"]
 *   "Lu,Ma,Mi"  → ["Lu","Ma","Mi"]
 *   "Lunes"     → ["Lu"]
 *   ""          → []
 */
export function expandirDias(texto: string): DiaSemana[] {
  const t = texto.trim();
  if (!t) return [];

  // Rango "X a Y"
  const rangoMatch = t.match(/^(.+?)\s+a\s+(.+)$/i);
  if (rangoMatch) {
    const desde = parseDia(rangoMatch[1]);
    const hasta = parseDia(rangoMatch[2]);
    if (desde && hasta) {
      const iDesde = TODOS.indexOf(desde);
      const iHasta = TODOS.indexOf(hasta);
      if (iDesde <= iHasta) return TODOS.slice(iDesde, iHasta + 1);
    }
  }

  // Lista separada por "y" o coma
  if (/\by\b|,/.test(t)) {
    const partes = t.split(/\by\b|,/).map(s => parseDia(s)).filter((d): d is DiaSemana => d !== null);
    if (partes.length > 0) return partes;
  }

  // Palabras especiales
  const low = t.toLowerCase();
  if (low === "laboral" || low === "lu a vi") return LABORAL;
  if (low === "todos" || low === "lu a do") return TODOS;

  // Día único
  const unico = parseDia(t);
  if (unico) return [unico];

  return [];
}
