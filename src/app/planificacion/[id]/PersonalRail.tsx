"use client";

import { useState } from "react";
import type { Plan } from "./types";
import { DIAS_INFO, iniciales, estaEnSitio, trabajaEseDia } from "@/lib/planificacion/personal";

// Riel de personal — usado tanto por el Tablero (donde además es arrastrable
// hacia las OTs) como por la Lista (solo como referencia visual, sin drop
// target), para que el planificador vea siempre el mismo panel de técnicos
// habilitados esta semana con la misma tipografía y colores.
export default function PersonalRail({ plan, disabled }: { plan: Plan; disabled: boolean }) {
  const [draggingNombre, setDraggingNombre] = useState<string | null>(null);
  const visibles = plan.roster.filter(r => estaEnSitio(r.asistencia));
  const ausentes = plan.roster.length - visibles.length;
  return (
    <div style={{ width: 172, flexShrink: 0, position: "sticky", top: 60 }}>
      <div style={{ fontSize: 11, fontWeight: 800, color: "#374151", marginBottom: 2, textTransform: "uppercase", letterSpacing: "0.03em" }}>
        Personal ({visibles.length})
      </div>
      {ausentes > 0 && (
        <div style={{ fontSize: 9, color: "#94a3b8", marginBottom: 6 }}>
          {ausentes} ausente{ausentes !== 1 ? "s" : ""} toda la semana (no se muestran)
        </div>
      )}
      <div style={{ display: "flex", flexDirection: "column", gap: 5, maxHeight: "70vh", overflowY: "auto", paddingRight: 4 }}>
        {plan.roster.length === 0 && (
          <p style={{ fontSize: 11, color: "#cbd5e1", fontStyle: "italic" }}>Importa el roster para asignar técnicos.</p>
        )}
        {visibles.map(r => {
          const asignaciones = plan.ots.filter(o => o.personalAsignado.includes(r.nombre)).length;
          const diasTrabaja = DIAS_INFO.map(d => trabajaEseDia(r.asistencia, d.code));
          const semanaCompleta = diasTrabaja.every(Boolean);
          const bloqueado = disabled;
          return (
            <div
              key={r.id}
              draggable={!bloqueado}
              onDragStart={e => {
                setDraggingNombre(r.nombre);
                e.dataTransfer.effectAllowed = "copy";
                e.dataTransfer.setData("application/json", JSON.stringify({ tipo: "tecnico", nombre: r.nombre }));
              }}
              onDragEnd={() => setDraggingNombre(null)}
              style={{
                display: "flex", alignItems: "center", gap: 7,
                background: "white", border: "1px solid #f1f5f9", borderRadius: 8, padding: "6px 8px",
                opacity: draggingNombre === r.nombre ? 0.35 : 1,
                cursor: bloqueado ? "default" : "grab",
              }}
              title={
                !semanaCompleta ? `${r.nombre} solo está en sitio: ${DIAS_INFO.filter((_, i) => diasTrabaja[i]).map(d => d.largo).join(", ")}`
                : disabled ? undefined : "Arrastra sobre una OT para asignar"
              }
            >
              <span style={{
                width: 24, height: 24, borderRadius: "50%", flexShrink: 0,
                background: r.grupo === "Nocturno" ? "#1e1b4b" : "#ede9fe",
                color: r.grupo === "Nocturno" ? "white" : "#7c3aed",
                fontSize: 9, fontWeight: 800, display: "flex", alignItems: "center", justifyContent: "center",
              }}>{iniciales(r.nombre)}</span>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: "#0f2847", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.nombre}</div>
                <div style={{ fontSize: 9, color: "#94a3b8" }}>
                  {r.grupo} · {asignaciones} OT{asignaciones !== 1 ? "s" : ""}
                </div>
                {!semanaCompleta && (
                  <div style={{ display: "flex", gap: 2, marginTop: 3 }}>
                    {DIAS_INFO.map((d, i) => (
                      <span
                        key={d.code}
                        title={`${d.largo}${diasTrabaja[i] ? "" : " (no está en sitio)"}`}
                        style={{
                          width: 12, height: 12, borderRadius: 3, fontSize: 7, fontWeight: 800,
                          display: "flex", alignItems: "center", justifyContent: "center",
                          background: diasTrabaja[i] ? "#ddd6fe" : "#f1f5f9",
                          color: diasTrabaja[i] ? "#5b21b6" : "#cbd5e1",
                        }}
                      >{d.code[0]}</span>
                    ))}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
