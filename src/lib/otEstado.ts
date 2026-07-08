// Traduce el estado de una OrdenTrabajo al estado que debe reflejarse
// en las filas OtProgramada del plan semanal (badges/botones de Registro).
export function mapEstadoAlPlan(estado: string): string {
  switch (estado) {
    case "pendiente_revision":   return "completada";
    case "solicitar_correccion": return "en_revision";
    case "revisado":             return "completada";
    case "concluido":            return "completada";
    default:                    return "en_proceso";
  }
}
