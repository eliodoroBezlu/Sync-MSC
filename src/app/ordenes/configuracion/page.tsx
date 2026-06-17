"use client";
import React, { useState, useEffect, useCallback, useRef } from "react";
import AppHeader from "@/components/AppHeader";
import { useUser } from "@/context/AuthContext";
import { useRouter } from "next/navigation";

// ─── Types ─────────────────────────────────────────────────────────────────────
type Tab = "equipos" | "arbol" | "usuarios" | "areas" | "checklist";
type BulkField = { key: string; required?: boolean };

type EquipoItem = {
  _id: string;
  tag: string;
  descripcion: string;
  descripcion2?: string;
  nivel: number;
  parentTag?: string;
  tipoEquipo: string;
  descripcionTipo?: string;
  subtipo?: string;
  criticidad?: string;
  areaCodigo: string;
  descripcionArea?: string;
  fabricante?: string;
  modelo?: string;
  activo: boolean;
};
type EquipoForm = {
  tag: string; descripcion: string; descripcion2: string;
  nivel: string; parentTag: string;
  tipoEquipo: string; descripcionTipo: string;
  areaCodigo: string; criticidad: string;
  fabricante: string; modelo: string;
};
type ArbolItem = {
  _id: string; tipoEquipo: string | null;
  sintoma: string; codigoModo?: string;
  causaProbable: string; codigoCausa?: string;
  resolucionSugerida: string; tiempoEstimadoHrs: number; activo: boolean;
};
type ArbolForm = {
  tipoEquipo: string; sintoma: string; codigoModo: string;
  causaProbable: string; codigoCausa: string;
  resolucionSugerida: string; tiempoEstimadoHrs: string;
};
type ModoOpt  = { codigo: string; nombreEs: string; nombre: string };
type CausaOpt = { codigo: string; nombre: string };
type UsuarioItem = {
  _id: string; nombre: string; apellido: string; email: string;
  jde: string; celular: string; puesto: string; superintendencia: string; areaTrabajo: string;
  rol: number; areas: string[]; disciplina?: string; activo: boolean;
  esContratista: boolean; fechaExpiracion: string | null;
};
type UsuarioForm = {
  nombre: string; email: string; password?: string; rol: string;
  jde: string; celular: string; puesto: string; superintendencia: string; areaTrabajo: string;
  areas: string[]; disciplina: string;
  esContratista: boolean; fechaExpiracion: string;
};
type AreaItem = {
  _id: string; codigo: string; nombre: string;
  superintendencia: string; tieneCalibracion: boolean; activo: boolean;
};
type AreaForm = {
  codigo: string; nombre: string; superintendencia: string; tieneCalibracion: boolean;
};
type AreaOption = { codigo: string; nombre: string };

// ─── Shared styles ─────────────────────────────────────────────────────────────
const C = {
  card: { background: "white", borderRadius: 12, boxShadow: "0 1px 8px rgba(15,40,71,0.07)", overflow: "hidden" } as React.CSSProperties,
  th: { textAlign: "left" as const, padding: "9px 14px", fontSize: 11, fontWeight: 700, color: "#64748b", background: "#f8fafc", borderBottom: "1px solid #e2e8f0", textTransform: "uppercase" as const, letterSpacing: "0.05em" } as React.CSSProperties,
  td: { padding: "9px 14px", fontSize: 13, color: "#0f172a", borderBottom: "1px solid #f8fafc", verticalAlign: "middle" as const } as React.CSSProperties,
  formBox: { background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 10, padding: 20, marginBottom: 20 } as React.CSSProperties,
  label: { display: "block" as const, fontSize: 12, fontWeight: 600 as const, color: "#475569", marginBottom: 4 } as React.CSSProperties,
  input: { width: "100%", padding: "7px 11px", borderRadius: 7, border: "1.5px solid #cbd5e1", fontSize: 13, color: "#0f172a", outline: "none", boxSizing: "border-box" as const, background: "white" } as React.CSSProperties,
  select: { width: "100%", padding: "7px 11px", borderRadius: 7, border: "1.5px solid #cbd5e1", fontSize: 13, color: "#0f172a", background: "white", outline: "none", boxSizing: "border-box" as const } as React.CSSProperties,
  textarea: { width: "100%", padding: "7px 11px", borderRadius: 7, border: "1.5px solid #cbd5e1", fontSize: 13, color: "#0f172a", outline: "none", resize: "vertical" as const, boxSizing: "border-box" as const, fontFamily: "inherit" } as React.CSSProperties,
  btnBlue: { padding: "7px 16px", borderRadius: 7, border: "none", background: "#0f2847", color: "white", fontSize: 13, fontWeight: 600 as const, cursor: "pointer" } as React.CSSProperties,
  btnOutline: { padding: "7px 14px", borderRadius: 7, border: "1px solid #e2e8f0", background: "white", color: "#475569", fontSize: 13, cursor: "pointer" } as React.CSSProperties,
  btnRed: { padding: "4px 10px", borderRadius: 6, border: "none", background: "#fee2e2", color: "#dc2626", fontSize: 12, fontWeight: 600 as const, cursor: "pointer" } as React.CSSProperties,
  btnGreen: { padding: "4px 10px", borderRadius: 6, border: "none", background: "#dcfce7", color: "#16a34a", fontSize: 12, fontWeight: 600 as const, cursor: "pointer" } as React.CSSProperties,
  btnSmall: { padding: "3px 8px", borderRadius: 6, border: "1px solid #e2e8f0", background: "white", color: "#475569", fontSize: 12, cursor: "pointer" } as React.CSSProperties,
};

const CRIT: Record<string, { bg: string; color: string }> = {
  A: { bg: "#fee2e2", color: "#dc2626" },
  B: { bg: "#fef3c7", color: "#d97706" },
  C: { bg: "#dcfce7", color: "#16a34a" },
};
const ROL_LABEL: Record<number, string> = { 1: "Admin", 2: "Superintendente", 3: "Supervisor", 4: "Técnico", 5: "Planificador", 6: "Contratista" };
const ROL_CLR: Record<number, { bg: string; color: string }> = {
  1: { bg: "#ede9fe", color: "#7c3aed" }, 2: { bg: "#e0f2fe", color: "#0369a1" },
  3: { bg: "#ccfbf1", color: "#0f766e" }, 4: { bg: "#f1f5f9", color: "#475569" },
  5: { bg: "#fef9c3", color: "#854d0e" }, 6: { bg: "#fff7ed", color: "#c2410c" },
};

// ─── CSV utilities ─────────────────────────────────────────────────────────────
function splitCSVLine(line: string): string[] {
  const result: string[] = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQ && line[i + 1] === '"') { cur += '"'; i++; }
      else inQ = !inQ;
    } else if (ch === "," && !inQ) { result.push(cur); cur = ""; }
    else cur += ch;
  }
  result.push(cur);
  return result;
}

function parseCSVText(text: string): Record<string, string>[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return [];
  const headers = splitCSVLine(lines[0]).map((h) => h.trim().replace(/^"|"$/g, ""));
  return lines.slice(1).map((line) => {
    const vals = splitCSVLine(line);
    return Object.fromEntries(headers.map((h, i) => [h, (vals[i] ?? "").trim()]));
  });
}

function generateCSVTemplate(fields: BulkField[], rows: Record<string, string>[]): string {
  const esc = (v: string) => (v.includes(",") || v.includes('"')) ? `"${v.replace(/"/g, '""')}"` : v;
  const header = fields.map((f) => f.key).join(",");
  const dataRows = rows.map((r) => fields.map((f) => esc(r[f.key] ?? "")).join(","));
  return "﻿" + [header, ...dataRows].join("\r\n");
}

