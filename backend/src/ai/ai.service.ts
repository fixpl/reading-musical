import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  ServiceUnavailableException
} from "@nestjs/common";
import OpenAI from "openai";
import mammoth from "mammoth";
import { PDFParse } from "pdf-parse";
import { PlatformRole, Prisma, ProductionRole, SceneBlockType } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import type { RequestUser } from "../common/types/request-user";
import { ApplyCueDraftDto, GenerateCueDraftDto } from "./dto";

const STAFF_ROLES: readonly ProductionRole[] = [
  ProductionRole.PRODUCER,
  ProductionRole.DIRECTOR,
  ProductionRole.MUSIC_DIRECTOR,
  ProductionRole.STAGE_MANAGER
];

const TRACK_NAMES = ["해설", "배우", "음악", "효과음", "영상", "조명"] as const;

// 모델이 기본 6트랙 대신 흔히 쓰는 이름을 표준 트랙으로 흡수한다.
const TRACK_SYNONYMS: Record<string, string> = {
  해설자: "해설",
  내레이션: "해설",
  내레이터: "해설",
  나레이션: "해설",
  음향: "효과음",
  사운드: "효과음",
  자막: "영상",
  비디오: "영상",
  라이트: "조명"
};

const SYSTEM_PROMPT = `너는 리딩뮤지컬(낭독 공연) 무대감독의 조수다. 대본 전문을 읽고 공연 운영에 필요한 구조를 만든다.

작업 순서:
1. 대본을 막(act)과 장면(scene)으로 나눈다. 막 구분이 없으면 "1막" 하나로 묶는다. 장면 제목은 대본에 적힌 표기를 우선 쓰고, 없으면 내용을 짧게 요약해 짓는다. 장면 summary는 한 문장.
2. 각 장면에서 부서별 큐를 뽑는다. 트랙은 반드시 다음 6종만 쓴다.
   - 해설: 내레이션 시작·전환
   - 배우: 등퇴장, 자리 이동, 소품 등 배우 행동
   - 음악: 음악 시작·정지·전환 (M01 같은 넘버, BGM, 반주 지시)
   - 효과음: 효과음 재생
   - 영상: 영상·자막 전환
   - 조명: 조명 변화 (암전, 페이드, 핀 등)
3. 각 장면의 lines에 대본 본문을 공연 진행 순서대로 담는다.
   - kind는 대사, 가사, 지문, 메모 중 하나.
   - NAR로 표시된 문장은 반드시 speaker "해설자"의 대사로 담는다. 인물 대사·가사에는 그 인물 이름을 speaker로 쓴다.
   - ACT(동선)는 지문으로, 비고·주의는 메모로 담는다.
   - NAR·ACT·MUS 같은 태그 문자와 Q번호는 text에 남기지 말고 내용만 옮긴다.
   - 원문 문장을 그대로 옮긴다. 요약하거나 빼먹지 않는다.
   - lines를 채웠다고 cues를 줄이면 안 된다. 둘 다 빠짐없이 완성한다(조명·영상·음악 지시는 모두 큐로).
4. 각 큐를 채운다.
   - trigger: 큐를 실행하는 계기. 직전 대사나 행동을 짧게 인용한다.
   - content: 실행할 일을 명령형으로 간결하게 쓴다.
   - note: 주의사항이 있을 때만 쓴다.
   - character: 배우 트랙 큐에만, 그 행동을 하는 인물 이름 하나. 여러 명이면 대표 인물. 인물이 분명하지 않으면 생략.
   - seconds: 그 큐가 차지하는 예상 소요 초(정수). 대사·노래 길이로 합리적으로 추정하고, 추정이 어려우면 생략.
5. 대본에 적힌 지시문이 최우선이다. 지시문이 없어도 운영상 명백히 필요한 큐(장면 전환 시 조명·음악)는 추가하되 note에 "제안"이라고 적는다.
6. 큐는 장면 안에서 시간 순서대로 나열한다. 확신이 없는 내용을 지어내지 않는다.

출력 규칙: 설명이나 코드 펜스 없이 JSON 객체 하나만 출력한다. 형태는 다음과 같다.
{"acts":[{"title":"1막","scenes":[{"title":"장면 제목","summary":"한 문장 요약","lines":[{"kind":"대사","speaker":"엄마","text":"원문 대사"},{"kind":"지문","text":"무대 지시"}],"cues":[{"track":"조명","trigger":"계기","content":"실행 내용","note":"주의(선택)","character":"인물(배우 큐만)","seconds":20}]}]}]}
track 값은 반드시 해설, 배우, 음악, 효과음, 영상, 조명 중 하나만 쓴다. trigger·note·speaker가 없으면 그 키를 생략한다.`;

