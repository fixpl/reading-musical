import { Injectable } from "@nestjs/common";
import { readLlmSettings } from "../ai/ai-contract";
import { llmConnectionIssue, probeLlmConnection } from "../ai/llm-request";
import { R2Storage, readR2Settings } from "../assets/r2-storage";
import { mailReadiness } from "../mail/mail-dispatch-policy";
import { PrismaService } from "../prisma/prisma.service";

export type ReadinessStep = { key: string; label: string; done: boolean; detail: string };

/** 발송 설정의 준비 여부. 실제 worker 실행·수신 성공은 별도로 확인한다. */
export function mailConfiguration(env: Record<string, string | undefined>) {
  const { ready, transport, reason } = mailReadiness({ get: <T = string>(key: string) => env[key] as T | undefined });
  const from = (transport === "resend" ? env.RESEND_FROM_EMAIL : env.MAIL_FROM)?.trim() || null;
  const host = env.MAIL_HOST?.trim();
  const real = ready && (transport === "resend" ||
    transport === "smtp" && Boolean(host && !/^(localhost|127\.0\.0\.1|::1)$/.test(host)));
  return { transport, from, real, ...(reason ? { reason } : {}) };
}

/**
 * 운영 콘솔의 "공연 준비 현황"과 "시스템 점검".
 * 공연마다 참여자 → 대본·구성 → 영상 → 큐 → 일정이 갖춰졌는지, 그리고 서버가 쓰는 AI·저장소·메일·DB가 지금 정상인지 한눈에 본다.
 */
@Injectable()
export class AdminOpsService {
  private healthCache: { at: number; value: unknown } | null = null;

  constructor(private readonly prisma: PrismaService) {}

