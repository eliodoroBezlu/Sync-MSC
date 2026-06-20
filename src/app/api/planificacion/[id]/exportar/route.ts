import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";
import * as XLSX from "xlsx";

type Ctx = { params: Promise<{ id: string }> };

function lunesDeSemana(semana: number, anio: number): Date {
  const jan4 = new Date(anio, 0, 4);
  const lunes = new Date(jan4);
  const dow = jan4.getDay() || 7;
  lunes.setDate(jan4.getDate() - dow + 1 + (semana - 1) * 7);
  return lunes;
}

function formatFecha(d: Date): string {
  return `${d.getDate().toString().padStart(2, "0")}/${(d.getMonth() + 1).toString().padStart(2, "0")}/${d.getFullYear()}`;
}

function escapeCSV(v: unknown): string {
  const s = String(v ?? "");
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export async function GET(req: NextRequest, { params }: Ctx) {
  const { id } = await params;
  const { searchParams } = new URL(req.url);
  const formato = searchParams.get("formato") || "excel";

  const plan = await prisma.planBorrador.findUnique({
    where: { id },
    include: { ots: { orderBy: { control: "asc" } }, roster: { orderBy: { nombre: "asc" } } },
  });

  if (!plan) return NextResponse.json({ error: "Plan no encontrado" }, { status: 404 });

  const lunes = lunesDeSemana(plan.semana, plan.anio);

  if (formato === "excel") {
    // ─── Excel Workbook ───────────────────────────────────────────────────────
    const wb = XLSX.utils.book_new();

    // Sheet 1: OTs
    const otsData = plan.ots.map(o => ({
      Control: o.control,
      "OT #": o.numeroOT,
      Descripción: o.descripcion,
      TAG: o.tag,
      Tipo: o.tipoOT,
      Prioridad: o.prioridad || "-",
      Personas: o.personas,
      "Hrs/día": o.hrsTrabajo,
      "HH Total": o.hhTotal,
      Grupo: o.grupo,
      Días: (o.dias as string[]).join(", "),
      Personal: (o.personalAsignado as string[]).join(", ") || "Sin asignar",
    }));
    const wsOts = XLSX.utils.json_to_sheet(otsData);
    wsOts["!cols"] = [
      { wch: 6 }, { wch: 12 }, { wch: 30 }, { wch: 14 },
      { wch: 10 }, { wch: 10 }, { wch: 8 }, { wch: 8 },
      { wch: 10 }, { wch: 10 }, { wch: 15 }, { wch: 25 },
    ];
    XLSX.utils.book_append_sheet(wb, wsOts, "OTs");

    // Sheet 2: Roster
    const rosterData = plan.roster.map(r => ({
      Nombre: r.nombre,
      Grupo: r.grupo,
      Disciplina: r.disciplina,
      D1: (r.asistencia as string[])[0] || "",
      D2: (r.asistencia as string[])[1] || "",
      D3: (r.asistencia as string[])[2] || "",
      D4: (r.asistencia as string[])[3] || "",
      D5: (r.asistencia as string[])[4] || "",
      D6: (r.asistencia as string[])[5] || "",
      D7: (r.asistencia as string[])[6] || "",
    }));
    const wsRoster = XLSX.utils.json_to_sheet(rosterData);
    wsRoster["!cols"] = [{ wch: 20 }, { wch: 12 }, { wch: 12 }, ...Array(7).fill({ wch: 5 })];
    XLSX.utils.book_append_sheet(wb, wsRoster, "Roster");

    // Sheet 3: Resumen
    const totalHH = plan.ots.reduce((s, o) => s + o.hhTotal, 0);
    const resumenData = [
      ["PLANIFICACIÓN SEMANAL"],
      [],
      ["Semana:", plan.semana],
      ["Año:", plan.anio],
      ["Disciplina:", plan.disciplina],
      ["Inicio:", formatFecha(lunes)],
      [],
      ["OTs:", plan.ots.length],
      ["HH Totales:", totalHH.toFixed(0)],
      ["Técnicos:", plan.roster.length],
      [],
      ["Estado:", plan.estado],
      ["Creado por:", plan.creadoPor],
    ];
    const wsResumen = XLSX.utils.aoa_to_sheet(resumenData);
    XLSX.utils.book_append_sheet(wb, wsResumen, "Resumen");

    const buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
    return new NextResponse(buffer, {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="Plan_Sem${plan.semana}_${plan.anio}_${plan.disciplina}.xlsx"`,
      },
    });
  } else if (formato === "json") {
    // ─── JSON ──────────────────────────────────────────────────────────────────
    const datos = {
      plan: {
        semana: plan.semana,
        anio: plan.anio,
        disciplina: plan.disciplina,
        areaCodigo: plan.areaCodigo,
        estado: plan.estado,
        creadoPor: plan.creadoPor,
        createdAt: plan.createdAt,
      },
      ots: plan.ots,
      roster: plan.roster,
    };
    return NextResponse.json(datos);
  } else if (formato === "ical") {
    // ─── iCalendar ────────────────────────────────────────────────────────────
    const DIA_OFFSET: Record<string, number> = {
      Lu: 0, Ma: 1, Mi: 2, Ju: 3, Vi: 4, Sa: 5, Do: 6,
    };

    let ical = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Sync-MSC//Planificación Semanal//ES
CALSCALE:GREGORIAN
METHOD:PUBLISH
X-WR-CALNAME:Plan Semana ${plan.semana} ${plan.anio}
X-WR-CALDESC:Programa semanal de mantenimiento - ${plan.disciplina}
`;

    for (const ot of plan.ots) {
      for (const dia of ot.dias as string[]) {
        const offset = DIA_OFFSET[dia] ?? 0;
        const fecha = new Date(lunes);
        fecha.setDate(lunes.getDate() + offset);

        const dtstart = fecha.toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";
        const dtend = new Date(fecha.getTime() + ot.hrsTrabajo * 3600000)
          .toISOString()
          .replace(/[-:]/g, "")
          .split(".")[0] + "Z";

        ical += `BEGIN:VEVENT
UID:${ot.id}-${dia}@sync-msc
DTSTART:${dtstart}
DTEND:${dtend}
SUMMARY:${ot.numeroOT} - ${ot.descripcion.slice(0, 50)}
DESCRIPTION:TAG: ${ot.tag}\\nPersonas: ${ot.personas}\\nGrupo: ${ot.grupo}\\nPersonal: ${(ot.personalAsignado as string[]).join(", ") || "Por asignar"}
LOCATION:${ot.tag}
PRIORITY:${ot.prioridad === "1P" ? 1 : ot.prioridad === "2P" ? 2 : 5}
END:VEVENT
`;
      }
    }

    ical += `END:VCALENDAR`;

    return new NextResponse(ical, {
      headers: {
        "Content-Type": "text/calendar; charset=utf-8",
        "Content-Disposition": `attachment; filename="Plan_Sem${plan.semana}_${plan.anio}.ics"`,
      },
    });
  } else {
    return NextResponse.json({ error: "Formato no soportado" }, { status: 400 });
  }
}