type DraftCue = { track: string; content: string; trigger: string | null; note: string | null; character: string | null; seconds: number | null };
type DraftLine = { kind: "대사" | "가사" | "지문" | "메모"; speaker: string | null; text: string };
type DraftScene = { title: string; summary: string | null; lines: DraftLine[]; cues: DraftCue[] };
type DraftAct = { title: string; scenes: DraftScene[] };
export type CueDraft = { acts: DraftAct[] };

const LINE_KINDS = new Set(["대사", "가사", "지문", "메모"]);
const BLOCK_TYPE_BY_KIND: Record<string, SceneBlockType> = {
  대사: SceneBlockType.DIALOGUE,
  가사: SceneBlockType.LYRIC,
  지문: SceneBlockType.STAGE_DIRECTION,
  메모: SceneBlockType.NOTE
};

@Injectable()
export class AiService {
  constructor(private readonly prisma: PrismaService) {}

  async generateCueDraft(
    productionId: string,
    dto: GenerateCueDraftDto,
    user: RequestUser,
    onProgress?: (done: number, total: number) => void
  ) {
    await this.assertStaff(productionId, user);

    const apiKey = process.env.LLM_API_KEY;
    if (!apiKey) {
      throw new ServiceUnavailableException(
        "AI 초안 기능이 아직 켜져 있지 않습니다. 서버 환경 변수 LLM_API_KEY를 설정해 주세요."
      );
    }
    const client = new OpenAI({
      apiKey,
      baseURL: process.env.LLM_BASE_URL ?? "https://generativelanguage.googleapis.com/v1beta/openai/",
      timeout: 180_000
    });
    const model = process.env.LLM_MODEL ?? "models/gemini-flash-lite-latest";
    // 사고(thinking) 모드 모델은 사소한 요청에도 수십 초가 걸린다 — 기본은 끈다.
    // 빈 문자열이면 옵션 자체를 보내지 않는다.
    const reasoningEffort = process.env.LLM_REASONING_EFFORT ?? "none";

    const runDraftForText = async (text: string, part?: { index: number; total: number }): Promise<CueDraft> => {
      const systemPrompt =
        part && part.total > 1
          ? `${SYSTEM_PROMPT}\n\n지금 받는 텍스트는 전체 대본의 ${part.index}/${part.total} 부분이다. 이 부분에 실제로 나온 장면·대사·큐를 하나도 빠뜨리지 말고 담아라. 없는 앞뒤 맥락은 상상해서 지어내지 마라.`
          : SYSTEM_PROMPT;
      const request = {
        model,
        temperature: 0.2,
        max_tokens: 16_000,
        ...(reasoningEffort ? { reasoning_effort: reasoningEffort } : {}),
        messages: [
          { role: "system" as const, content: systemPrompt },
          { role: "user" as const, content: text }
        ]
      };
      const runOnce = async (withJsonFormat: boolean) => {
        const completion = await client.chat.completions.create({
          ...request,
          ...(withJsonFormat ? { response_format: { type: "json_object" as const } } : {})
        } as Parameters<typeof client.chat.completions.create>[0]);
        const choice = "choices" in completion ? completion.choices[0] : undefined;
        return { text: choice?.message?.content ?? "", finishReason: choice?.finish_reason ?? null };
      };
      let result: { text: string; finishReason: string | null };
      try {
        result = await runOnce(true);
      } catch (error) {
        if (error instanceof OpenAI.APIError && error.status === 400) {
          // 일부 모델은 response_format을 지원하지 않는다 — 기본 요청으로 재시도.
          try {
            result = await runOnce(false);
          } catch (retryError) {
            throw this.toServiceError(retryError);
          }
        } else {
          throw this.toServiceError(error);
        }
      }
      if (!result.text) {
        throw new ServiceUnavailableException("AI가 초안을 만들지 못했습니다. 다시 시도해 주세요.");
      }
      return this.normalizeDraft(this.extractJson(result.text));
    };

    // 긴 대본은 한 번의 호출로 다 담기지 않는다(출력 길이 한계로 요약됨) — 조각으로 나눠 처리한 뒤 합친다.
    const CHUNK_CHARS = 4500;
    const MAX_CHUNKS = 24;
    const chunks = this.chunkScript(dto.text, CHUNK_CHARS);
    const limited = chunks.slice(0, MAX_CHUNKS);

    let draft: CueDraft;
    let failedChunks = 0;
    let completed = 0;
    onProgress?.(0, limited.length);
    if (limited.length <= 1) {
      draft = await runDraftForText(dto.text);
      onProgress?.(1, 1);
    } else {
      // 조각 하나가 실패해도(간헐적 JSON 파싱 실패 등) 전체를 버리지 않는다 — 한 번 재시도하고 안 되면 건너뛴다.
      const runChunk = async (text: string, index: number): Promise<CueDraft | null> => {
        const part = { index: index + 1, total: limited.length };
        try {
          return await runDraftForText(text, part);
        } catch {
          try {
            return await runDraftForText(text, part);
          } catch {
            return null;
          }
        } finally {
          completed += 1;
          onProgress?.(completed, limited.length);
        }
      };
      const results = await this.mapWithConcurrency(limited, 2, runChunk);
      const ok = results.filter((item): item is CueDraft => item !== null);
      failedChunks = results.length - ok.length;
      if (ok.length === 0) {
        throw new ServiceUnavailableException("AI가 초안을 만들지 못했습니다. 다시 시도해 주세요.");
      }
      draft = this.mergeDrafts(ok);
    }

    return {
      draft,
      model,
      stats: this.draftStats(draft),
      parts: limited.length,
      failedChunks,
      truncatedChunks: chunks.length > MAX_CHUNKS ? chunks.length - MAX_CHUNKS : 0
    };
  }