function downloadCSV(filename: string, content: string) {
  const blob = new Blob([content], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

// Normalize row keys: lowercase + strip diacritics so "Nómina" → "nomina", "JDE" → "jde"
function normalizeRowKeys(rows: Record<string, string>[]): Record<string, string>[] {
  return rows.map((row) => {
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(row)) {
      const normKey = k.trim().toLowerCase().normalize("NFD").replace(/\p{Mn}/gu, "");
      out[normKey] = typeof v === "number" ? String(v) : (v ?? "");
    }
    return out;
  });
}

// ─── Shared components ─────────────────────────────────────────────────────────
function Badge({ children, bg, color }: { children: React.ReactNode; bg: string; color: string }) {
  return (
    <span style={{ display: "inline-block", padding: "2px 8px", borderRadius: 20, fontSize: 11, fontWeight: 700, background: bg, color }}>
      {children}
    </span>
  );
}

function ErrMsg({ msg }: { msg: string }) {
  if (!msg) return null;
  return <p style={{ color: "#dc2626", fontSize: 12, margin: "8px 0 0" }}>{msg}</p>;
}

// ─── Bulk Import Panel ──────────────────────────────────────────────────────────
function BulkImportPanel({
  entityName, fileName: templateFile, fields, templateRows, onImport,
}: {
  entityName: string;
  fileName: string;
  fields: BulkField[];
  templateRows: Record<string, string>[];
  onImport: (rows: Record<string, string>[]) => Promise<{ ok: number; failed: string[] }>;
}) {
  const [show, setShow] = useState(false);
  const [parsedRows, setParsedRows] = useState<Record<string, string>[]>([]);
  const [inputName, setInputName] = useState("");
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<{ ok: number; failed: string[] } | null>(null);
  const [parseErr, setParseErr] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setInputName(file.name);
    setParsedRows([]);
    setResult(null);
    setParseErr("");

    try {
      const isExcel = /\.(xlsx|xls)$/i.test(file.name);
      if (isExcel) {
        const XLSX = await import("xlsx");
        const buffer = await file.arrayBuffer();
        const wb = XLSX.read(buffer, { type: "array" });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: "", raw: false });
        const rows = normalizeRowKeys(raw as Record<string, string>[]);
        if (rows.length === 0) { setParseErr("La hoja Excel está vacía o no tiene filas de datos"); return; }
        setParsedRows(rows);
      } else {
        const text = await file.text();
        const raw = parseCSVText(text);
        if (raw.length === 0) { setParseErr("El archivo CSV está vacío o no tiene filas de datos"); return; }
        setParsedRows(normalizeRowKeys(raw));
      }
    } catch {
      setParseErr("No se pudo leer el archivo. Verifique el formato.");
    }
  }

  async function doImport() {
    setImporting(true);
    setResult(null);
    const res = await onImport(parsedRows);
    setResult(res);
    setImporting(false);
    if (res.ok > 0 && res.failed.length === 0) {
      setParsedRows([]);
      setInputName("");
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  function reset() {
    setParsedRows([]); setInputName(""); setResult(null); setParseErr("");
    if (fileRef.current) fileRef.current.value = "";
  }

  const previewCols = parsedRows.length > 0 ? Object.keys(parsedRows[0]) : [];
  const previewRows = parsedRows.slice(0, 5);

  return (
    <>
      <button
        style={{ ...C.btnOutline, display: "flex", alignItems: "center", gap: 6 }}
        onClick={() => { setShow((s) => !s); reset(); }}
      >
        <span style={{ fontSize: 16, lineHeight: 1 }}>↑</span> Carga Masiva
      </button>

      {show && (
        <div style={{ ...C.formBox, marginBottom: 20 }}>
          {/* Header */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
            <h3 style={{ margin: 0, fontSize: 14, fontWeight: 700, color: "#0f2847" }}>
              Carga Masiva — {entityName}
            </h3>
            <button style={{ ...C.btnSmall, padding: "2px 8px" }} onClick={() => { setShow(false); reset(); }}>✕</button>
          </div>

          {/* Column reference */}
          <div style={{ marginBottom: 14, padding: "10px 14px", background: "#eff6ff", borderRadius: 8, border: "1px solid #bfdbfe" }}>
            <p style={{ margin: "0 0 6px", fontSize: 12, fontWeight: 700, color: "#1d4ed8" }}>
              Columnas requeridas en el archivo:
            </p>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 6 }}>
              {fields.map((f) => (
                <span key={f.key} style={{
                  fontSize: 11, padding: "2px 8px", borderRadius: 4, fontFamily: "monospace",
                  background: f.required ? "#dbeafe" : "#e0f2fe",
                  color: f.required ? "#1e40af" : "#0369a1",
                  fontWeight: f.required ? 700 : 500,
                }}>
                  {f.key}{f.required ? " *" : ""}
                </span>
              ))}
            </div>
            <p style={{ margin: 0, fontSize: 11, color: "#475569" }}>
              * campos obligatorios · La primera fila debe ser la cabecera · separador de columnas: coma (,)
            </p>
          </div>

          {/* Actions row */}
          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginBottom: 14 }}>
            <button
              style={{ ...C.btnOutline, fontSize: 12, display: "flex", alignItems: "center", gap: 5 }}
              onClick={() => downloadCSV(templateFile, generateCSVTemplate(fields, templateRows))}
            >
              ⬇ Descargar Plantilla CSV
            </button>

            <label style={{
              padding: "7px 14px", borderRadius: 7, cursor: "pointer",
              border: inputName ? "1.5px solid #86efac" : "1.5px dashed #94a3b8",
              background: inputName ? "#f0fdf4" : "#f8fafc",
              color: inputName ? "#15803d" : "#64748b",
              fontSize: 13, display: "inline-flex", alignItems: "center", gap: 6,
            }}>
              <span style={{ fontSize: 15 }}>📎</span>
              {inputName || "Seleccionar archivo (.csv o .xlsx)"}
              <input ref={fileRef} type="file" accept=".csv,.xlsx,.xls" style={{ display: "none" }} onChange={handleFile} />
            </label>

            {inputName && (
              <button style={{ ...C.btnSmall, fontSize: 11 }} onClick={reset}>Limpiar</button>
            )}
          </div>

          {/* Parse error */}
          {parseErr && (
            <p style={{ color: "#dc2626", fontSize: 12, margin: "0 0 12px", padding: "8px 12px", background: "#fee2e2", borderRadius: 6 }}>
              ⚠ {parseErr}
            </p>
          )}

          {/* Preview */}
          {parsedRows.length > 0 && !result && (
            <div style={{ marginBottom: 14 }}>
              <p style={{ fontSize: 12, color: "#475569", margin: "0 0 8px", fontWeight: 600 }}>
                Vista previa — {parsedRows.length} fila{parsedRows.length !== 1 ? "s" : ""} detectada{parsedRows.length !== 1 ? "s" : ""}
                {parsedRows.length > 5 ? " (mostrando primeras 5)" : ""}:
              </p>
              <div style={{ overflowX: "auto", borderRadius: 8, border: "1px solid #e2e8f0" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                  <thead>
                    <tr>
                      {previewCols.map((col) => (
                        <th key={col} style={{ ...C.th, fontSize: 11, background: "#f1f5f9" }}>{col}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {previewRows.map((row, i) => (
                      <tr key={i}>
                        {previewCols.map((col) => (
                          <td key={col} style={{ ...C.td, fontSize: 11, maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const }}>
                            {row[col]}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <button
                style={{ ...C.btnBlue, marginTop: 12 }}
                onClick={doImport}
                disabled={importing}
              >
                {importing ? "Importando…" : `Importar ${parsedRows.length} registro${parsedRows.length !== 1 ? "s" : ""}`}
              </button>
            </div>
          )}

          {/* Result */}
          {result && (
            <div style={{
              padding: "12px 16px", borderRadius: 8,
              background: result.failed.length === 0 ? "#f0fdf4" : "#fff7ed",
              border: `1px solid ${result.failed.length === 0 ? "#86efac" : "#fed7aa"}`,
            }}>
              <p style={{ margin: "0 0 (result.failed.length > 0 ? 6 : 0)px", fontSize: 13, fontWeight: 700, color: result.failed.length === 0 ? "#16a34a" : "#ea580c" }}>
                ✓ {result.ok} registro{result.ok !== 1 ? "s" : ""} importado{result.ok !== 1 ? "s" : ""}
                {result.failed.length > 0 && ` · ${result.failed.length} error${result.failed.length !== 1 ? "es" : ""}`}
              </p>
              {result.failed.length > 0 && (
                <ul style={{ margin: "6px 0 0", padding: "0 0 0 18px", fontSize: 12, color: "#9a3412" }}>
                  {result.failed.slice(0, 10).map((e, i) => <li key={i}>{e}</li>)}
                  {result.failed.length > 10 && <li style={{ color: "#64748b" }}>…y {result.failed.length - 10} errores más</li>}
                </ul>
              )}
              <button style={{ ...C.btnSmall, marginTop: 10, fontSize: 12 }} onClick={reset}>
                Importar otro archivo
              </button>
            </div>
          )}
        </div>
      )}
    </>
  );
}

// Nivel labels y colores
const NIVEL_LABEL: Record<number, string> = {
  1: "Planta", 2: "Área Funcional", 3: "Sistema", 4: "Equipo",
  5: "Subequipo", 6: "Componente", 7: "Parte/Sensor", 8: "Sub-elemento",
};
const NIVEL_COLOR: Record<number, { bg: string; color: string }> = {
  1: { bg: "#0f2847", color: "white" },
  2: { bg: "#1e40af", color: "white" },
  3: { bg: "#0369a1", color: "white" },
  4: { bg: "#0891b2", color: "white" },
  5: { bg: "#059669", color: "white" },
  6: { bg: "#d97706", color: "white" },
  7: { bg: "#7c3aed", color: "white" },
  8: { bg: "#be185d", color: "white" },
};

// ─── Tab: Equipos ──────────────────────────────────────────────────────────────
function EquiposTab() {
  const [items,    setItems]    = useState<EquipoItem[]>([]);
  const [total,    setTotal]    = useState(0);
  const [loading,  setLoading]  = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editItem, setEditItem] = useState<EquipoItem | null>(null);
  const [form, setForm] = useState<EquipoForm>({
    tag: "", descripcion: "", descripcion2: "", nivel: "4", parentTag: "",
    tipoEquipo: "", descripcionTipo: "", areaCodigo: "", criticidad: "",
    fabricante: "", modelo: "",
  });
  const [saving,   setSaving]   = useState(false);
  const [err,      setErr]      = useState("");

  // Filtros
  const [filtroArea,   setFiltroArea]   = useState("");
  const [filtroNivel,  setFiltroNivel]  = useState("");
  const [filtroCrit,   setFiltroCrit]   = useState("");
  const [busqueda,     setBusqueda]     = useState("");
  const [buscInput,    setBuscInput]    = useState("");
  const [page,         setPage]         = useState(0);
  const PAGE_SIZE = 50;

  // Carga de áreas nivel 2 (áreas funcionales del Excel)
  const [areasFuncionales, setAreasFuncionales] = useState<EquipoItem[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({ all: "true", limit: String(PAGE_SIZE), page: String(page) });
    if (filtroArea)  params.set("area", filtroArea);
    if (filtroNivel) params.set("nivel", filtroNivel);
    if (filtroCrit)  params.set("crit", filtroCrit);
    if (busqueda)    params.set("q", busqueda);

    const data: EquipoItem[] = await fetch(`/api/equipos?${params}`).then((r) => r.json());
    setItems(data);
    setTotal(data.length < PAGE_SIZE ? page * PAGE_SIZE + data.length : -1);
    setLoading(false);
  }, [filtroArea, filtroNivel, filtroCrit, busqueda, page]);

  // Cargar áreas funcionales (nivel 2) para el filtro
  useEffect(() => {
    fetch("/api/equipos?nivel=2&all=true&limit=100").then(r => r.json())
      .then((data: EquipoItem[]) => setAreasFuncionales(data));
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { setPage(0); }, [filtroArea, filtroNivel, filtroCrit, busqueda]);

  function openAdd() {
    setEditItem(null);
    setForm({ tag: "", descripcion: "", descripcion2: "", nivel: "4", parentTag: "",
              tipoEquipo: "", descripcionTipo: "", areaCodigo: "", criticidad: "",
              fabricante: "", modelo: "" });
    setErr(""); setShowForm(true);
  }

  function openEdit(item: EquipoItem) {
    setEditItem(item);
    setForm({
      tag: item.tag, descripcion: item.descripcion, descripcion2: item.descripcion2 ?? "",
      nivel: String(item.nivel), parentTag: item.parentTag ?? "",
      tipoEquipo: item.tipoEquipo, descripcionTipo: item.descripcionTipo ?? "",
      areaCodigo: item.areaCodigo, criticidad: item.criticidad ?? "",
      fabricante: item.fabricante ?? "", modelo: item.modelo ?? "",
    });
    setErr(""); setShowForm(true);
  }

  async function save() {
    if (!form.tag || !form.descripcion || !form.areaCodigo) {
      setErr("TAG, descripción y área son obligatorios"); return;
    }
    setSaving(true); setErr("");
    const body: Record<string, unknown> = {
      tag: form.tag.toUpperCase().trim(),
      descripcion: form.descripcion.trim(),
      nivel: Number(form.nivel) || 4,
      areaCodigo: form.areaCodigo,
    };
    if (form.descripcion2)  body.descripcion2  = form.descripcion2.trim();
    if (form.parentTag)     body.parentTag     = form.parentTag.toUpperCase().trim();
    if (form.tipoEquipo)    body.tipoEquipo    = form.tipoEquipo.trim();
    if (form.descripcionTipo) body.descripcionTipo = form.descripcionTipo.trim();
    if (form.criticidad)    body.criticidad    = form.criticidad;
    if (form.fabricante)    body.fabricante    = form.fabricante.trim();
    if (form.modelo)        body.modelo        = form.modelo.trim();

    const url = editItem ? `/api/equipos/${editItem._id}` : "/api/equipos";
    const res = await fetch(url, { method: editItem ? "PUT" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const data = await res.json();
    setSaving(false);
    if (!data.ok) { setErr(data.error ?? "Error al guardar"); return; }
    setShowForm(false); load();
  }

  async function toggleActivo(item: EquipoItem) {
    await fetch(`/api/equipos/${item._id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ activo: !item.activo }) });
    load();
  }

  // Importar desde Excel/CSV en formato TagNiveles
  async function importarFilas(rows: Record<string, string>[]): Promise<{ ok: number; failed: string[] }> {
    const failed: string[] = [];
    // Construir el array de equipos con parentTag inferido
    const parentStack: Record<number, string> = {};
    const equipos: Record<string, unknown>[] = [];

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const tag = (row["Nº unidad"] || row["tag"] || "").toString().toUpperCase().trim();
      if (!tag || tag === ".") { failed.push(`Fila ${i + 2}: TAG vacío`); continue; }

      const nivelStr = (row["Nivel"] || row["nivel"] || "").toString().trim();
      const nivelMatch = nivelStr.match(/(\d+)$/);
      const nivel = nivelMatch ? parseInt(nivelMatch[1], 10) : 4;

      parentStack[nivel] = tag;
      for (let n = nivel + 1; n <= 8; n++) delete parentStack[n];
      const parentTag = nivel > 1 ? (parentStack[nivel - 1] ?? undefined) : undefined;
      const nivelPath: string[] = [];
      for (let n = 1; n < nivel; n++) { if (parentStack[n]) nivelPath.push(parentStack[n]); }

      const areaCodigo = (row["Area"] || row["areaCodigo"] || "0").toString().trim();
      const criticidad = (row["Crit"] || row["criticidad"] || "").toString().trim().toUpperCase();
      const tipo       = (row["Tipo"] || row["tipoEquipo"] || ".").toString().trim();
      const descTipo   = (row["Descripción Tipo"] || row["descripcionTipo"] || "").toString().trim();
      const subtipo    = (row["SubTipo"] || row["subtipo"] || "").toString().trim();
      const descSub    = (row["Descripción SubTipo"] || row["descripcionSubtipo"] || "").toString().trim();

      const eq: Record<string, unknown> = {
        tag, nivel, areaCodigo,
        descripcion: (row["Descripción"] || row["descripcion"] || tag).toString().trim(),
        tipoEquipo: tipo === "." || !tipo ? "." : tipo,
        activo: true,
      };
      if (parentTag)          eq.parentTag = parentTag;
      if (nivelPath.length)   eq.nivelPath = nivelPath;
      const d2 = (row["Descripción 2"] || row["descripcion2"] || "").toString().trim();
      const d3 = (row["Descripción 3"] || row["descripcion3"] || "").toString().trim();
      if (d2 && d2 !== ".")  eq.descripcion2 = d2;
      if (d3 && d3 !== ".")  eq.descripcion3 = d3;
      if (descTipo && descTipo !== ".")  eq.descripcionTipo = descTipo;
      if (subtipo && subtipo !== ".")    eq.subtipo = subtipo;
      if (descSub && descSub !== ".")    eq.descripcionSubtipo = descSub;
      if (["A","B","C"].includes(criticidad)) eq.criticidad = criticidad;
      const ccosto = (row["Ccosto"] || row["centroCosto"] || "").toString().trim();
      if (ccosto) eq.centroCosto = ccosto;
      const descArea = (row["Descripción Area"] || row["descripcionArea"] || "").toString().trim();
      if (descArea) eq.descripcionArea = descArea;

      equipos.push(eq);
    }

    if (equipos.length === 0) return { ok: 0, failed };

    try {
      const res = await fetch("/api/equipos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(equipos),
      });
      const d = await res.json() as { ok: boolean; inserted?: number; modified?: number; error?: string };
      if (!d.ok) { failed.push(d.error ?? "Error en carga masiva"); return { ok: 0, failed }; }
      load();
      return { ok: (d.inserted ?? 0) + (d.modified ?? 0), failed };
    } catch (e) {
      failed.push("Error de conexión");
      return { ok: 0, failed };
    }
  }

  const upd = (k: keyof EquipoForm, v: string) => setForm((f) => ({ ...f, [k]: v }));

  // Campos del CSV compatible con TagNiveles.xlsx
  const EQUIPO_FIELDS: BulkField[] = [
    { key: "Nivel", required: true }, { key: "Nº unidad", required: true },
    { key: "Descripción", required: true }, { key: "Descripción 2" }, { key: "Descripción 3" },
    { key: "Tipo" }, { key: "Descripción Tipo" }, { key: "SubTipo" }, { key: "Descripción SubTipo" },
    { key: "Crit" }, { key: "Ccosto" }, { key: "Area", required: true }, { key: "Descripción Area" },
  ];
  const EQUIPO_TEMPLATE = [
    { "Nivel": "2", "Nº unidad": "210", "Descripción": "Area Chancado", "Descripción 2": "", "Descripción 3": "", "Tipo": "", "Descripción Tipo": "", "SubTipo": "", "Descripción SubTipo": "", "Crit": "", "Ccosto": "", "Area": "3210", "Descripción Area": "P-Chancadora & Apiladora" },
    { "Nivel": "4", "Nº unidad": "210CR001UE", "Descripción": "UE Chancador Primario", "Descripción 2": "", "Descripción 3": "", "Tipo": "CRH", "Descripción Tipo": "Trituración", "SubTipo": "CRH", "Descripción SubTipo": "Triturador de Cono", "Crit": "C", "Ccosto": "22061100", "Area": "3210", "Descripción Area": "P-Chancadora & Apiladora" },
    { "Nivel": "7", "Nº unidad": "PIT-210001", "Descripción": "Transmisor de Presión", "Descripción 2": "Descarga Chancadora", "Descripción 3": "", "Tipo": "SNT", "Descripción Tipo": "Sensor / Transmisor", "SubTipo": "PRS", "Descripción SubTipo": "Presión", "Crit": "C", "Ccosto": "22061100", "Area": "3210", "Descripción Area": "P-Chancadora & Apiladora" },
  ];

  return (
    <div>
      {/* ── Header ── */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 }}>
        <div>
          <h2 style={{ fontSize: 16, fontWeight: 700, color: "#0f2847", margin: 0 }}>Equipos / TAGs</h2>
          <p style={{ fontSize: 12, color: "#64748b", margin: "2px 0 0" }}>
            Jerarquía ISO 14224 — 8 niveles · {total >= 0 ? total : "8,000+"} registros
          </p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button style={C.btnBlue} onClick={openAdd}>+ Nuevo</button>
          <BulkImportPanel
            entityName="Equipos (TagNiveles)"
            fileName="plantilla_TagNiveles.csv"
            fields={EQUIPO_FIELDS}
            templateRows={EQUIPO_TEMPLATE}
            onImport={importarFilas}
          />
        </div>
      </div>

      {/* ── Filtros ── */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 12 }}>
        <select
          value={filtroArea} onChange={(e) => setFiltroArea(e.target.value)}
          style={{ ...C.select, minWidth: 200 }}
        >
          <option value="">Área Funcional: Todas</option>
          {areasFuncionales.map((a) => (
            <option key={a.tag} value={a.areaCodigo}>
              {a.tag} — {a.descripcion}
            </option>
          ))}
        </select>
        <select
          value={filtroNivel} onChange={(e) => setFiltroNivel(e.target.value)}
          style={C.select}
        >
          <option value="">Nivel: Todos</option>
          {[1,2,3,4,5,6,7,8].map((n) => (
            <option key={n} value={n}>N{n} — {NIVEL_LABEL[n]}</option>
          ))}
        </select>
        <select
          value={filtroCrit} onChange={(e) => setFiltroCrit(e.target.value)}
          style={C.select}
        >
          <option value="">Criticidad: Todas</option>
          <option value="A">A — Alta</option>
          <option value="B">B — Media</option>
          <option value="C">C — Baja</option>
        </select>
        <div style={{ display: "flex", gap: 6 }}>
          <input
            value={buscInput} onChange={(e) => setBuscInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") setBusqueda(buscInput); }}
            placeholder="Buscar TAG o descripción…"
            style={{ ...C.input, width: 220, margin: 0 }}
          />
          <button style={C.btnBlue} onClick={() => setBusqueda(buscInput)}>Buscar</button>
          {busqueda && <button style={C.btnOutline} onClick={() => { setBuscInput(""); setBusqueda(""); }}>✕</button>}
        </div>
      </div>

      {/* ── Formulario agregar / editar ── */}
      {showForm && (
        <div style={C.formBox}>
          <h3 style={{ margin: "0 0 16px", fontSize: 14, fontWeight: 700, color: "#0f2847" }}>
            {editItem ? "Editar Equipo" : "Nuevo Equipo / TAG"}
          </h3>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "12px 16px" }}>
            <div>
              <label style={C.label}>TAG / Nº Unidad *</label>
              <input style={C.input} value={form.tag} onChange={(e) => upd("tag", e.target.value.toUpperCase())} placeholder="Ej: 210CR001 / PIT-210001" disabled={!!editItem} />
            </div>
            <div style={{ gridColumn: "span 2" }}>
              <label style={C.label}>Descripción *</label>
              <input style={C.input} value={form.descripcion} onChange={(e) => upd("descripcion", e.target.value)} placeholder="Ej: Triturador Primario" />
            </div>
            <div style={{ gridColumn: "span 3" }}>
              <label style={C.label}>Descripción 2 (especificación)</label>
              <input style={C.input} value={form.descripcion2} onChange={(e) => upd("descripcion2", e.target.value)} placeholder="Ej: 2425t/h - 1000mm Tamaño Max" />
            </div>
            <div>
              <label style={C.label}>Nivel jerárquico *</label>
              <select style={C.select} value={form.nivel} onChange={(e) => upd("nivel", e.target.value)}>
                {[1,2,3,4,5,6,7,8].map((n) => (
                  <option key={n} value={n}>N{n} — {NIVEL_LABEL[n]}</option>
                ))}
              </select>
            </div>
            <div>
              <label style={C.label}>TAG Padre</label>
              <input style={C.input} value={form.parentTag} onChange={(e) => upd("parentTag", e.target.value.toUpperCase())} placeholder="Ej: 210TI001" />
            </div>
            <div>
              <label style={C.label}>Área (código JDE) *</label>
              <input style={C.input} value={form.areaCodigo} onChange={(e) => upd("areaCodigo", e.target.value)} placeholder="Ej: 3210" />
            </div>
            <div>
              <label style={C.label}>Tipo (código)</label>
              <input style={C.input} value={form.tipoEquipo} onChange={(e) => upd("tipoEquipo", e.target.value)} placeholder="Ej: EMT / SWT / HDS" />
            </div>
            <div>
              <label style={C.label}>Descripción Tipo</label>
              <input style={C.input} value={form.descripcionTipo} onChange={(e) => upd("descripcionTipo", e.target.value)} placeholder="Ej: Motor Eléctrico" />
            </div>
            <div>
              <label style={C.label}>Criticidad</label>
              <select style={C.select} value={form.criticidad} onChange={(e) => upd("criticidad", e.target.value)}>
                <option value="">— Sin definir —</option>
                <option value="A">A — Alta</option>
                <option value="B">B — Media</option>
                <option value="C">C — Baja</option>
              </select>
            </div>
            <div>
              <label style={C.label}>Fabricante</label>
              <input style={C.input} value={form.fabricante} onChange={(e) => upd("fabricante", e.target.value)} placeholder="Ej: Rosemount" />
            </div>
            <div>
              <label style={C.label}>Modelo</label>
              <input style={C.input} value={form.modelo} onChange={(e) => upd("modelo", e.target.value)} placeholder="Ej: 3051S" />
            </div>
          </div>
          <ErrMsg msg={err} />
          <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
            <button style={C.btnBlue} onClick={save} disabled={saving}>{saving ? "Guardando…" : "Guardar"}</button>
            <button style={C.btnOutline} onClick={() => setShowForm(false)}>Cancelar</button>
          </div>
        </div>
      )}

      {/* ── Tabla ── */}
      {loading ? (
        <p style={{ color: "#64748b", fontSize: 13 }}>Cargando equipos…</p>
      ) : (
        <div style={C.card}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={{ ...C.th, width: 32 }}>N</th>
                <th style={C.th}>TAG / Nº Unidad</th>
                <th style={C.th}>Descripción</th>
                <th style={C.th}>Tipo</th>
                <th style={C.th}>Área JDE</th>
                <th style={{ ...C.th, width: 50 }}>Crit.</th>
                <th style={{ ...C.th, width: 60 }}>Estado</th>
                <th style={{ ...C.th, width: 80 }}></th>
              </tr>
            </thead>
            <tbody>
              {items.length === 0 && (
                <tr><td colSpan={8} style={{ ...C.td, color: "#94a3b8", textAlign: "center", padding: 28 }}>
                  Sin resultados. Ajusta los filtros o ejecuta{" "}
                  <code style={{ background: "#f1f5f9", padding: "1px 6px", borderRadius: 4 }}>node scripts/seed-equipos.js TagNiveles.xlsx</code>
                </td></tr>
              )}
              {items.map((item) => {
                const nc = NIVEL_COLOR[item.nivel] ?? { bg: "#f1f5f9", color: "#475569" };
                const indent = Math.max(0, (item.nivel - 1) * 12);
                return (
                  <tr key={item._id} style={{ opacity: item.activo ? 1 : 0.45, borderBottom: "1px solid #f1f5f9" }}>
                    {/* Nivel badge */}
                    <td style={{ ...C.td, padding: "8px 6px", textAlign: "center" }}>
                      <span style={{
                        display: "inline-block", width: 22, height: 22, borderRadius: 5,
                        background: nc.bg, color: nc.color,
                        fontSize: 10, fontWeight: 800, lineHeight: "22px", textAlign: "center",
                      }}>
                        {item.nivel}
                      </span>
                    </td>
                    {/* TAG */}
                    <td style={{ ...C.td, fontWeight: 700, fontFamily: "monospace", fontSize: 12, paddingLeft: indent + 8 }}>
                      {item.tag}
                    </td>
                    {/* Descripción */}
                    <td style={{ ...C.td }}>
                      <span style={{ color: "#0f2847", fontSize: 13 }}>{item.descripcion}</span>
                      {item.descripcion2 && (
                        <span style={{ display: "block", fontSize: 11, color: "#94a3b8" }}>{item.descripcion2}</span>
                      )}
                    </td>
                    {/* Tipo */}
                    <td style={{ ...C.td, fontSize: 12 }}>
                      {item.tipoEquipo && item.tipoEquipo !== "." ? (
                        <span style={{ fontFamily: "monospace", fontWeight: 700, color: "#0369a1" }}>{item.tipoEquipo}</span>
                      ) : <span style={{ color: "#cbd5e1" }}>—</span>}
                      {item.descripcionTipo && item.descripcionTipo !== "." && (
                        <span style={{ display: "block", fontSize: 11, color: "#64748b" }}>{item.descripcionTipo}</span>
                      )}
                    </td>
                    {/* Área */}
                    <td style={{ ...C.td, fontFamily: "monospace", fontSize: 12, color: "#475569" }}>
                      {item.areaCodigo}
                      {item.descripcionArea && (
                        <span style={{ display: "block", fontSize: 10, color: "#94a3b8", fontFamily: "sans-serif" }}>
                          {item.descripcionArea.replace(/^P-/, "")}
                        </span>
                      )}
                    </td>
                    {/* Criticidad */}
                    <td style={{ ...C.td, textAlign: "center" }}>
                      {item.criticidad
                        ? <Badge bg={CRIT[item.criticidad]?.bg ?? "#f1f5f9"} color={CRIT[item.criticidad]?.color ?? "#475569"}>{item.criticidad}</Badge>
                        : <span style={{ color: "#cbd5e1" }}>—</span>}
                    </td>
                    {/* Estado */}
                    <td style={C.td}>
                      <Badge bg={item.activo ? "#dcfce7" : "#f1f5f9"} color={item.activo ? "#16a34a" : "#94a3b8"}>
                        {item.activo ? "Activo" : "Inact."}
                      </Badge>
                    </td>
                    {/* Acciones */}
                    <td style={{ ...C.td, whiteSpace: "nowrap" as const }}>
                      <button style={{ ...C.btnSmall, marginRight: 4 }} onClick={() => openEdit(item)}>Editar</button>
                      <button style={item.activo ? C.btnRed : C.btnGreen} onClick={() => toggleActivo(item)}>
                        {item.activo ? "Desact." : "Act."}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {/* Paginación */}
          <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 16px", borderTop: "1px solid #f1f5f9" }}>
            <button
              style={{ ...C.btnSmall, opacity: page === 0 ? 0.4 : 1 }}
              disabled={page === 0}
              onClick={() => setPage((p) => Math.max(0, p - 1))}
            >‹ Anterior</button>
            <span style={{ fontSize: 12, color: "#64748b" }}>
              Página {page + 1} · mostrando {items.length} de {PAGE_SIZE} por página
            </span>
            <button
              style={{ ...C.btnSmall, opacity: items.length < PAGE_SIZE ? 0.4 : 1 }}
              disabled={items.length < PAGE_SIZE}
              onClick={() => setPage((p) => p + 1)}
            >Siguiente ›</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Tab: Árbol de Fallas ──────────────────────────────────────────────────────
function ArbolTab() {
  const [items, setItems] = useState<ArbolItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editItem, setEditItem] = useState<ArbolItem | null>(null);
  const FORM_EMPTY: ArbolForm = { tipoEquipo: "", sintoma: "", codigoModo: "", causaProbable: "", codigoCausa: "", resolucionSugerida: "", tiempoEstimadoHrs: "0" };
  const [form, setForm] = useState<ArbolForm>(FORM_EMPTY);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");
  const [modosOpts, setModosOpts] = useState<ModoOpt[]>([]);
  const [causasOpts, setCausasOpts] = useState<CausaOpt[]>([]);
  const [filtroTipo, setFiltroTipo] = useState("");
  const [filtroModo, setFiltroModo] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    const [data, mods, caus] = await Promise.all([
      fetch("/api/arbol-fallas?admin=true").then(r => r.json()),
      fetch("/api/catalogo/modos").then(r => r.json()),
      fetch("/api/catalogo/causas").then(r => r.json()),
    ]);
    setItems(data); setModosOpts(mods); setCausasOpts(caus); setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  function openAdd() {
    setEditItem(null); setForm(FORM_EMPTY); setErr(""); setShowForm(true);
  }
  function openEdit(item: ArbolItem) {
    setEditItem(item);
    setForm({
      tipoEquipo: item.tipoEquipo ?? "", sintoma: item.sintoma, codigoModo: item.codigoModo ?? "",
      causaProbable: item.causaProbable, codigoCausa: item.codigoCausa ?? "",
      resolucionSugerida: item.resolucionSugerida, tiempoEstimadoHrs: String(item.tiempoEstimadoHrs),
    });
    setErr(""); setShowForm(true);
  }

  async function save() {
    if (!form.sintoma || !form.causaProbable) { setErr("Síntoma y Causa son obligatorios"); return; }
    setSaving(true); setErr("");
    const body = {
      tipoEquipo: form.tipoEquipo || null, sintoma: form.sintoma, codigoModo: form.codigoModo || undefined,
      causaProbable: form.causaProbable, codigoCausa: form.codigoCausa || undefined,
      resolucionSugerida: form.resolucionSugerida, tiempoEstimadoHrs: Number(form.tiempoEstimadoHrs) || 0,
    };
    const url = editItem ? `/api/arbol-fallas/${editItem._id}` : "/api/arbol-fallas";
    const res = await fetch(url, { method: editItem ? "PUT" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const data = await res.json();
    setSaving(false);
    if (!data.ok) { setErr(data.error ?? "Error al guardar"); return; }
    setShowForm(false); load();
  }

  async function deleteItem(item: ArbolItem) {
    if (!confirm(`¿Eliminar "${item.sintoma} — ${item.causaProbable}"?`)) return;
    await fetch(`/api/arbol-fallas/${item._id}`, { method: "DELETE" }); load();
  }

  const upd = (k: keyof ArbolForm, v: string) => setForm(f => ({ ...f, [k]: v }));

  // Filtrado
  const tiposUnicos = [...new Set(items.map(i => i.tipoEquipo ?? "").filter(Boolean))].sort();
  const modosUnicos = [...new Set(items.map(i => i.codigoModo ?? "").filter(Boolean))].sort();
  const filtered = items.filter(i =>
    (!filtroTipo || i.tipoEquipo === filtroTipo) &&
    (!filtroModo || i.codigoModo === filtroModo)
  );
  const groups: Record<string, ArbolItem[]> = {};
  for (const item of filtered) {
    const key = `${item.tipoEquipo ?? "Genérico"} · [${item.codigoModo ?? "—"}] ${item.sintoma ?? ""}`;
    if (!groups[key]) groups[key] = [];
    groups[key].push(item);
  }

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
        <div>
          <h2 style={{ fontSize: 16, fontWeight: 700, color: "#0f2847", margin: 0 }}>Árbol de Fallas ISO 14224</h2>
          <p style={{ fontSize: 12, color: "#64748b", margin: "2px 0 0" }}>
            {items.length} relaciones · {tiposUnicos.length} tipos de equipo · {modosUnicos.length} modos de falla
          </p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <a href="/api/seed/arbol-fallas" target="_blank"
            onClick={e => { e.preventDefault(); fetch("/api/seed/arbol-fallas", { method: "POST" }).then(() => load()); }}
            style={{ ...C.btnOutline, fontSize: 12, textDecoration: "none", display: "inline-flex", alignItems: "center" }}>
            Sembrar ISO 14224
          </a>
          <button
            onClick={() => fetch("/api/seed/categorias-iso", { method: "POST" })
              .then(r => r.json())
              .then(j => alert(
                `Mapeo de categorías ISO:\n\n` +
                `• Con categoría: ${j.totalConCategoria ?? "?"} equipos\n` +
                `• Sin categoría: ${j.totalSinCategoria ?? "?"} equipos\n` +
                `• Categorías válidas en árbol: ${j.categoriasValidas ?? "?"}\n` +
                `• Cambios por código JDE: ${j.porCodigoJDE ?? 0}\n` +
                `• Cambios por descripción: ${j.porDescripcion ?? 0}` +
                (j.error ? `\n\nError: ${j.error}` : "")
              ))}
            style={{ ...C.btnOutline, fontSize: 12 }}>
            Mapear categorías
          </button>
          <button style={C.btnBlue} onClick={openAdd}>+ Agregar</button>
        </div>
      </div>

      {/* Filtros */}
      <div style={{ display: "flex", gap: 10, marginBottom: 14 }}>
        <select value={filtroTipo} onChange={e => setFiltroTipo(e.target.value)} style={{ ...C.input, width: 200, margin: 0 }}>
          <option value="">Todos los tipos</option>
          {tiposUnicos.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
        <select value={filtroModo} onChange={e => setFiltroModo(e.target.value)} style={{ ...C.input, width: 220, margin: 0 }}>
          <option value="">Todos los modos</option>
          {modosUnicos.map(m => {
            const info = modosOpts.find(x => x.codigo === m);
            return <option key={m} value={m}>[{m}] {info?.nombreEs || info?.nombre || m}</option>;
          })}
        </select>
        {(filtroTipo || filtroModo) && (
          <button style={C.btnOutline} onClick={() => { setFiltroTipo(""); setFiltroModo(""); }}>Limpiar</button>
        )}
      </div>

      {showForm && (
        <div style={C.formBox}>
          <h3 style={{ margin: "0 0 14px", fontSize: 14, fontWeight: 700, color: "#0f2847" }}>
            {editItem ? "Editar Entrada" : "Nueva Entrada del Árbol de Fallas"}
          </h3>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "10px 14px" }}>
            <div>
              <label style={C.label}>Tipo de Equipo</label>
              <input style={C.input} value={form.tipoEquipo} onChange={e => upd("tipoEquipo", e.target.value)} placeholder="MOTORES, BOMBAS…" />
            </div>
            <div>
              <label style={C.label}>Modo de Falla (ISO 14224) *</label>
              <select style={C.input} value={form.codigoModo} onChange={e => {
                const m = modosOpts.find(x => x.codigo === e.target.value);
                upd("codigoModo", e.target.value);
                if (m) upd("sintoma", m.nombreEs || m.nombre);
              }}>
                <option value="">— Seleccionar modo —</option>
                {modosOpts.map(m => <option key={m.codigo} value={m.codigo}>[{m.codigo}] {m.nombreEs || m.nombre}</option>)}
              </select>
            </div>
            <div>
              <label style={C.label}>Descripción del Síntoma *</label>
              <input style={C.input} value={form.sintoma} onChange={e => upd("sintoma", e.target.value)} placeholder="Se autocompleta al elegir modo" />
            </div>
            <div>
              <label style={C.label}>Causa (código MSC)</label>
              <select style={C.input} value={form.codigoCausa} onChange={e => {
                const c = causasOpts.find(x => x.codigo === e.target.value);
                upd("codigoCausa", e.target.value);
                if (c) upd("causaProbable", c.nombre);
              }}>
                <option value="">— Seleccionar causa —</option>
                {causasOpts.map(c => <option key={c.codigo} value={c.codigo}>[{c.codigo}] {c.nombre}</option>)}
              </select>
            </div>
            <div>
              <label style={C.label}>Descripción de la Causa *</label>
              <input style={C.input} value={form.causaProbable} onChange={e => upd("causaProbable", e.target.value)} placeholder="Se autocompleta al elegir causa" />
            </div>
            <div>
              <label style={C.label}>Tiempo Estimado (hrs)</label>
              <input type="number" min="0" step="0.5" style={C.input} value={form.tiempoEstimadoHrs} onChange={e => upd("tiempoEstimadoHrs", e.target.value)} />
            </div>
            <div style={{ gridColumn: "span 3" }}>
              <label style={C.label}>Resolución Sugerida <span style={{ fontWeight: 400, color: "#94a3b8" }}>(opcional — se agrega con la experiencia operativa)</span></label>
              <textarea rows={2} style={C.textarea} value={form.resolucionSugerida} onChange={e => upd("resolucionSugerida", e.target.value)} placeholder="Ej: Verificar señal con multímetro. Si fuera de spec, recalibrar…" />
            </div>
          </div>
          <ErrMsg msg={err} />
          <div style={{ display: "flex", gap: 10, marginTop: 14 }}>
            <button style={C.btnBlue} onClick={save} disabled={saving}>{saving ? "Guardando…" : "Guardar"}</button>
            <button style={C.btnOutline} onClick={() => setShowForm(false)}>Cancelar</button>
          </div>
        </div>
      )}

      {loading ? <p style={{ color: "#64748b", fontSize: 13 }}>Cargando…</p>
        : items.length === 0 ? (
          <div style={{ ...C.card, padding: 28, textAlign: "center" as const, color: "#94a3b8", fontSize: 13 }}>
            Sin entradas. Haz clic en &quot;Sembrar ISO 14224&quot; para cargar los datos del Excel.
          </div>
        ) : (
          Object.entries(groups).sort(([a], [b]) => a.localeCompare(b)).map(([grupo, entries]) => (
            <div key={grupo} style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: "#1d4ed8", padding: "5px 8px", background: "#eff6ff", borderRadius: 6, marginBottom: 6 }}>
                {grupo}
              </div>
              <div style={C.card}>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead>
                    <tr>
                      <th style={{ ...C.th, width: 100 }}>Cód. MSC / ISO</th>
                      <th style={{ ...C.th, width: "28%" }}>Causa</th>
                      <th style={{ ...C.th }}>Resolución Sugerida</th>
                      <th style={{ ...C.th, width: 45 }}>Hrs</th>
                      <th style={C.th}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {entries.map(item => (
                      <tr key={item._id}>
                        <td style={{ ...C.td, fontFamily: "monospace", fontSize: 11, lineHeight: 1.6 }}>
                          <span style={{ color: "#1d4ed8", fontWeight: 700 }}>{item.codigoCausa || "—"}</span>
                          <br />
                          <span style={{ color: "#64748b", fontSize: 10 }}>{item.codigoModo || ""}</span>
                        </td>
                        <td style={{ ...C.td, fontSize: 13 }}>{item.causaProbable}</td>
                        <td style={{ ...C.td, color: item.resolucionSugerida ? "#475569" : "#cbd5e1", fontSize: 12 }}>
                          {item.resolucionSugerida || "— pendiente —"}
                        </td>
                        <td style={{ ...C.td, fontWeight: 600 }}>{item.tiempoEstimadoHrs || "—"}</td>
                        <td style={{ ...C.td, whiteSpace: "nowrap" as const }}>
                          <button style={{ ...C.btnSmall, marginRight: 6 }} onClick={() => openEdit(item)}>Editar</button>
                          <button style={C.btnRed} onClick={() => deleteItem(item)}>Eliminar</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))
        )}
    </div>
  );
}

// ─── Tab: Usuarios ─────────────────────────────────────────────────────────────
function UsuariosTab() {
  const [items, setItems] = useState<UsuarioItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editItem, setEditItem] = useState<UsuarioItem | null>(null);
  const [form, setForm] = useState<UsuarioForm>({
    nombre: "", email: "", password: "", rol: "4",
    jde: "", celular: "", puesto: "", superintendencia: "", areaTrabajo: "",
    areas: [], disciplina: "GENERAL",
    esContratista: false, fechaExpiracion: "",
  });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");
  const [areas, setAreas] = useState<AreaOption[]>([]);
  const formRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const [users, ar] = await Promise.all([
      fetch("/api/usuarios?all=true").then((r) => r.json()),
      fetch("/api/areas").then((r) => r.json()),
    ]);
    setItems(users); setAreas(ar); setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  function openAdd() {
    setEditItem(null);
    setForm({
      nombre: "", email: "", password: "", rol: "4",
      jde: "", celular: "", puesto: "", superintendencia: "", areaTrabajo: "",
      areas: [], disciplina: "GENERAL",
      esContratista: false, fechaExpiracion: "",
    });
    setErr("");
    setShowForm(true);
    setTimeout(() => formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
  }

  function openEdit(item: UsuarioItem) {
    setEditItem(item);
    setForm({
      nombre: item.nombre,
      email: item.email ?? "",
      password: "",
      rol: String(item.rol),
      jde: item.jde ?? "",
      celular: item.celular ?? "",
      puesto: item.puesto ?? "",
      superintendencia: item.superintendencia ?? "",
      areaTrabajo: item.areaTrabajo ?? "",
      areas: item.areas ?? [],
      disciplina: item.disciplina ?? "GENERAL",
      esContratista: item.esContratista ?? false,
      fechaExpiracion: item.fechaExpiracion ? item.fechaExpiracion.slice(0, 10) : "",
    });
    setErr("");
    setShowForm(true);
    setTimeout(() => formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
  }

  async function save() {
    if (!form.nombre.trim() || !form.rol) { setErr("Nómina y Rol son obligatorios"); return; }
    setSaving(true); setErr("");

    const url = editItem ? `/api/usuarios/${editItem._id}` : "/api/usuarios";
    const method = editItem ? "PUT" : "POST";

    // Si editamos y la contraseña está vacía, no la enviamos para no sobreescribirla en el backend
    const body = { ...form };
    if (editItem && (!body.password || !body.password.trim())) {
      delete body.password;
    }

    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    setSaving(false);
    if (!data.ok) { setErr(data.error ?? "Error al guardar"); return; }
    setShowForm(false);
    setForm({ nombre: "", email: "", password: "", rol: "4", jde: "", celular: "", puesto: "", superintendencia: "", areaTrabajo: "", areas: [], disciplina: "GENERAL", esContratista: false, fechaExpiracion: "" });
    load();
  }

  async function toggleActivo(item: UsuarioItem) {
    await fetch(`/api/usuarios/${item._id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ activo: !item.activo }) });
    load();
  }

  function toggleArea(codigo: string) {
    setForm((f) => ({ ...f, areas: f.areas.includes(codigo) ? f.areas.filter((a) => a !== codigo) : [...f.areas, codigo] }));
  }

  async function importarFilas(rows: Record<string, string>[]): Promise<{ ok: number; failed: string[] }> {
    let ok = 0; const failed: string[] = [];
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      // Accept "nomina" or "nómina" or "nombre" as key
      const nombre = (row.nomina ?? row["nómina"] ?? row.nombre ?? "").trim();
      if (!nombre) { failed.push(`Fila ${i + 2}: columna "nomina" vacía`); continue; }
      const rolVal = parseInt(row.rol ?? "4") || 4;
      if (![1, 2, 3, 4].includes(rolVal)) { failed.push(`Fila ${i + 2}: rol inválido "${row.rol}"`); continue; }
      const body: Record<string, unknown> = {
        nombre,
        rol: rolVal,
        areas: [],
      };
      const jdeRaw = (row.jde ?? "").trim();
      if (jdeRaw) body.jde = jdeRaw.replace(/\.0+$/, "");
      const area = (row.area ?? row["área"] ?? row.areaTrabajo ?? "").trim();
      if (area) body.areaTrabajo = area;
      if (row.celular?.trim()) body.celular = row.celular.trim();
      if (row.puesto?.trim()) body.puesto = row.puesto.trim();
      if (row.superintendencia?.trim()) body.superintendencia = row.superintendencia.trim();
      try {
        const r = await fetch("/api/usuarios", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
        const d = await r.json() as { ok: boolean; error?: string };
        if (d.ok) ok++; else failed.push(`${nombre}: ${d.error ?? "Error"}`);
      } catch { failed.push(`${nombre}: Error de conexión`); }
    }
    load(); return { ok, failed };
  }

  const upd = (k: keyof Omit<UsuarioForm, "areas">, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const USU_FIELDS: BulkField[] = [
    { key: "nomina", required: true },
    { key: "rol", required: true },
    { key: "area" },
    { key: "jde" },
    { key: "celular" },
    { key: "puesto" },
    { key: "superintendencia" },
  ];
  const USU_TEMPLATE = [
    { nomina: "Aduana Rocabado Oscar", area: "Molienda", jde: "63222", celular: "72459772", puesto: "Supervisor de Mantenimiento", superintendencia: "Sup. Mant. Mec. Plta. Chancado Molienda y Lubricacion", rol: "3" },
    { nomina: "Aguilar Mayta Justino Raul", area: "Electrico", jde: "62818", celular: "72058729", puesto: "Tecnico Electrico A", superintendencia: "Sup. Mant. Electrico e Instrumentacion Planta", rol: "4" },
    { nomina: "Capurata Flores Ovidio", area: "Superintendencia", jde: "62324", celular: "72475695", puesto: "Superintendente de Mantenimiento", superintendencia: "Sup. Mant. Electrico e Instrumentacion Planta", rol: "1" },
  ];

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 }}>
        <div>
          <h2 style={{ fontSize: 16, fontWeight: 700, color: "#0f2847", margin: 0 }}>Usuarios</h2>
          <p style={{ fontSize: 12, color: "#64748b", margin: "2px 0 0" }}>
            Personal con base en ListaGM · Columnas CSV: <code style={{ background: "#f1f5f9", padding: "0 4px", borderRadius: 3, fontFamily: "monospace" }}>nomina, rol, area, jde, celular, puesto, superintendencia</code>
          </p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button style={C.btnBlue} onClick={openAdd}>+ Agregar</button>
          <BulkImportPanel entityName="Usuarios" fileName="plantilla_usuarios.csv" fields={USU_FIELDS} templateRows={USU_TEMPLATE} onImport={importarFilas} />
        </div>
      </div>

      {showForm && (
        <div ref={formRef} style={C.formBox}>
          <h3 style={{ margin: "0 0 16px", fontSize: 14, fontWeight: 700, color: "#0f2847" }}>
            {editItem ? "Editar Usuario" : "Nuevo Usuario"}
          </h3>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "12px 16px" }}>
            <div style={{ gridColumn: "span 2" }}>
              <label style={C.label}>Nómina (nombre completo) *</label>
              <input style={C.input} value={form.nombre} onChange={(e) => upd("nombre", e.target.value)} placeholder="Apellido1 Apellido2 Nombre" />
            </div>
            <div>
              <label style={C.label}>Rol *</label>
              <select style={C.select} value={form.rol} onChange={(e) => {
                const v = e.target.value;
                setForm(f => ({ ...f, rol: v, esContratista: v === "6" ? true : f.esContratista }));
              }}>
                <option value="1">1 — Administrador</option>
                <option value="2">2 — Superintendente</option>
                <option value="3">3 — Supervisor</option>
                <option value="4">4 — Técnico</option>
                <option value="5">5 — Planificador</option>
                <option value="6">6 — Contratista</option>
              </select>
            </div>
            {/* ── Sección Contratista ── */}
            <div style={{ gridColumn: "span 2", display: "flex", gap: 16, alignItems: "flex-end" }}>
              <div style={{
                display: "flex", alignItems: "center", gap: 10,
                padding: "10px 14px", borderRadius: 8,
                background: form.esContratista ? "#fff7ed" : "#f8fafc",
                border: `1.5px solid ${form.esContratista ? "#fed7aa" : "#e2e8f0"}`,
                flex: 1,
              }}>
                <input
                  type="checkbox"
                  id="chk-contratista"
                  checked={form.esContratista}
                  onChange={(e) => setForm(f => ({
                    ...f,
                    esContratista: e.target.checked,
                    rol: e.target.checked && f.rol !== "6" ? "6" : f.rol,
                  }))}
                  style={{ width: 16, height: 16, cursor: "pointer" }}
                />
                <label htmlFor="chk-contratista" style={{ ...C.label, margin: 0, cursor: "pointer", color: form.esContratista ? "#c2410c" : "#475569" }}>
                  Es contratista (temporal)
                </label>
              </div>
              {form.esContratista && (
                <div style={{ flex: 1 }}>
                  <label style={C.label}>Fecha de expiración del acceso</label>
                  <input
                    type="date"
                    style={{ ...C.input, borderColor: form.fechaExpiracion && new Date(form.fechaExpiracion) < new Date() ? "#fca5a5" : "#cbd5e1" }}
                    value={form.fechaExpiracion}
                    onChange={(e) => upd("fechaExpiracion", e.target.value)}
                  />
                </div>
              )}
            </div>
            <div>
              <label style={C.label}>Disciplina *</label>
              <select style={C.select} value={form.disciplina} onChange={(e) => upd("disciplina", e.target.value)}>
                <option value="GENERAL">GENERAL — Mecánico</option>
                <option value="ELEC">ELEC — Eléctrico</option>
                <option value="INST">INST — Instrumentación</option>
                <option value="MEC">MEC — Mecánico especializado</option>
              </select>
            </div>
            <div>
              <label style={C.label}>Área de trabajo</label>
              <select style={C.select} value={form.areaTrabajo}
                onChange={(e) => {
                  const nombre = e.target.value;
                  const area = areas.find(a => a.nombre === nombre);
                  setForm(f => ({
                    ...f,
                    areaTrabajo: nombre,
                    areas: area && !f.areas.includes(area.codigo)
                      ? [...f.areas, area.codigo]
                      : f.areas,
                  }));
                }}>
                <option value="">— Seleccionar área —</option>
                {areas.map(a => (
                  <option key={a.codigo} value={a.nombre}>
                    {a.codigo} · {a.nombre}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label style={C.label}>JDE</label>
              <input style={C.input} value={form.jde} onChange={(e) => upd("jde", e.target.value)} placeholder="63222" />
            </div>
            <div>
              <label style={C.label}>Celular</label>
              <input style={C.input} value={form.celular} onChange={(e) => upd("celular", e.target.value)} placeholder="72459772" />
            </div>
            <div style={{ gridColumn: "span 3" }}>
              <label style={C.label}>Puesto</label>
              <input style={C.input} value={form.puesto} onChange={(e) => upd("puesto", e.target.value)} placeholder="Supervisor de Mantenimiento" />
            </div>
            <div style={{ gridColumn: "span 3" }}>
              <label style={C.label}>Superintendencia</label>
              <input style={C.input} value={form.superintendencia} onChange={(e) => upd("superintendencia", e.target.value)} placeholder="Superintendencia de Mantenimiento — …" />
            </div>
            <div style={{ gridColumn: "span 2" }}>
              <label style={C.label}>Email (opcional)</label>
              <input type="email" style={C.input} value={form.email} onChange={(e) => upd("email", e.target.value.toLowerCase())} placeholder="usuario@msc.com" />
            </div>
            <div>
              <label style={C.label}>{editItem ? "Contraseña (dejar en blanco para no cambiar)" : "Contraseña (opcional)"}</label>
              <input type="password" style={C.input} value={form.password} onChange={(e) => upd("password", e.target.value)} />
            </div>
            <div style={{ gridColumn: "span 3" }}>
              <label style={C.label}>Áreas de planta asignadas</label>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "8px 20px", marginTop: 6 }}>
                {areas.map((a) => (
                  <label key={a.codigo} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, cursor: "pointer" }}>
                    <input type="checkbox" checked={form.areas.includes(a.codigo)} onChange={() => toggleArea(a.codigo)} />
                    <span style={{ fontFamily: "monospace", fontWeight: 700, fontSize: 12 }}>{a.codigo}</span>
                    <span style={{ color: "#64748b" }}>{a.nombre}</span>
                  </label>
                ))}
              </div>
            </div>
          </div>
          <ErrMsg msg={err} />
          <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
            <button style={C.btnBlue} onClick={save} disabled={saving}>
              {saving ? (editItem ? "Guardando…" : "Creando…") : (editItem ? "Guardar" : "Crear usuario")}
            </button>
            <button style={C.btnOutline} onClick={() => setShowForm(false)}>Cancelar</button>
          </div>
        </div>
      )}

      {loading ? <p style={{ color: "#64748b", fontSize: 13 }}>Cargando…</p> : (
        <div style={C.card}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={C.th}>Nómina</th>
                <th style={C.th}>Área / Disciplina</th>
                <th style={C.th}>JDE</th>
                <th style={C.th}>Puesto</th>
                <th style={C.th}>Rol</th>
                <th style={C.th}>Estado</th>
                <th style={C.th}></th>
              </tr>
            </thead>
            <tbody>
              {items.length === 0 && (
                <tr><td colSpan={7} style={{ ...C.td, color: "#94a3b8", textAlign: "center", padding: 28 }}>
                  Sin usuarios. Use &quot;+ Agregar&quot; o &quot;↑ Carga Masiva&quot; con el CSV exportado de ListaGM.
                </td></tr>
              )}
              {items.map((item) => {
                const rc = ROL_CLR[item.rol] ?? ROL_CLR[4];
                return (
                  <tr key={item._id} style={{ opacity: item.activo ? 1 : 0.45 }}>
                    <td style={{ ...C.td, fontWeight: 600 }}>
                      {item.nombre}
                      {item.email && <div style={{ fontSize: 11, color: "#94a3b8", fontWeight: 400 }}>{item.email}</div>}
                    </td>
                    <td style={{ ...C.td, fontSize: 12 }}>
                      <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                        {/* Área de trabajo con código JDE si está vinculada */}
                        <span style={{ color: "#0f172a", fontWeight: 600 }}>
                          {item.areas?.length > 0
                            ? item.areas.map(cod => {
                                const a = areas.find(x => x.codigo === cod);
                                return a ? `${a.codigo} · ${a.nombre}` : cod;
                              }).join(", ")
                            : item.areaTrabajo || "—"}
                        </span>
                        {/* Badge disciplina */}
                        {item.disciplina && item.disciplina !== "GENERAL" && (
                          <span style={{
                            display: "inline-block", fontSize: 10, fontWeight: 700,
                            padding: "1px 7px", borderRadius: 4,
                            background: item.disciplina === "ELEC" ? "#fef3c7" : item.disciplina === "INST" ? "#ede9fe" : "#dbeafe",
                            color:      item.disciplina === "ELEC" ? "#92400e" : item.disciplina === "INST" ? "#5b21b6" : "#1d4ed8",
                          }}>
                            {item.disciplina}
                          </span>
                        )}
                      </div>
                    </td>
                    <td style={{ ...C.td, color: "#475569", fontSize: 12, fontFamily: "monospace" }}>{item.jde || "—"}</td>
                    <td style={{ ...C.td, color: "#475569", fontSize: 12, maxWidth: 220 }}>
                      <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={item.puesto}>{item.puesto || "—"}</div>
                      {item.superintendencia && <div style={{ fontSize: 11, color: "#94a3b8", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={item.superintendencia}>{item.superintendencia}</div>}
                    </td>
                    <td style={C.td}>
                      <Badge bg={rc.bg} color={rc.color}>{ROL_LABEL[item.rol] ?? item.rol}</Badge>
                      {item.esContratista && (() => {
                        const exp = item.fechaExpiracion ? new Date(item.fechaExpiracion) : null;
                        const vencido = exp && exp < new Date();
                        return (
                          <div style={{ marginTop: 4 }}>
                            <span style={{
                              display: "inline-block", padding: "1px 7px", borderRadius: 20,
                              fontSize: 10, fontWeight: 700,
                              background: vencido ? "#fee2e2" : "#fff7ed",
                              color: vencido ? "#dc2626" : "#c2410c",
                            }}>
                              {vencido ? "⚠ Expirado" : "Contratista"}
                            </span>
                            {exp && (
                              <div style={{ fontSize: 10, color: vencido ? "#dc2626" : "#94a3b8", marginTop: 1 }}>
                                {vencido ? "Venció " : "Hasta "}{exp.toLocaleDateString("es-BO")}
                              </div>
                            )}
                          </div>
                        );
                      })()}
                    </td>
                    <td style={C.td}><Badge bg={item.activo ? "#dcfce7" : "#f1f5f9"} color={item.activo ? "#16a34a" : "#94a3b8"}>{item.activo ? "Activo" : "Inactivo"}</Badge></td>
                    <td style={C.td}>
                      <button style={{ ...C.btnSmall, marginRight: 4 }} onClick={() => openEdit(item)}>Editar</button>
                      <button style={item.activo ? C.btnRed : C.btnGreen} onClick={() => toggleActivo(item)}>{item.activo ? "Desactivar" : "Activar"}</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─── Tab: Áreas ────────────────────────────────────────────────────────────────
function AreasTab() {
  const [items, setItems] = useState<AreaItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<AreaForm>({ codigo: "", nombre: "", superintendencia: "", tieneCalibracion: false });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    const data = await fetch("/api/areas?all=true").then((r) => r.json());
    setItems(data); setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  async function save() {
    if (!form.codigo || !form.nombre || !form.superintendencia) { setErr("Código, nombre y superintendencia son obligatorios"); return; }
    setSaving(true); setErr("");
    const res = await fetch("/api/areas", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
    const data = await res.json();
    setSaving(false);
    if (!data.ok) { setErr(data.error ?? "Error al guardar"); return; }
    setShowForm(false);
    setForm({ codigo: "", nombre: "", superintendencia: "", tieneCalibracion: false });
    load();
  }

  async function toggleActivo(item: AreaItem) {
    await fetch(`/api/areas/${item.codigo}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ activo: !item.activo }) });
    load();
  }

  async function eliminar(item: AreaItem) {
    if (!confirm(`¿Eliminar área ${item.codigo} — ${item.nombre}? Esta acción no se puede deshacer.`)) return;
    const res = await fetch(`/api/areas/${item.codigo}`, { method: "DELETE" });
    const data = await res.json();
    if (data.ok) { load(); return; }
    // Falló por FK — ofrecer eliminación forzada
    if (!confirm(`${data.error ?? "No se pudo eliminar"}\n\n¿Desea eliminar forzadamente? Todos los equipos/OTs serán reasignados al área "0000".`)) return;
    const forceRes = await fetch(`/api/areas/${item.codigo}?force=true`, { method: "DELETE" });
    const forceData = await forceRes.json();
    if (!forceData.ok) { alert(forceData.error ?? "No se pudo eliminar forzadamente."); return; }
    load();
  }

  async function importarFilas(rows: Record<string, string>[]): Promise<{ ok: number; failed: string[] }> {
    let ok = 0; const failed: string[] = [];
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const codigo = row.codigo?.trim();
      if (!codigo) { failed.push(`Fila ${i + 2}: campo "codigo" vacío`); continue; }
      const body = {
        codigo, nombre: row.nombre?.trim() ?? "",
        superintendencia: row.superintendencia?.trim() ?? "",
        tieneCalibracion: row.tieneCalibracion?.toLowerCase() === "true" || row.tieneCalibracion === "1",
      };
      try {
        const r = await fetch("/api/areas", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
        const d = await r.json() as { ok: boolean; error?: string };
        if (d.ok) ok++; else failed.push(`${codigo}: ${d.error ?? "Error"}`);
      } catch { failed.push(`${codigo}: Error de conexión`); }
    }
    load(); return { ok, failed };
  }

  const AREA_FIELDS: BulkField[] = [
    { key: "codigo", required: true }, { key: "nombre", required: true },
    { key: "superintendencia", required: true }, { key: "tieneCalibracion" },
  ];
  const AREA_TEMPLATE = [
    { codigo: "3322", nombre: "Mecánica Taller Central", superintendencia: "Mecánica", tieneCalibracion: "false" },
    { codigo: "3323", nombre: "Eléctrico Planta", superintendencia: "Electricidad", tieneCalibracion: "false" },
  ];

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 }}>
        <div>
          <h2 style={{ fontSize: 16, fontWeight: 700, color: "#0f2847", margin: 0 }}>Áreas</h2>
          <p style={{ fontSize: 12, color: "#64748b", margin: "2px 0 0" }}>
            Grupos de trabajo según JDE Edwards · <code style={{ background: "#f1f5f9", padding: "0 4px", borderRadius: 3, fontFamily: "monospace", fontSize: 11 }}>tieneCalibracion</code>: true/false
          </p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button style={C.btnBlue} onClick={() => { setErr(""); setShowForm((s) => !s); }}>+ Agregar</button>
          <BulkImportPanel entityName="Áreas" fileName="plantilla_areas.csv" fields={AREA_FIELDS} templateRows={AREA_TEMPLATE} onImport={importarFilas} />
        </div>
      </div>

      {showForm && (
        <div style={C.formBox}>
          <h3 style={{ margin: "0 0 16px", fontSize: 14, fontWeight: 700, color: "#0f2847" }}>Nueva Área</h3>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr 2fr", gap: "12px 16px", alignItems: "end" }}>
            <div><label style={C.label}>Código JDE *</label><input style={C.input} value={form.codigo} onChange={(e) => setForm((f) => ({ ...f, codigo: e.target.value }))} placeholder="Ej: 3322" /></div>
            <div><label style={C.label}>Nombre *</label><input style={C.input} value={form.nombre} onChange={(e) => setForm((f) => ({ ...f, nombre: e.target.value }))} placeholder="Ej: Mecánica Taller Central" /></div>
            <div><label style={C.label}>Superintendencia *</label><input style={C.input} value={form.superintendencia} onChange={(e) => setForm((f) => ({ ...f, superintendencia: e.target.value }))} placeholder="Ej: Mecánica" /></div>
            <div style={{ gridColumn: "span 3" }}>
              <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, cursor: "pointer" }}>
                <input type="checkbox" checked={form.tieneCalibracion} onChange={(e) => setForm((f) => ({ ...f, tieneCalibracion: e.target.checked }))} />
                Requiere Registro de Calibración (solo área 3320)
              </label>
            </div>
          </div>
          <ErrMsg msg={err} />
          <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
            <button style={C.btnBlue} onClick={save} disabled={saving}>{saving ? "Guardando…" : "Crear área"}</button>
            <button style={C.btnOutline} onClick={() => setShowForm(false)}>Cancelar</button>
          </div>
        </div>
      )}

      {loading ? <p style={{ color: "#64748b", fontSize: 13 }}>Cargando…</p> : (
        <div style={C.card}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={{ ...C.th, width: 80 }}>Código</th><th style={C.th}>Nombre</th>
                <th style={C.th}>Superintendencia</th><th style={{ ...C.th, width: 90 }}>Calibración</th>
                <th style={{ ...C.th, width: 80 }}>Estado</th><th style={{ ...C.th, width: 90 }}></th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item._id} style={{ opacity: item.activo ? 1 : 0.45 }}>
                  <td style={{ ...C.td, fontWeight: 700, fontFamily: "monospace" }}>{item.codigo}</td>
                  <td style={C.td}>{item.nombre}</td>
                  <td style={{ ...C.td, color: "#475569" }}>{item.superintendencia}</td>
                  <td style={C.td}>{item.tieneCalibracion ? <Badge bg="#dbeafe" color="#1d4ed8">Sí</Badge> : <span style={{ color: "#cbd5e1" }}>—</span>}</td>
                  <td style={C.td}><Badge bg={item.activo ? "#dcfce7" : "#f1f5f9"} color={item.activo ? "#16a34a" : "#94a3b8"}>{item.activo ? "Activo" : "Inactivo"}</Badge></td>
                  <td style={C.td}><div style={{ display: "flex", gap: 4 }}><button style={item.activo ? C.btnRed : C.btnGreen} onClick={() => toggleActivo(item)}>{item.activo ? "Desactivar" : "Activar"}</button><button style={{ ...C.btnRed, background: "#991b1b" }} onClick={() => eliminar(item)}>Eliminar</button></div></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─── Tab: Checklist Mantto ────────────────────────────────────────────────────
type SentidoInspeccion = "Visual" | "Auditivo" | "Tactil" | "Olfativo" | "Instrumental";
type ChecklistItem = { descripcion: string; orden: number; sentido: SentidoInspeccion };
type ChecklistDoc = {
  _id: string; codigo: string; areaCodigo: string; nombre: string;
  disciplina: string; nivelTag: number | null; areaProceso: string;
  categoriaISO: string | null; items: ChecklistItem[]; activo: boolean;
};
type ChecklistForm = {
  codigo: string; areaCodigo: string; nombre: string;
  disciplina: string; nivelTag: string; areaProceso: string;
  categoriaISO: string; items: ChecklistItem[];
};

const DISC_OPTS = ["Mecanico", "Electrico", "Instrumentacion", "Universal"];
const AREA_PROC_OPTS = ["general", "chancado", "molienda", "flotacion", "filtros", "aguas"];
const DISC_COLOR: Record<string, string> = {
  Mecanico: "#0891b2", Electrico: "#f59e0b", Instrumentacion: "#7c3aed", Universal: "#64748b",
};

const SENTIDOS: { value: SentidoInspeccion; emoji: string; label: string; color: string }[] = [
  { value: "Visual",        emoji: "👁️",  label: "Visual",        color: "#2563eb" },
  { value: "Auditivo",      emoji: "👂",  label: "Auditivo",      color: "#0891b2" },
  { value: "Tactil",        emoji: "✋",  label: "Táctil",        color: "#d97706" },
  { value: "Olfativo",      emoji: "👃",  label: "Olfativo",      color: "#7c3aed" },
  { value: "Instrumental",  emoji: "📏",  label: "Instrumental",  color: "#16a34a" },
];
const sentidoMeta = (s: string) => SENTIDOS.find(x => x.value === s) ?? SENTIDOS[0];

function emptyForm(): ChecklistForm {
  return { codigo: "", areaCodigo: "*", nombre: "", disciplina: "Mecanico", nivelTag: "5", areaProceso: "general", categoriaISO: "", items: [] };
}

function buildCsv(docs: ChecklistDoc[]): string {
  const header = "codigo,nombre,disciplina,nivelTag,areaProceso,categoriaISO,areaCodigo,item_orden,item_sentido,item_descripcion";
  const rows: string[] = [header];
  for (const d of docs) {
    if (d.items.length === 0) {
      rows.push([d.codigo, d.nombre, d.disciplina, d.nivelTag ?? "", d.areaProceso, d.categoriaISO ?? "", d.areaCodigo, "", "", ""].map(csvCell).join(","));
    } else {
      for (const it of d.items) {
        rows.push([d.codigo, d.nombre, d.disciplina, d.nivelTag ?? "", d.areaProceso, d.categoriaISO ?? "", d.areaCodigo, it.orden, it.sentido ?? "Visual", it.descripcion].map(csvCell).join(","));
      }
    }
  }
  return rows.join("\r\n");
}

function csvCell(v: unknown): string {
  const s = String(v ?? "");
  return s.includes(",") || s.includes('"') || s.includes("\n") ? `"${s.replace(/"/g, '""')}"` : s;
}

function ChecklistTab() {
  const [items, setItems] = useState<ChecklistDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [areas, setAreas] = useState<AreaOption[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [editDoc, setEditDoc] = useState<ChecklistDoc | null>(null);
  const [form, setForm] = useState<ChecklistForm>(emptyForm());
  const [itemInput, setItemInput] = useState("");
  const [itemSentido, setItemSentido] = useState<SentidoInspeccion>("Visual");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");
  const [importing, setImporting] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const [cl, ar] = await Promise.all([
      fetch("/api/checklist-mantto?all=true").then((r) => r.json()),
      fetch("/api/areas").then((r) => r.json()),
    ]);
    setItems(Array.isArray(cl) ? cl : []); setAreas(Array.isArray(ar) ? ar : []); setLoading(false);
  }, []);

  useEffect(() => {
    // Siembra silenciosa al abrir el tab: actualiza sentidos sin borrar checklists custom
    fetch("/api/seed/checklists", { method: "POST" })
      .catch(() => {})
      .finally(() => load());
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function openAdd() {
    setEditDoc(null); setForm(emptyForm());
    setItemInput(""); setItemSentido("Visual"); setErr(""); setShowForm(true);
  }

  function openEdit(doc: ChecklistDoc) {
    setEditDoc(doc);
    setForm({
      codigo: doc.codigo ?? "",
      areaCodigo: doc.areaCodigo,
      nombre: doc.nombre,
      disciplina: doc.disciplina,
      nivelTag: doc.nivelTag != null ? String(doc.nivelTag) : "",
      areaProceso: doc.areaProceso,
      categoriaISO: doc.categoriaISO ?? "",
      items: [...doc.items],
    });
    setItemInput(""); setItemSentido("Visual"); setErr(""); setShowForm(true);
  }

  function addItem() {
    const desc = itemInput.trim();
    if (!desc) return;
    setForm((f) => ({ ...f, items: [...f.items, { descripcion: desc, orden: f.items.length, sentido: itemSentido }] }));
    setItemInput("");
  }

  function removeItem(idx: number) {
    setForm((f) => ({ ...f, items: f.items.filter((_, i) => i !== idx).map((it, i) => ({ ...it, orden: i })) }));
  }

  function moveItem(idx: number, dir: -1 | 1) {
    const next = [...form.items];
    const swap = idx + dir;
    if (swap < 0 || swap >= next.length) return;
    [next[idx], next[swap]] = [next[swap], next[idx]];
    setForm((f) => ({ ...f, items: next.map((it, i) => ({ ...it, orden: i })) }));
  }

  async function save() {
    if (!form.nombre || !form.disciplina) { setErr("Nombre y disciplina son obligatorios"); return; }
    setSaving(true); setErr("");
    const payload = {
      ...form,
      nivelTag: form.nivelTag ? Number(form.nivelTag) : null,
      categoriaISO: form.categoriaISO || null,
      codigo: form.codigo.toUpperCase(),
    };
    const url = editDoc ? `/api/checklist-mantto/${editDoc._id}` : "/api/checklist-mantto";
    const res = await fetch(url, {
      method: editDoc ? "PUT" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    setSaving(false);
    if (!data.ok) { setErr(data.error ?? "Error al guardar"); return; }
    setShowForm(false); load();
  }

  async function toggleActivo(doc: ChecklistDoc) {
    await fetch(`/api/checklist-mantto/${doc._id}`, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ activo: !doc.activo }),
    });
    load();
  }

  function exportCsv() {
    const csv = buildCsv(items);
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `checklists_sync_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
  }

  async function importCsv(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setImporting(true);
    const text = await file.text();
    const res = await fetch("/api/checklist-mantto/import", {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: text,
    });
    const data = await res.json();
    setImporting(false);
    if (fileRef.current) fileRef.current.value = "";
    if (data.ok) {
      alert(`Importación exitosa:\n${data.checklists} checklists · ${data.inserted} nuevos · ${data.modified} actualizados`);
      load();
    } else {
      alert("Error al importar: " + (data.error ?? "desconocido"));
    }
  }

  const grouped: Record<string, ChecklistDoc[]> = {};
  for (const d of items) {
    const key = d.disciplina ?? "Sin disciplina";
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(d);
  }

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 }}>
        <div>
          <h2 style={{ fontSize: 16, fontWeight: 700, color: "#0f2847", margin: 0 }}>Checklist Mantto</h2>
          <p style={{ fontSize: 12, color: "#64748b", margin: "2px 0 0" }}>
            Formularios de inspección ISO 14224 · Se asignan automáticamente al registrar OT de tipo PMP / PMT / CMP
          </p>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
          <button
            onClick={async () => {
              const j = await fetch("/api/seed/checklists", { method: "POST" }).then(r => r.json());
              if (!j.ok) { alert(`Error: ${j.error ?? "desconocido"}`); return; }
              const detalle = Array.isArray(j.resumen) && j.resumen.length > 0 ? `\n\n${(j.resumen as string[]).join("\n")}` : "";
              alert(`Sembrados: ${j.creados} nuevos · ${j.actualizados ?? 0} actualizados${detalle}`);
              load();
            }}
            style={{ ...C.btnOutline, fontSize: 12 }}>
            Sembrar ISO base
          </button>
          <button style={{ ...C.btnOutline, fontSize: 12 }} onClick={exportCsv} disabled={items.length === 0}>
            ↓ Exportar CSV
          </button>
          <label style={{ ...C.btnOutline, fontSize: 12, cursor: "pointer", margin: 0 }}>
            {importing ? "Importando…" : "↑ Importar CSV"}
            <input ref={fileRef} type="file" accept=".csv,text/csv" style={{ display: "none" }} onChange={importCsv} />
          </label>
          <button style={C.btnBlue} onClick={openAdd}>+ Nuevo</button>
        </div>
      </div>

      {/* Leyenda de códigos */}
      <div style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 8, padding: "10px 14px", marginBottom: 16, fontSize: 12, color: "#475569" }}>
        <strong style={{ color: "#0f2847" }}>Convención de código:</strong>{" "}
        <code style={{ background: "#e2e8f0", borderRadius: 4, padding: "1px 6px" }}>DISC-CATEGORIA-AREA</code>
        {" · "}
        Ejemplos:{" "}
        <code style={{ background: "#dbeafe", borderRadius: 4, padding: "1px 6px" }}>ELE-MOTORES-GEN</code>{" "}
        <code style={{ background: "#fef3c7", borderRadius: 4, padding: "1px 6px" }}>MEC-BOMBAS-MOL</code>{" "}
        <code style={{ background: "#ede9fe", borderRadius: 4, padding: "1px 6px" }}>INS-SENSORES-GEN</code>
      </div>

      {showForm && (
        <div style={C.formBox}>
          <h3 style={{ margin: "0 0 16px", fontSize: 14, fontWeight: 700, color: "#0f2847" }}>
            {editDoc ? "Editar Checklist" : "Nuevo Checklist"}
          </h3>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "12px 16px", marginBottom: 12 }}>
            <div>
              <label style={C.label}>Código <span style={{ color: "#94a3b8" }}>(ej: ELE-MOTORES-GEN)</span></label>
              <input style={{ ...C.input, textTransform: "uppercase" }} value={form.codigo}
                onChange={(e) => setForm((f) => ({ ...f, codigo: e.target.value.toUpperCase() }))}
                placeholder="ELE-MOTORES-GEN" />
            </div>
            <div>
              <label style={C.label}>Disciplina *</label>
              <select style={C.select} value={form.disciplina} onChange={(e) => setForm((f) => ({ ...f, disciplina: e.target.value }))}>
                {DISC_OPTS.map(d => <option key={d} value={d}>{d}</option>)}
              </select>
            </div>
            <div>
              <label style={C.label}>Área de proceso</label>
              <select style={C.select} value={form.areaProceso} onChange={(e) => setForm((f) => ({ ...f, areaProceso: e.target.value }))}>
                {AREA_PROC_OPTS.map(a => <option key={a} value={a}>{a}</option>)}
              </select>
            </div>
            <div>
              <label style={C.label}>Categoría ISO</label>
              <input style={C.input} value={form.categoriaISO}
                onChange={(e) => setForm((f) => ({ ...f, categoriaISO: e.target.value.toUpperCase() }))}
                placeholder="MOTORES / BOMBAS / …" />
            </div>
            <div>
              <label style={C.label}>Nivel TAG <span style={{ color: "#94a3b8" }}>(5, 7 o vacío)</span></label>
              <input style={C.input} value={form.nivelTag} type="number" min={1} max={8}
                onChange={(e) => setForm((f) => ({ ...f, nivelTag: e.target.value }))}
                placeholder="5" />
            </div>
            <div>
              <label style={C.label}>Área JDE <span style={{ color: "#94a3b8" }}>(* = todas)</span></label>
              <input style={C.input} value={form.areaCodigo}
                onChange={(e) => setForm((f) => ({ ...f, areaCodigo: e.target.value }))}
                placeholder="* o 3210" />
            </div>
          </div>
          <div style={{ marginBottom: 12 }}>
            <label style={C.label}>Nombre del checklist *</label>
            <input style={C.input} value={form.nombre}
              onChange={(e) => setForm((f) => ({ ...f, nombre: e.target.value }))}
              placeholder="Ej: Inspección Eléctrica — Motores" />
          </div>

          <label style={C.label}>Ítems del checklist ({form.items.length})</label>
          <div style={{ marginBottom: 10, maxHeight: 300, overflowY: "auto" }}>
            {form.items.map((it, i) => {
              const meta = sentidoMeta(it.sentido);
              return (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 5 }}>
                  <span style={{ width: 20, textAlign: "right", fontSize: 12, color: "#94a3b8", flexShrink: 0 }}>{i + 1}.</span>
                  <select value={it.sentido}
                    onChange={e => setForm(f => ({ ...f, items: f.items.map((x, j) => j === i ? { ...x, sentido: e.target.value as SentidoInspeccion } : x) }))}
                    style={{ border: `1.5px solid ${meta.color}40`, background: meta.color + "12", color: meta.color, borderRadius: 6, fontSize: 13, padding: "3px 4px", cursor: "pointer", flexShrink: 0 }}>
                    {SENTIDOS.map(s => <option key={s.value} value={s.value}>{s.emoji} {s.label}</option>)}
                  </select>
                  <span style={{ flex: 1, fontSize: 13, background: "#f1f5f9", borderRadius: 6, padding: "5px 10px", color: "#1e293b" }}>
                    {it.descripcion}
                  </span>
                  <button type="button" onClick={() => moveItem(i, -1)} style={{ ...C.btnSmall, padding: "2px 7px" }} disabled={i === 0}>▲</button>
                  <button type="button" onClick={() => moveItem(i, 1)} style={{ ...C.btnSmall, padding: "2px 7px" }} disabled={i === form.items.length - 1}>▼</button>
                  <button type="button" onClick={() => removeItem(i)} style={{ ...C.btnRed, padding: "3px 8px" }}>✕</button>
                </div>
              );
            })}
            {form.items.length === 0 && (
              <p style={{ fontSize: 12, color: "#94a3b8", fontStyle: "italic", marginBottom: 8 }}>Sin ítems. Seleccione el sentido y escriba abajo.</p>
            )}
          </div>
          {/* Selector de sentido + input */}
          <div style={{ display: "flex", gap: 6, marginBottom: 6 }}>
            {SENTIDOS.map(s => (
              <button key={s.value} type="button" onClick={() => setItemSentido(s.value)}
                title={s.label}
                style={{ padding: "5px 10px", borderRadius: 7, border: `2px solid ${itemSentido === s.value ? s.color : "#e2e8f0"}`, background: itemSentido === s.value ? s.color + "18" : "white", fontSize: 16, cursor: "pointer", transition: "all .15s" }}>
                {s.emoji}
              </button>
            ))}
            <span style={{ fontSize: 12, color: "#64748b", alignSelf: "center", marginLeft: 4 }}>
              {sentidoMeta(itemSentido).label}
            </span>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <input style={{ ...C.input, flex: 1 }} value={itemInput}
              onChange={(e) => setItemInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addItem(); } }}
              placeholder="Descripción del ítem · Enter para agregar" />
            <button type="button" onClick={addItem} style={C.btnOutline}>+ Agregar</button>
          </div>

          <ErrMsg msg={err} />
          <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
            <button style={C.btnBlue} onClick={save} disabled={saving}>{saving ? "Guardando…" : "Guardar"}</button>
            <button style={C.btnOutline} onClick={() => setShowForm(false)}>Cancelar</button>
          </div>
        </div>
      )}

      {loading ? <p style={{ fontSize: 13, color: "#64748b" }}>Cargando…</p>
        : items.length === 0 ? (
          <div style={{ ...C.card, padding: 28, textAlign: "center" as const, color: "#94a3b8", fontSize: 13 }}>
            Sin checklists. Use &quot;Sembrar ISO base&quot; para cargar las plantillas iniciales o &quot;+ Nuevo&quot; para crear uno.
          </div>
        ) : (
          Object.entries(grouped).sort(([a], [b]) => a.localeCompare(b)).map(([disc, docs]) => (
            <div key={disc} style={{ marginBottom: 20 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 0", borderBottom: "2px solid #e2e8f0", marginBottom: 8 }}>
                <span style={{ fontSize: 11, fontWeight: 700, background: (DISC_COLOR[disc] ?? "#64748b") + "18", color: DISC_COLOR[disc] ?? "#64748b", border: `1px solid ${(DISC_COLOR[disc] ?? "#64748b")}30`, borderRadius: 4, padding: "2px 8px" }}>{disc.toUpperCase()}</span>
                <span style={{ fontSize: 13, fontWeight: 700, color: "#0f2847" }}>{docs.length} checklist{docs.length !== 1 ? "s" : ""}</span>
              </div>
              <div style={C.card}>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead>
                    <tr>
                      <th style={C.th}>Código</th>
                      <th style={C.th}>Nombre</th>
                      <th style={{ ...C.th, width: 100 }}>ISO / Área</th>
                      <th style={{ ...C.th, width: 50 }}>Nv</th>
                      <th style={{ ...C.th, width: 50 }}>Ítems</th>
                      <th style={{ ...C.th, width: 80 }}>Estado</th>
                      <th style={{ ...C.th, width: 120 }}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {docs.map((doc) => (
                      <tr key={doc._id} style={{ opacity: doc.activo ? 1 : 0.45 }}>
                        <td style={C.td}>
                          <code style={{ fontSize: 11, background: "#f1f5f9", borderRadius: 4, padding: "2px 6px", color: "#0f2847" }}>
                            {doc.codigo || "—"}
                          </code>
                        </td>
                        <td style={C.td}>{doc.nombre}</td>
                        <td style={{ ...C.td, fontSize: 11, color: "#475569" }}>
                          {doc.categoriaISO && <div style={{ fontWeight: 600 }}>{doc.categoriaISO}</div>}
                          <div style={{ color: "#94a3b8" }}>{doc.areaProceso}</div>
                        </td>
                        <td style={{ ...C.td, textAlign: "center" as const, color: "#64748b" }}>{doc.nivelTag ?? "—"}</td>
                        <td style={{ ...C.td, textAlign: "center" as const, fontWeight: 700 }}>{doc.items.length}</td>
                        <td style={C.td}>
                          <Badge bg={doc.activo ? "#dcfce7" : "#f1f5f9"} color={doc.activo ? "#16a34a" : "#94a3b8"}>
                            {doc.activo ? "Activo" : "Inactivo"}
                          </Badge>
                        </td>
                        <td style={{ ...C.td, whiteSpace: "nowrap" as const }}>
                          <button style={{ ...C.btnSmall, marginRight: 6 }} onClick={() => openEdit(doc)}>Editar</button>
                          <button style={doc.activo ? C.btnRed : C.btnGreen} onClick={() => toggleActivo(doc)}>
                            {doc.activo ? "Desactivar" : "Activar"}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))
        )}
    </div>
  );
}

// ─── Main page ─────────────────────────────────────────────────────────────────
export default function ConfiguracionPage() {
  const [tab, setTab] = useState<Tab>("equipos");
  const { user, loading } = useUser();
  const router = useRouter();

  useEffect(() => {
    if (!loading && (!user || user.rol !== 1)) {
      router.replace("/ordenes");
    }
  }, [user, loading, router]);

  if (loading) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#f1f5f9" }}>
        <p style={{ color: "#64748b", fontSize: 13, fontFamily: "Arial, sans-serif" }}>Verificando credenciales...</p>
      </div>
    );
  }

  if (!user || user.rol !== 1) {
    return null;
  }

  const TABS: { id: Tab; label: string }[] = [
    { id: "equipos", label: "Equipos / TAGs" },
    { id: "arbol", label: "Árbol de Fallas" },
    { id: "usuarios", label: "Usuarios" },
    { id: "areas", label: "Áreas" },
    { id: "checklist", label: "Checklist Mantto" },
  ];

  return (
    <div style={{ minHeight: "100vh", background: "#f1f5f9" }}>
      <AppHeader backHref="/ordenes" />
      <main style={{ maxWidth: 1100, margin: "0 auto", padding: "24px 20px" }}>

        <div style={{ marginBottom: 20 }}>
          <h1 style={{ fontSize: 20, fontWeight: 800, color: "#0f2847", margin: 0 }}>
            Configuración — Datos Maestros
          </h1>
          <p style={{ fontSize: 13, color: "#64748b", margin: "4px 0 0" }}>
            Gestión de equipos, árbol de fallas, personal y áreas ·{" "}
            <a href="/api/seed" target="_blank" style={{ color: "#0f2847", fontWeight: 600 }}>
              /api/seed
            </a>{" "}
            para cargar datos de ejemplo
          </p>
        </div>

        {/* Tab bar */}
        <div style={{ display: "flex", borderBottom: "2px solid #e2e8f0", marginBottom: 24 }}>
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              style={{
                padding: "10px 20px", border: "none", background: "none", cursor: "pointer",
                fontSize: 14, fontWeight: tab === t.id ? 700 : 500,
                color: tab === t.id ? "#0f2847" : "#64748b",
                borderBottom: tab === t.id ? "2px solid #0f2847" : "2px solid transparent",
                marginBottom: -2, transition: "color 0.15s",
              }}
            >
              {t.label}
            </button>
          ))}
        </div>

        {tab === "equipos" && <EquiposTab />}
        {tab === "arbol" && <ArbolTab />}
        {tab === "usuarios" && <UsuariosTab />}
        {tab === "areas" && <AreasTab />}
        {tab === "checklist" && <ChecklistTab />}
      </main>
    </div>
  );
}