  async overview() {
    const productions = await this.prisma.production.findMany({
      where: { deletedAt: null },
      orderBy: { createdAt: "desc" },
      select: { id: true, title: true, currentPhase: true, visibility: true, startDate: true, venue: true, backgroundAssetId: true, archived: true }
    });
    const ids = productions.map((production) => production.id);
    const now = new Date();
    const [members, scripts, sections, cues, events, activity, roles] = await Promise.all([
      this.prisma.membership.groupBy({ by: ["productionId"], where: { productionId: { in: ids } }, _count: { _all: true } }),
      this.prisma.script.groupBy({ by: ["productionId"], where: { productionId: { in: ids }, deletedAt: null }, _count: { _all: true } }),
      this.prisma.performanceSection.findMany({
        where: { productionId: { in: ids }, deletedAt: null },
        select: { id: true, parentId: true, productionId: true, backgroundMode: true, sourceSceneId: true, scriptText: true, lyrics: true,
          media: { where: { slot: "BACKGROUND" }, select: { asset: { select: { kind: true } } } } }
      }),
      this.prisma.trackCue.groupBy({ by: ["productionId"], where: { productionId: { in: ids }, deletedAt: null }, _count: { _all: true } }),
      this.prisma.scheduleEvent.groupBy({ by: ["productionId"], where: { productionId: { in: ids }, startAt: { gte: now } }, _min: { startAt: true }, _count: { _all: true } }),
      this.prisma.activityLog.groupBy({ by: ["productionId"], where: { productionId: { in: ids } }, _max: { createdAt: true } }),
      this.prisma.role.findMany({
        where: { productionId: { in: ids } },
        select: { productionId: true, _count: { select: { assignments: { where: { membership: { user: { status: "ACTIVE" } } } } } } }
      })
    ]);
    const count = <T extends { productionId: string | null; _count: { _all: number } }>(rows: T[]) => new Map(rows.map((row) => [row.productionId, row._count._all]));
    const memberCount = count(members), scriptCount = count(scripts), cueCount = count(cues);
    const parents = new Set(sections.flatMap(section => section.parentId ? [section.parentId] : []));
    const leaves = sections.filter(section => !parents.has(section.id));
    const byId = new Map(sections.map(section => [section.id, section]));
    const linkedScripts = new Set(sections.filter(section => section.sourceSceneId).map(section => section.productionId));
    const composedScripts = new Set(sections.filter(section =>
      section.lyrics?.trim() ||
      section.scriptText?.split(/\r?\n/).some(line => line.trim() && !line.trimStart().startsWith("※"))
    ).map(section => section.productionId));
    const nextEvent = new Map(events.map((row) => [row.productionId, row._min.startAt]));
    const lastActivity = new Map(activity.map((row) => [row.productionId, row._max.createdAt]));

    const items = productions.map((production) => {
      const memberN = memberCount.get(production.id) ?? 0;
      const scriptN = scriptCount.get(production.id) ?? 0;
      const scenes = leaves.filter(section => section.productionId === production.id);
      const sceneN = scenes.length;
      const backgrounds = scenes.map(section => {
        let current: typeof section | undefined = section;
        const seen = new Set<string>();
        while (current && !seen.has(current.id)) {
          seen.add(current.id);
          if (current.backgroundMode === "NONE") return { required: false, connected: false };
          if (current.backgroundMode === "OWN") return { required: true, connected: current.media.some(media => ["VIDEO", "IMAGE"].includes(media.asset.kind)) };
          current = current.parentId ? byId.get(current.parentId) : undefined;
        }
        return { required: true, connected: Boolean(production.backgroundAssetId) };
      }).filter(background => background.required);
      const requiredVideoN = backgrounds.length;
      const videoN = backgrounds.filter(background => background.connected).length;
      const cueN = cueCount.get(production.id) ?? 0;
      const next = nextEvent.get(production.id) ?? null;
      const productionRoles = roles.filter(role => role.productionId === production.id);
      const assignedRoles = productionRoles.filter(role => role._count.assignments > 0).length;
      const scriptPreparation = {
        hasRegisteredScript: scriptN > 0,
        hasMaterial: composedScripts.has(production.id),
        hasLinkedScene: linkedScripts.has(production.id)
      };
      // 자료 다섯 항목의 기존 계약을 보존하고, 실제 배역별 배정 여부를 별도로 제공한다.
      const casting = {
        done: productionRoles.length > 0 && assignedRoles === productionRoles.length,
        detail: productionRoles.length ? `${assignedRoles}/${productionRoles.length}개 배역 배정` : "배역 없음"
      };
      const steps: ReadinessStep[] = [
        { key: "members", label: "참여자", done: memberN >= 2, detail: memberN ? `${memberN}명` : "아직 없음" },
        { key: "script", label: "대본·구성", done: sceneN > 0, detail: sceneN ? `장면 ${sceneN}개` : scriptN ? "구성 전" : "대본 없음" },
        { key: "video", label: "영상·배경", done: sceneN > 0 && videoN === requiredVideoN, detail: sceneN ? requiredVideoN ? `${videoN}/${requiredVideoN}개 장면` : "해당 없음" : "—" },
        { key: "cues", label: "큐", done: cueN > 0, detail: cueN ? `${cueN}개` : "없음" },
        { key: "schedule", label: "일정", done: Boolean(next), detail: next ? next.toISOString() : "다가오는 일정 없음" }
      ];
      const attention: string[] = [];
      if (memberN < 2) attention.push(memberN ? "소유자만 참여 중입니다. 공연 참여자를 추가하거나 초대하세요." : "참여자가 아직 없습니다. 멤버 관리에서 추가하거나 초대하세요.");
      if (!sceneN) attention.push(scriptN ? "대본은 있지만 장·막 구성이 없습니다." : "대본이 등록되지 않았습니다.");
      if (sceneN && videoN < requiredVideoN) attention.push(`영상·배경 연결이 필요한 장면이 ${requiredVideoN - videoN}개 있습니다.`);
      if (!cueN) attention.push("담당 행동 큐가 등록되지 않았습니다.");
      if (!next) attention.push("다가오는 일정이 없습니다.");
      return {
        ...production,
        steps,
        casting,
        scriptPreparation,
        progress: Math.round((steps.filter((step) => step.done).length / steps.length) * 100),
        attention,
        nextEventAt: next,
        lastActivityAt: lastActivity.get(production.id) ?? null
      };
    });
    return { items, attentionCount: items.reduce((sum, item) => sum + (item.attention.length ? 1 : 0), 0) };
  }