  // 순서를 유지하며 동시 실행 개수를 제한한다.
  private async mapWithConcurrency<T, R>(
    items: T[],
    limit: number,
    fn: (item: T, index: number) => Promise<R>
  ): Promise<R[]> {
    const results = new Array<R>(items.length);
    let next = 0;
    const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
      for (;;) {
        const index = next;
        next += 1;
        if (index >= items.length) return;
        results[index] = await fn(items[index], index);
      }
    });
    await Promise.all(workers);
    return results;
  }

  // 대본을 줄 경계에서 maxChars 이하 조각으로 나눈다. 아주 긴 한 줄은 그대로 둔다.
  private chunkScript(text: string, maxChars: number): string[] {
    const lines = text.split(/\r?\n/);
    const chunks: string[] = [];
    let current = "";
    for (const line of lines) {
      if (current.length > 0 && current.length + line.length + 1 > maxChars) {
        chunks.push(current);
        current = "";
      }
      if (line.length > maxChars) {
        if (current) {
          chunks.push(current);
          current = "";
        }
        chunks.push(line);
        continue;
      }
      current = current ? `${current}\n${line}` : line;
    }
    if (current.trim()) chunks.push(current);
    return chunks.length > 0 ? chunks : [text];
  }

  // 조각별 초안을 하나로 합친다. 제목이 같은 연속 막은 장면을 이어 붙인다.
  private mergeDrafts(drafts: CueDraft[]): CueDraft {
    const acts: DraftAct[] = [];
    for (const draft of drafts) {
      for (const act of draft.acts) {
        const last = acts[acts.length - 1];
        if (last && last.title === act.title) {
          last.scenes.push(...act.scenes);
        } else {
          acts.push({ title: act.title, scenes: [...act.scenes] });
        }
      }
    }
    return { acts };
  }

  // 업로드된 파일에서 대본 텍스트를 뽑는다 (txt·docx·pdf). NestJS/Node에서 처리된다.
  async extractTextFromUpload(
    productionId: string,
    user: RequestUser,
    file: { buffer: Buffer; originalname: string; mimetype: string; size: number } | undefined
  ) {
    await this.assertStaff(productionId, user);
    if (!file || !file.buffer?.length) {
      throw new BadRequestException("업로드된 파일이 없습니다");
    }
    const name = (file.originalname ?? "").toLowerCase();
    const isDocx = name.endsWith(".docx") || file.mimetype.includes("word") || file.mimetype.includes("officedocument");
    const isPdf = name.endsWith(".pdf") || file.mimetype === "application/pdf";
    let text = "";
    if (isDocx) {
      const result = await mammoth.extractRawText({ buffer: file.buffer });
      text = result.value;
    } else if (isPdf) {
      const parser = new PDFParse({ data: file.buffer });
      try {
        const result = await parser.getText();
        text = result.text ?? "";
      } finally {
        await parser.destroy();
      }
    } else {
      text = file.buffer.toString("utf8");
    }
    text = text.replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
    if (text.length < 10) {
      throw new BadRequestException("파일에서 대본 텍스트를 찾지 못했습니다. 다른 파일이나 붙여넣기를 이용해 주세요.");
    }
    return { text, filename: file.originalname ?? "", chars: text.length };
  }

  async applyCueDraft(productionId: string, dto: ApplyCueDraftDto, user: RequestUser) {
    await this.assertStaff(productionId, user);
    const draft = this.normalizeDraft(dto.draft);
    if (draft.acts.length === 0) {
      throw new BadRequestException("적용할 초안이 비어 있습니다");
    }

    return this.prisma.$transaction(
      async (tx) => {
        // 기존 대본에 이어붙이기: targetScriptId가 있으면 그 대본을 쓰고 막 순서를 이어간다.
        let script: { id: string };
        let actOrderBase = 0;
        if (dto.targetScriptId) {
          const target = await tx.script.findFirst({
            where: { id: dto.targetScriptId, productionId },
            select: { id: true }
          });
          if (!target) {
            throw new BadRequestException("이어붙일 대본을 찾을 수 없습니다");
          }
          script = target;
          actOrderBase = await tx.act.count({ where: { scriptId: target.id } });
        } else {
          script = await tx.script.create({
            data: { productionId, title: dto.scriptTitle?.trim() || "AI 구조화 대본" }
          });
        }

        const createdScenes: Array<{ scene: DraftScene; id: string }> = [];
        for (const [actIndex, act] of draft.acts.entries()) {
          const createdAct = await tx.act.create({
            data: { scriptId: script.id, title: act.title, order: actOrderBase + actIndex }
          });
          for (const [sceneIndex, scene] of act.scenes.entries()) {
            const createdScene = await tx.scene.create({
              data: { actId: createdAct.id, title: scene.title, summary: scene.summary, order: sceneIndex }
            });
            createdScenes.push({ scene, id: createdScene.id });
          }
        }

        // 대본 본문(lines) → 장면 블록. 화자는 배역으로 연결하고 없으면 만든다.
        const existingRoles = await tx.role.findMany({
          where: { productionId },
          select: { id: true, name: true }
        });
        const roleByName = new Map(existingRoles.map((role) => [role.name, role.id]));
        let newRoles = 0;
        let blockCount = 0;
        for (const { scene, id: sceneId } of createdScenes) {
          if (scene.lines.length === 0) continue;
          const blockRows: Prisma.SceneBlockCreateManyInput[] = [];
          for (const [lineIndex, line] of scene.lines.entries()) {
            let characterId: string | null = null;
            if (line.speaker) {
              let roleId = roleByName.get(line.speaker);
              if (!roleId) {
                const created = await tx.role.create({
                  data: { productionId, name: line.speaker },
                  select: { id: true }
                });
                roleId = created.id;
                roleByName.set(line.speaker, roleId);
                newRoles += 1;
              }
              characterId = roleId;
            }
            blockRows.push({
              sceneId,
              order: lineIndex + 1,
              type: BLOCK_TYPE_BY_KIND[line.kind] ?? SceneBlockType.STAGE_DIRECTION,
              text: line.text,
              characterId
            });
          }
          await tx.sceneBlock.createMany({ data: blockRows });
          blockCount += blockRows.length;
        }

        // 초안에 등장한 트랙만 확보한다 — 기본 순서 우선, 나머지는 등장 순서.
        const usedNames = new Set<string>();
        for (const { scene } of createdScenes) {
          for (const cue of scene.cues) usedNames.add(cue.track);
        }
        const orderedNames = [
          ...TRACK_NAMES.filter((name) => usedNames.has(name)),
          ...[...usedNames].filter((name) => !(TRACK_NAMES as readonly string[]).includes(name))
        ];

        const existingTracks = await tx.cueTrack.findMany({ where: { productionId } });
        const trackByName = new Map(existingTracks.map((track) => [track.name, track]));
        let nextTrackOrder = existingTracks.reduce((max, track) => Math.max(max, track.order + 1), 0);
        let newTracks = 0;
        for (const name of orderedNames) {
          if (!trackByName.has(name)) {
            const track = await tx.cueTrack.create({
              data: { productionId, name, order: nextTrackOrder++ }
            });
            trackByName.set(name, track);
            newTracks += 1;
          }
        }

        const grouped = await tx.trackCue.groupBy({
          by: ["trackId"],
          where: { productionId },
          _count: { _all: true }
        });
        const counts = new Map(grouped.map((row) => [row.trackId, row._count._all]));

        const rows: Prisma.TrackCueCreateManyInput[] = [];
        // order는 공연 전체 진행 순서 — 장면 안에서 대본에 나온 순서 그대로 보이게 한다.
        let orderCounter = await tx.trackCue.count({ where: { productionId } });
        for (const { scene, id: sceneId } of createdScenes) {
          for (const cue of scene.cues) {
            const track = trackByName.get(cue.track);
            if (!track) continue;
            const seq = (counts.get(track.id) ?? 0) + 1;
            counts.set(track.id, seq);
            let cueCharacterId: string | null = null;
            if (cue.character) {
              let roleId = roleByName.get(cue.character);
              if (!roleId) {
                const created = await tx.role.create({
                  data: { productionId, name: cue.character },
                  select: { id: true }
                });
                roleId = created.id;
                roleByName.set(cue.character, roleId);
                newRoles += 1;
              }
              cueCharacterId = roleId;
            }
            rows.push({
              productionId,
              trackId: track.id,
              sceneId,
              cueNumber: `${track.name.slice(0, 1)}${String(seq).padStart(2, "0")}`,
              trigger: cue.trigger,
              content: cue.content,
              note: cue.note,
              characterId: cueCharacterId,
              durationSec: cue.seconds,
              order: orderCounter++,
              authorId: user.id
            });
          }
        }
        if (rows.length > 0) {
          await tx.trackCue.createMany({ data: rows });
        }

        return {
          scriptId: script.id,
          appended: Boolean(dto.targetScriptId),
          acts: draft.acts.length,
          scenes: createdScenes.length,
          blocks: blockCount,
          newRoles,
          newTracks,
          cues: rows.length
        };
      },
      { timeout: 30_000 }
    );
  }

  private toServiceError(error: unknown) {
    if (error instanceof OpenAI.APIError) {
      // 운영 진단용 — 공급자 원본 오류를 서버 로그에 남긴다.
      console.error("[ai] provider error", error.status, JSON.stringify(error.error ?? error.message).slice(0, 300));
      return new ServiceUnavailableException(
        `AI 호출에 실패했습니다 (${error.status ?? "네트워크 오류"}). 잠시 후 다시 시도해 주세요.`
      );
    }
    return error;
  }

  // 모델이 코드 펜스나 앞뒤 설명을 붙여도 JSON 본문만 골라 파싱한다.
  private extractJson(text: string): unknown {
    const trimmed = text.trim();
    const candidates = [trimmed];
    const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fenced) candidates.unshift(fenced[1].trim());
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start >= 0 && end > start) candidates.push(trimmed.slice(start, end + 1));

    for (const candidate of candidates) {
      try {
        return JSON.parse(candidate);
      } catch {
        // 다음 후보 시도
      }
    }
    throw new ServiceUnavailableException("AI 응답을 해석하지 못했습니다. 다시 시도해 주세요.");
  }

  private normalizeDraft(raw: unknown): CueDraft {
    const fail = () => new BadRequestException("초안 형식이 올바르지 않습니다");
    if (!raw || typeof raw !== "object" || !Array.isArray((raw as { acts?: unknown }).acts)) {
      throw fail();
    }
    const clip = (value: unknown, max: number): string | null => {
      if (typeof value !== "string") return null;
      const trimmed = value.trim();
      return trimmed ? trimmed.slice(0, max) : null;
    };

    const acts: DraftAct[] = [];
    for (const actRaw of (raw as { acts: unknown[] }).acts.slice(0, 20)) {
      if (!actRaw || typeof actRaw !== "object") throw fail();
      const actTitle = clip((actRaw as { title?: unknown }).title, 120);
      const scenesRaw = (actRaw as { scenes?: unknown }).scenes;
      if (!actTitle || !Array.isArray(scenesRaw)) throw fail();

      const scenes: DraftScene[] = [];
      for (const sceneRaw of scenesRaw.slice(0, 100)) {
        if (!sceneRaw || typeof sceneRaw !== "object") throw fail();
        const sceneTitle = clip((sceneRaw as { title?: unknown }).title, 120);
        const cuesRaw = (sceneRaw as { cues?: unknown }).cues;
        if (!sceneTitle || !Array.isArray(cuesRaw)) throw fail();

        const cues: DraftCue[] = [];
        for (const cueRaw of cuesRaw.slice(0, 200)) {
          if (!cueRaw || typeof cueRaw !== "object") continue;
          const trackRaw = clip((cueRaw as { track?: unknown }).track, 40);
          const content = clip((cueRaw as { content?: unknown }).content, 500);
          if (!trackRaw || !content) continue;
          const secondsRaw = (cueRaw as { seconds?: unknown }).seconds;
          const seconds =
            typeof secondsRaw === "number" && Number.isFinite(secondsRaw)
              ? Math.min(3600, Math.max(1, Math.round(secondsRaw)))
              : null;
          cues.push({
            track: TRACK_SYNONYMS[trackRaw] ?? trackRaw,
            content,
            trigger: clip((cueRaw as { trigger?: unknown }).trigger, 300),
            note: clip((cueRaw as { note?: unknown }).note, 300),
            character: clip((cueRaw as { character?: unknown }).character, 40),
            seconds
          });
        }

        const lines: DraftLine[] = [];
        const linesRaw = (sceneRaw as { lines?: unknown }).lines;
        if (Array.isArray(linesRaw)) {
          for (const lineRaw of linesRaw.slice(0, 500)) {
            if (!lineRaw || typeof lineRaw !== "object") continue;
            const text = clip((lineRaw as { text?: unknown }).text, 2000);
            if (!text) continue;
            const kindRaw = clip((lineRaw as { kind?: unknown }).kind, 10) ?? "지문";
            const kind = (LINE_KINDS.has(kindRaw) ? kindRaw : "지문") as DraftLine["kind"];
            lines.push({
              kind,
              speaker: kind === "대사" || kind === "가사" ? clip((lineRaw as { speaker?: unknown }).speaker, 40) : null,
              text
            });
          }
        }

        scenes.push({
          title: sceneTitle,
          summary: clip((sceneRaw as { summary?: unknown }).summary, 300),
          lines,
          cues
        });
      }
      if (scenes.length > 0) {
        acts.push({ title: actTitle, scenes });
      }
    }
    return { acts };
  }

  private draftStats(draft: CueDraft) {
    let scenes = 0;
    let cues = 0;
    let lines = 0;
    const cuesByTrack: Record<string, number> = {};
    for (const act of draft.acts) {
      scenes += act.scenes.length;
      for (const scene of act.scenes) {
        lines += scene.lines.length;
        for (const cue of scene.cues) {
          cues += 1;
          cuesByTrack[cue.track] = (cuesByTrack[cue.track] ?? 0) + 1;
        }
      }
    }
    return { acts: draft.acts.length, scenes, cues, lines, cuesByTrack };
  }

  private async assertStaff(productionId: string, user: RequestUser) {
    if (user.platformRole === PlatformRole.SUPER_ADMIN) {
      return;
    }
    if (user.platformRole === PlatformRole.ORG_ADMIN) {
      const [production, caller] = await Promise.all([
        this.prisma.production.findUnique({ where: { id: productionId }, select: { organizationId: true } }),
        this.prisma.user.findUnique({ where: { id: user.id }, select: { organizationId: true } })
      ]);
      if (production && caller && production.organizationId === caller.organizationId) {
        return;
      }
      throw new ForbiddenException("이 공연을 처리할 권한이 없어요");
    }
    const membership = await this.prisma.membership.findFirst({
      where: {
        productionId,
        userId: user.id,
        roles: { some: { role: { in: [...STAFF_ROLES] } } }
      },
      select: { id: true }
    });
    if (!membership) {
      throw new ForbiddenException("제작진만 할 수 있는 작업입니다");
    }
  }
}
