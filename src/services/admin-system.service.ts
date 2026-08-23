import { env } from "../config/env";
import { prisma } from "../lib/prisma";

export class AdminSystemService {
  async getStatus() {
    let dbOk = false;
    let lastMigration: { name: string; finishedAt: string | null } | null = null;
    try {
      await prisma.$queryRaw`SELECT 1`;
      dbOk = true;
      const rows = await prisma.$queryRaw<Array<{ migration_name: string; finished_at: Date | null }>>`
        SELECT migration_name, finished_at
        FROM _prisma_migrations
        ORDER BY finished_at DESC NULLS LAST
        LIMIT 1
      `;
      if (rows[0]) {
        lastMigration = {
          name: rows[0].migration_name,
          finishedAt: rows[0].finished_at?.toISOString() ?? null,
        };
      }
    } catch {
      dbOk = false;
    }

    const [whatsappConnected, whatsappError, whatsappTotal] = await Promise.all([
      prisma.whatsAppIntegration.count({
        where: { deletedAt: null, connectionStatus: "CONNECTED" },
      }),
      prisma.whatsAppIntegration.count({
        where: { deletedAt: null, connectionStatus: "ERROR" },
      }),
      prisma.whatsAppIntegration.count({ where: { deletedAt: null } }),
    ]);

    return {
      api: { status: "ok" as const },
      database: { reachable: dbOk },
      environment: env.nodeEnv,
      whatsappProviderMode: env.whatsappProviderMode,
      lastMigration,
      integrations: {
        whatsappTotal,
        whatsappConnected,
        whatsappError,
      },
    };
  }
}

export const adminSystemService = new AdminSystemService();