  /** 서버가 쓰는 외부 서비스가 지금 정상인지 점검한다(느린 점검이 있어 1분 동안 결과를 재사용). */
  async health(force = false) {
    if (!force && this.healthCache && Date.now() - this.healthCache.at < 60_000) return this.healthCache.value;
    const [db, ai, storage] = await Promise.all([this.checkDb(), this.checkAi(), this.checkStorage()]);
    const value = {
      checkedAt: new Date().toISOString(),
      env: process.env.NODE_ENV ?? "development",
      db, ai, storage,
      mail: mailConfiguration(process.env),
      swagger: process.env.SWAGGER_ENABLED === "true" || process.env.NODE_ENV !== "production"
    };
    this.healthCache = { at: Date.now(), value };
    return value;
  }

  private async checkDb() {
    const started = Date.now();
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return { ok: true, latencyMs: Date.now() - started, error: null as string | null };
    } catch {
      return { ok: false, latencyMs: null, error: "데이터베이스에 연결하지 못했습니다." };
    }
  }

  private async checkAi() {
    let settings: ReturnType<typeof readLlmSettings>;
    try { settings = readLlmSettings(process.env); }
    catch { return { ok: false, configured: false, model: null as string | null, host: null as string | null, latencyMs: null as number | null, error: "AI 설정이 없습니다(LLM_ 환경변수)." }; }
    const host = new URL(settings.baseURL).hostname;
    const started = Date.now();
    try {
      await probeLlmConnection(settings);
      return { ok: true, configured: true, model: settings.model, host, latencyMs: Date.now() - started, error: null as string | null };
    } catch (error) {
      const reason = llmConnectionIssue(error);
      return { ok: false, configured: true, model: settings.model, host, latencyMs: null, error: reason ?? "모델 응답을 확인하지 못했습니다. 잠시 후 다시 확인하세요." };
    }
  }

  private async checkStorage() {
    let settings: ReturnType<typeof readR2Settings>;
    try { settings = readR2Settings(process.env); }
    catch (error) { return { driver: "r2" as const, ok: false, bucket: null, cors: [] as Array<{ origin: string; allowed: boolean }>, error: error instanceof Error ? error.message : "R2 설정을 확인하세요." }; }
    if (!settings) return { driver: "local" as const, ok: true, bucket: null, cors: [] as Array<{ origin: string; allowed: boolean }>, error: null as string | null, note: "서버 디스크에 저장 중입니다(개발용). 여러 서버·재배포에서는 파일이 사라질 수 있어 운영에서는 R2를 쓰세요." };
    const storage = new R2Storage(settings);
    let ok = true;
    let error: string | null = null;
    try { await storage.stat(`${settings.keyPrefix ? `${settings.keyPrefix}/` : ""}${settings.projectName}/__health__`); }
    catch { ok = false; error = "R2에 접속하지 못했습니다. 키·버킷 이름·권한을 확인하세요."; }
    // 브라우저가 직접 올리려면 버킷 CORS가 웹 주소를 허용해야 한다 — 서버가 사전 확인(preflight)을 흉내 내어 확인한다.
    const endpoint = settings.endpoint || `https://${settings.accountId}.r2.cloudflarestorage.com`;
    const origins = (process.env.CORS_ORIGINS ?? "").split(",").map((origin) => origin.trim()).filter((origin) => /^https?:\/\//.test(origin)).slice(0, 4);
    const cors = await Promise.all(origins.map(async (origin) => {
      try {
        const response = await fetch(`${endpoint}/${settings.bucket}/__cors__`, {
          method: "OPTIONS", signal: AbortSignal.timeout(8000),
          headers: { Origin: origin, "Access-Control-Request-Method": "PUT", "Access-Control-Request-Headers": "content-type" }
        });
        const allow = response.headers.get("access-control-allow-origin");
        return { origin, allowed: response.ok && (allow === origin || allow === "*") };
      } catch { return { origin, allowed: false }; }
    }));
    return { driver: "r2" as const, ok, bucket: settings.bucket, prefix: `${settings.keyPrefix ? `${settings.keyPrefix}/` : ""}${settings.projectName}`, cors, error };
  }
}
