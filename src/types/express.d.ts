import type { UserRole } from "@prisma/client";

export {};

declare global {
  namespace Express {
    interface Request {
      auth?: {
        userId: string;
        email: string;
        tenantId: string | null;
        role: UserRole | null;
        siteId?: string | null;
        siteIsActive?: boolean | null;
        isPlatformAdmin?: boolean;
        membershipId?: string;
        allSites?: boolean;
        allowedSiteIds?: string[] | null;
        permissions?: string[];
      };
    }
  }
}
