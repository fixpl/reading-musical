import { SetMetadata } from "@nestjs/common";
export const ALLOW_DELETED_PRODUCTION = "production:allow-deleted";
// Only restoration and administrator impact inspection may opt in.
export const AllowDeletedProduction = () => SetMetadata(ALLOW_DELETED_PRODUCTION, true);
