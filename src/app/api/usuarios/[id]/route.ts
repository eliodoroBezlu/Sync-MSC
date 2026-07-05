import { prisma } from "@/lib/prisma";
import { NextRequest } from "next/server";
import crypto from "crypto";

type Ctx = { params: Promise<{ id: string }> };

export async function PUT(req: NextRequest, { params }: Ctx) {
  const { id } = await params;
  try {
    const body = await req.json();
    
    // Hash password if provided
    let passwordHash: string | undefined;
    if (body.password && typeof body.password === "string" && body.password.trim() !== "") {
      passwordHash = crypto.createHash("sha256")
        .update(body.password + "syncmsc-salt-v1").digest("hex");
    }

    // Clean up raw password fields
    delete body.password;
    delete body.passwordHash;

    const { areas, ...rest } = body;
    const rol = body.rol !== undefined ? Number(body.rol) : undefined;
    delete rest.rol;

    // Parse fechaExpiracion if present
    if (rest.fechaExpiracion !== undefined) {
      rest.fechaExpiracion = rest.fechaExpiracion ? new Date(rest.fechaExpiracion) : null;
    }

    await prisma.usuario.update({
      where: { id },
      data: {
        ...rest,
        ...(rol !== undefined ? { rol } : {}),
        ...(passwordHash ? { passwordHash } : {}),
        ...(areas !== undefined ? {
          areas: {
            deleteMany: {},
            create: areas.map((codigo: string) => ({ areaCodigo: codigo })),
          },
        } : {}),
      },
    });

    return Response.json({ ok: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Error interno";
    return Response.json({ ok: false, error: message }, { status: 400 });
  }
}

export async function DELETE(_req: NextRequest, { params }: Ctx) {
  const { id } = await params;
  try {
    await prisma.usuario.delete({ where: { id } });
    return Response.json({ ok: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Error interno";
    return Response.json({ ok: false, error: message }, { status: 400 });
  }
}
