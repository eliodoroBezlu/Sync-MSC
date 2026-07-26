import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

type Ctx = { params: Promise<{ id: string }> };

// Agrega un contratista (Usuario existente, rol Contratista) al roster de la
// semana con asistencia "T" los 7 días — a diferencia del personal de planta
// (que entra por Excel con su horario real de turnos), un contratista se
// considera disponible toda la semana desde que se lo agrega. Ver
// PATCH/DELETE en roster/[rosterId]/route.ts para editar o quitar.
export async function POST(req: NextRequest, { params }: Ctx) {
  try {
    const { id } = await params;
    const body = await req.json();
    const usuarioId = String(body.usuarioId ?? "");
    if (!usuarioId) {
      return NextResponse.json({ ok: false, error: "usuarioId requerido" }, { status: 400 });
    }

    const plan = await prisma.planBorrador.findUnique({ where: { id } });
    if (!plan) return NextResponse.json({ ok: false, error: "Plan no encontrado" }, { status: 404 });
    if (plan.estado === "publicado") {
      return NextResponse.json({ ok: false, error: "No se puede editar un plan publicado" }, { status: 400 });
    }

    const usuario = await prisma.usuario.findUnique({ where: { id: usuarioId } });
    if (!usuario) return NextResponse.json({ ok: false, error: "Usuario no encontrado" }, { status: 404 });

    const nombre = usuario.apellido ? `${usuario.nombre} ${usuario.apellido}` : usuario.nombre;

    const yaExiste = await prisma.rosterSemanal.findFirst({
      where: { planBorradorId: id, OR: [{ usuarioId }, { nombre }] },
    });
    if (yaExiste) {
      return NextResponse.json({ ok: false, error: `${nombre} ya está en el roster de esta semana` }, { status: 400 });
    }

    const roster = await prisma.rosterSemanal.create({
      data: {
        planBorradorId: id,
        nombre,
        usuarioId,
        disciplina: usuario.disciplina,
        grupo: "Diurno",
        esContratista: usuario.esContratista,
        asistencia: ["T", "T", "T", "T", "T", "T", "T"],
      },
    });

    return NextResponse.json({ ok: true, roster });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Error agregando al roster";
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}
