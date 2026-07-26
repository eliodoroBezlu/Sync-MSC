// Traduce el estado de una OrdenTrabajo al estado que debe reflejarse
// en las filas OtProgramada del plan semanal (badges/botones de Registro).
export function mapEstadoAlPlan(estado: string): string {
  switch (estado) {
    case "pendiente_revision":   return "completada";
    // "solicitar_correccion" reabre la OT para que el técnico siga trabajando —
    // debe reflejarse como editable ("en_proceso"), no como cerrada. Antes se
    // mapeaba a "en_revision", que en el plan semanal se trata igual que
    // "completada" (oculta los botones de avance), dejando la OT visualmente
    // cerrada incluso después de que el supervisor la reabrió.
    case "solicitar_correccion": return "en_proceso";
    case "revisado":             return "completada";
    case "concluido":            return "completada";
    default:                    return "en_proceso";
  }
}
