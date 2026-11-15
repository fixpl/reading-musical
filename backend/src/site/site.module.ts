import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { RateLimitGuard } from "../common/guards/rate-limit.guard";
import { SiteController, AdminSiteController } from "./site.controller";
import { SiteService } from "./site.service";
import { SupportService } from "./support.service";

@Module({ imports: [JwtModule.register({})], controllers: [SiteController, AdminSiteController], providers: [SiteService, SupportService, RateLimitGuard], exports: [SiteService, SupportService] })
export class SiteModule {}
