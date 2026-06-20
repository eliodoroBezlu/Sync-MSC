"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import AppHeader from "@/components/AppHeader";
import { useUser } from "@/context/AuthContext";
import { useRouter } from "next/navigation";

type Competencia = {
  usuarioId: string;
  disciplina: string;
  nivel: string;
  competencias: string[];
  certificado: boolean;
  validaHasta: string | null;
};

type UsuarioData = {
  _id: string;
  nombre: string;
  apellido?: string;
  disciplina: string;
  activo: boolean;
};

const DISCIPLINAS = ["INST", "ELEC", "MEC", "TESA", "CON", "VE"];
const NIVELES = {
  Básico: "#fef3c7",
  Intermedio: "#dbeafe",
  Avanzado: "#c7d2fe",
  Experto: "#dcfce7",
};

export default function EspecialistasPage() {
  const { user, loading } = useUser();
  const router = useRouter();
  const [usuarios, setUsuarios] = useState<UsuarioData[]>([]);
  const [competencias, setCompetencias] = useState<Map<string, Competencia>>(new Map());
  const [filtroDisc, setFiltroDisc] = useState("INST");
  const [cargando, setCargando] = useState(true);

  useEffect(() => {
    if (!loading && !user) router.replace("/login");
  }, [loading, user, router]);

  useEffect(() => {
    const load = async () => {
      setCargando(true);
      const resUsers = await fetch("/api/usuarios?all=true");
      const users = await resUsers.json();
      setUsuarios(users);

      const resComp = await fetch(`/api/tecnico-competencias?disciplina=${filtroDisc}`);
      const comps: Competencia[] = await resComp.json();
      const map = new Map<string, Competencia>(comps.map((c: Competencia) => [`${c.usuarioId}-${c.disciplina}`, c]));
      setCompetencias(map);
      setCargando(false);
    };
    load();
  }, [filtroDisc]);

  if (loading || !user) return null;

  const usuariosActivos = usuarios.filter(u => u.activo && (u.disciplina === filtroDisc || u.disciplina === "GENERAL"));
  const usuariosConComp = usuariosActivos.map(u => ({
    ...u,
    competencia: competencias.get(`${u._id}-${filtroDisc}`),
  }));

  return (
    <div style={{ minHeight: "100vh", background: "#f1f5f9" }}>
      <AppHeader backHref="/planificacion" />

      <main style={{ maxWidth: 1000, margin: "0 auto", padding: "24px 16px" }}>
        <div style={{ marginBottom: 24 }}>
          <h1 style={{ fontSize: 22, fontWeight: 800, color: "#0f2847", margin: 0 }}>
            Matriz de Especialistas
          </h1>
          <p style={{ fontSize: 13, color: "#64748b", margin: "2px 0 0" }}>
            Competencias y certificaciones de técnicos por disciplina
          </p>
        </div>

        <div style={{ marginBottom: 16, display: "flex", gap: 8, flexWrap: "wrap" }}>
          {DISCIPLINAS.map(d => (
            <button
              key={d}
              onClick={() => setFiltroDisc(d)}
              style={{
                padding: "8px 16px",
                borderRadius: 8,
                border: "none",
                background: filtroDisc === d ? "#7c3aed" : "#e2e8f0",
                color: filtroDisc === d ? "white" : "#475569",
                fontWeight: 700,
                fontSize: 13,
                cursor: "pointer",
              }}
            >
              {d}
            </button>
          ))}
        </div>

        {cargando ? (
          <div style={{ textAlign: "center", padding: 40, color: "#94a3b8" }}>Cargando especialistas…</div>
        ) : usuariosConComp.length === 0 ? (
          <div style={{ background: "white", borderRadius: 12, padding: 40, textAlign: "center", color: "#94a3b8" }}>
            No hay técnicos en esta disciplina
          </div>
        ) : (
          <div style={{ background: "white", borderRadius: 12, overflow: "hidden", boxShadow: "0 2px 12px rgba(0,0,0,0.06)" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ background: "#f8fafc", borderBottom: "2px solid #e2e8f0" }}>
                  <th style={{ padding: "12px 16px", textAlign: "left", fontWeight: 700, fontSize: 12, color: "#64748b" }}>
                    Técnico
                  </th>
                  <th style={{ padding: "12px 16px", textAlign: "center", fontWeight: 700, fontSize: 12, color: "#64748b" }}>
                    Nivel
                  </th>
                  <th style={{ padding: "12px 16px", textAlign: "left", fontWeight: 700, fontSize: 12, color: "#64748b" }}>
                    Competencias
                  </th>
                  <th style={{ padding: "12px 16px", textAlign: "center", fontWeight: 700, fontSize: 12, color: "#64748b" }}>
                    Certificado
                  </th>
                  <th style={{ padding: "12px 16px", textAlign: "center", fontWeight: 700, fontSize: 12, color: "#64748b" }}>
                    Válido hasta
                  </th>
                </tr>
              </thead>
              <tbody>
                {usuariosConComp.map(u => (
                  <tr key={u._id} style={{ borderBottom: "1px solid #f1f5f9" }}>
                    <td style={{ padding: "12px 16px", fontWeight: 600, color: "#0f2847" }}>
                      {u.nombre} {u.apellido || ""}
                    </td>
                    <td style={{ padding: "12px 16px", textAlign: "center" }}>
                      {u.competencia ? (
                        <span
                          style={{
                            display: "inline-block",
                            padding: "3px 10px",
                            borderRadius: 6,
                            background: NIVELES[u.competencia.nivel as keyof typeof NIVELES] || "#e2e8f0",
                            fontSize: 12,
                            fontWeight: 600,
                            color: "#1e293b",
                          }}
                        >
                          {u.competencia.nivel}
                        </span>
                      ) : (
                        <span style={{ color: "#cbd5e1", fontSize: 12 }}>—</span>
                      )}
                    </td>
                    <td style={{ padding: "12px 16px", fontSize: 12, color: "#374151" }}>
                      {u.competencia && (u.competencia.competencias as string[]).length > 0 ? (
                        <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                          {(u.competencia.competencias as string[]).map(c => (
                            <span
                              key={c}
                              style={{
                                padding: "1px 6px",
                                borderRadius: 4,
                                background: "#e0e7ff",
                                color: "#4f46e5",
                                fontSize: 11,
                                fontWeight: 600,
                              }}
                            >
                              {c}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <span style={{ color: "#cbd5e1" }}>—</span>
                      )}
                    </td>
                    <td style={{ padding: "12px 16px", textAlign: "center", fontSize: 12 }}>
                      {u.competencia?.certificado ? (
                        <span style={{ color: "#16a34a", fontWeight: 700 }}>✓ Sí</span>
                      ) : (
                        <span style={{ color: "#d97706" }}>—</span>
                      )}
                    </td>
                    <td style={{ padding: "12px 16px", textAlign: "center", fontSize: 12, color: "#64748b" }}>
                      {u.competencia?.validaHasta
                        ? new Date(u.competencia.validaHasta).toLocaleDateString("es-ES")
                        : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </main>
    </div>
  );
}
