import { SetMetadata } from "@nestjs/common";
import type { ProductionRole } from "@prisma/client";

export const PRODUCTION_ROLES_KEY = "productionRoles";
export const ProductionRoles = (...roles: ProductionRole[]) => SetMetadata(PRODUCTION_ROLES_KEY, roles);
