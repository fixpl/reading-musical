import "reflect-metadata";
import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import type { RequestUser } from "../common/types/request-user";
import { OpportunityQueryDto, ReviewRecruitmentApplicationDto, RoundDocumentDto, SubmitRecruitmentApplicationDto } from "./dto";
import { RecruitmentService } from "./recruitment.service";

const pid = "11111111-1111-4111-8111-111111111111";
const rid = "22222222-2222-4222-8222-222222222222";
const actorPositionId = "33333333-3333-4333-8333-333333333333";
const staffPositionId = "44444444-4444-4444-8444-444444444444";
const now = new Date("2026-10-23T09:00:00.000Z");
const admin = { id: "admin", email: "admin@example.test", name: "운영자", platformRole: "SUPER_ADMIN" } as RequestUser;
const applicant = { id: "applicant", email: "private@example.test", name: "지원자", platformRole: "MEMBER" } as RequestUser;
const otherApplicant = { ...applicant, id: "another-applicant", name: "다른 지원자" };
const pending = ["SUBMITTED", "REVIEWING", "ON_HOLD"];

beforeEach(() => jest.useFakeTimers({ now }));
afterEach(() => jest.useRealTimers());

function document(extra: Record<string, unknown> = {}) {
  return {
    title: "새 공연 참여 모집", summary: "배우와 스태프를 모집합니다", description: "함께 공연을 준비합니다", region: "서울",
    activityStartDate: "2026-12-01", activityEndDate: "2026-12-20", conditions: "연습 일정에 참여할 수 있는 분",
    deadlineAt: "2026-12-01T00:00:00.000Z", positions: [{ role: "ACTOR", label: "배우", capacity: 1 }], ...extra
  };
}

// 서비스의 상태 전이와 transaction 경계를 검증한다. 이 fixture의 직렬화는 PostgreSQL 행 잠금의 증거가 아니다.
function fixture() {
  let sequence = 0;
  let state: Record<string, any[]> = {
    production: [{ id: pid, organizationId: "production-org", title: "공연 제목", deletedAt: null, archived: false, internalNote: "비공개 공연 메모" }],
    user: [admin, applicant, otherApplicant].map((user) => ({ ...user, organizationId: "other-org", profileType: "STAFF", status: "ACTIVE",
      phone: "010-private", profileDetails: { privateBiography: "비공개 프로필" }, passwordHash: "private-password" })),
    membership: [], membershipRole: [], recruitmentRound: [], recruitmentPosition: [], recruitmentApplication: [], recruitmentApplicationEvent: [], notification: [],
    castAssignment: [{ id: "original-cast", roleId: "lead-role", membershipId: "existing-member" }],
    staffAssignment: [{ id: "original-duty", assignmentKey: "LIGHT", membershipId: "existing-member" }],
    performanceCreditConsent: [{ id: "original-consent", membershipId: "existing-member", showName: false, showPhoto: false }]
  };
  const roundView = (row: any) => row && ({ ...row,
    production: state.production.find((value) => value.id === row.productionId),
    positions: state.recruitmentPosition.filter((value) => value.roundId === row.id).map(positionView)
  });
  const positionView = (row: any) => row && ({ ...row,
    _count: { applications: state.recruitmentApplication.filter((value) => value.positionId === row.id && value.status === "APPROVED").length },
    applications: state.recruitmentApplication.filter((value) => value.positionId === row.id && value.status === "APPROVED")
  });
  const memberView = (row: any) => row && ({ ...row, roles: state.membershipRole.filter((value) => value.membershipId === row.id) });
  const applicationView = (row: any) => row && ({ ...row,
    user: state.user.find((value) => value.id === row.userId), round: roundView(state.recruitmentRound.find((value) => value.id === row.roundId)),
    position: positionView(state.recruitmentPosition.find((value) => value.id === row.positionId)),
    events: state.recruitmentApplicationEvent.filter((value) => value.applicationId === row.id),
    membership: memberView(state.membership.find((value) => value.id === row.membershipId))
  });
  const view = (model: string, row: any) => model === "recruitmentRound" ? roundView(row) : model === "recruitmentApplication" ? applicationView(row)
    : model === "recruitmentPosition" ? positionView(row) : model === "membership" ? memberView(row) : row;
  const matches = (row: any, where: any): boolean => {
    if (!where) return true;
    if (!row) return false;
    return Object.entries(where).every(([key, expected]: [string, any]) => {
      if (expected === undefined) return true;
      if (key === "AND") return (Array.isArray(expected) ? expected : [expected]).every((value) => matches(row, value));
      if (key === "OR") return expected.some((value: any) => matches(row, value));
      if (key === "NOT") return !(Array.isArray(expected) ? expected : [expected]).some((value) => matches(row, value));
      if (["roundId_userId", "userId_productionId", "membershipId_role"].includes(key)) return matches(row, expected);
      const actual = row[key];
      if (expected instanceof Date) return +actual === +expected;
      if (expected === null || typeof expected !== "object") return actual === expected;
      return Object.entries(expected).every(([operator, value]: [string, any]) => {
        if (operator === "equals") return actual === value;
        if (operator === "in") return value.includes(actual);
        if (operator === "notIn") return !value.includes(actual);
        if (operator === "not") return value && typeof value === "object" ? !matches({ value: actual }, { value }) : actual !== value;
        if (operator === "gt") return actual > value;
        if (operator === "gte") return actual >= value;
        if (operator === "lt") return actual < value;
        if (operator === "lte") return actual <= value;
        if (operator === "contains") return String(actual ?? "").toLocaleLowerCase().includes(String(value).toLocaleLowerCase());
        if (operator === "mode") return true;
        if (operator === "some") return Array.isArray(actual) && actual.some((item) => matches(item, value));
        if (operator === "none") return Array.isArray(actual) && actual.every((item) => !matches(item, value));
        if (operator === "is") return matches(actual, value);
        return matches(actual, { [operator]: value });
      });
    });
  };
  const apply = (row: any, data: any) => Object.fromEntries(Object.entries(data).map(([key, value]: [string, any]) =>
    [key, value && typeof value === "object" && "increment" in value ? row[key] + value.increment : value]));
  const prisma: any = {};
  for (const model of Object.keys(state)) {
    const rows = (where: any) => state[model].filter((row) => matches(view(model, row), where));
    const create = (data: any) => {
      const row = { id: `${model}-${++sequence}`, createdAt: now, updatedAt: now, revision: 1,
        ...(model === "recruitmentRound" ? { status: "DRAFT", publishedAt: null } : {}), ...data };
      if (model === "recruitmentRound") {
        const positions = row.positions?.create ?? row.positions?.createMany?.data ?? [];
        delete row.positions;
        for (const [order, position] of positions.entries()) state.recruitmentPosition.push({ id: `position-${++sequence}`, roundId: row.id, order, ...position });
      }
      if (model === "membership") {
        const roles = row.roles?.create ?? row.roles?.createMany?.data ?? [];
        delete row.roles;
        for (const role of Array.isArray(roles) ? roles : [roles]) state.membershipRole.push({ id: `member-role-${++sequence}`, membershipId: row.id, ...role });
      }
      state[model].push(row);
      return view(model, row);
    };
    prisma[model] = {
      findUnique: jest.fn(async ({ where }: any) => view(model, rows(where)[0]) ?? null),
      findFirst: jest.fn(async ({ where }: any = {}) => view(model, rows(where)[0]) ?? null),
      findMany: jest.fn(async ({ where, skip = 0, take }: any = {}) => rows(where).slice(skip, take == null ? undefined : skip + take).map((row) => view(model, row))),
      count: jest.fn(async ({ where }: any = {}) => rows(where).length),
      create: jest.fn(async ({ data }: any) => create(data)),
      createMany: jest.fn(async ({ data, skipDuplicates }: any) => {
        const values = Array.isArray(data) ? data : [data]; let count = 0;
        for (const value of values) {
          if (skipDuplicates && model === "membershipRole" && rows({ membershipId: value.membershipId, role: value.role }).length) continue;
          create(value); count++;
        }
        return { count };
      }),
      update: jest.fn(async ({ where, data }: any) => {
        const row = rows(where)[0]; if (!row) throw new Error(`Missing fixture row: ${model}`);
        const changes = { ...data };
        if (model === "recruitmentRound" && changes.positions?.create) {
          for (const position of changes.positions.create) state.recruitmentPosition.push({ id: `position-${++sequence}`, roundId: row.id, ...position });
          delete changes.positions;
        }
        Object.assign(row, apply(row, changes), { updatedAt: now }); return view(model, row);
      }),
      updateMany: jest.fn(async ({ where, data }: any) => {
        const selected = rows(where); selected.forEach((row) => Object.assign(row, apply(row, data), { updatedAt: now })); return { count: selected.length };
      }),
      deleteMany: jest.fn(async ({ where }: any) => { const selected = rows(where); state[model] = state[model].filter((row) => !selected.includes(row)); return { count: selected.length }; }),
      upsert: jest.fn(async ({ where, create: data, update }: any) => {
        const row = rows(where)[0]; if (!row) return create(data);
        Object.assign(row, apply(row, update)); return view(model, row);
      })
    };
  }
  let tail = Promise.resolve<unknown>(undefined);
  prisma.$queryRaw = jest.fn(async () => [{ id: pid }]);
  prisma.$executeRaw = jest.fn(async () => 1);
  // 별도 client 경유 여부를 기록해 transaction 밖의 쓰기를 검증에서 놓치지 않는다.
  const transactionClient: any = Object.fromEntries(Object.keys(state).map((model) => [model,
    Object.fromEntries(Object.keys(prisma[model]).map((operation) => [operation, jest.fn((...args: any[]) => prisma[model][operation](...args))]))
  ]));
  transactionClient.$queryRaw = jest.fn((...args: any[]) => prisma.$queryRaw(...args));
  transactionClient.$executeRaw = jest.fn((...args: any[]) => prisma.$executeRaw(...args));
  prisma.$transaction = jest.fn((operation: (tx: any) => unknown) => {
    const work = tail.then(async () => {
      const previous = structuredClone(state);
      try { return await operation(transactionClient); } catch (error) { state = previous; throw error; }
    });
    tail = work.catch(() => undefined); return work;
  });
  const round = { id: rid, productionId: pid, ...document(), activityStartDate: new Date("2026-12-01T00:00:00.000Z"),
    activityEndDate: new Date("2026-12-20T00:00:00.000Z"), deadlineAt: new Date("2026-12-01T00:00:00.000Z"), status: "OPEN", revision: 1,
    createdById: admin.id, createdAt: now, updatedAt: now, publishedAt: now };
  delete (round as any).positions;
  state.recruitmentRound.push(round);
  state.recruitmentPosition.push({ id: actorPositionId, roundId: rid, role: "ACTOR", label: "배우", capacity: 1, order: 0 },
    { id: staffPositionId, roundId: rid, role: "STAFF", label: "스태프", capacity: 1, order: 1 });
  const service = new RecruitmentService(prisma);
  const member = (userId: string, roles: string[], primaryRole = roles[0]) => {
    const membership = { id: userId === applicant.id ? "existing-member" : `member-${userId}`, userId, productionId: pid, primaryRole };
    state.membership.push(membership);
    state.membershipRole.push(...roles.map((role) => ({ id: `role-${userId}-${role}`, membershipId: membership.id, role })));
    return membership;
  };
  const submitted = async (user = applicant, positionId = actorPositionId) => service.submit(rid,
    { positionId, message: "공연에 참여하고 싶습니다", availability: "주말 연습 가능", expectedRevision: 0 }, user);
  return { prisma, transactionClient, service, member, submitted, get state() { return state; }, get round() { return state.recruitmentRound[0]; } };
}

const approve = (f: ReturnType<typeof fixture>, application: any, expectedRevision = application.revision) => f.service.review(pid, rid, application.id,
  { status: "APPROVED", expectedRevision, reviewMessage: "함께 준비해요" }, admin);

describe("모집 권한과 지원 경계", () => {
  test.each(["PENDING", "BLOCKED"])("현재 DB 상태가 %s인 사용자는 기존 토큰이 있어도 지원·조회하지 못한다", async (status) => {
    const f = fixture(); f.state.user.find((row) => row.id === applicant.id)!.status = status;
    await expect(f.submitted()).rejects.toMatchObject({ status: 403 });
    await expect(f.service.opportunities({}, applicant)).rejects.toMatchObject({ status: 403 });
    expect(f.state.recruitmentApplication).toEqual([]); expect(f.state.membership).toEqual([]);
  });

  test("다른 조직·기본 직군의 ACTIVE 회원도 지원하지만 지원만으로 내부 자료 권한은 얻지 않는다", async () => {
    const f = fixture(); const result = await f.submitted();
    expect(result).toMatchObject({ userId: applicant.id, status: "SUBMITTED", revision: 1, membershipId: null });
    expect(f.state.membership).toEqual([]); expect(f.state.membershipRole).toEqual([]);
    expect(f.prisma.user.update).not.toHaveBeenCalled();
    expect(f.transactionClient.recruitmentApplication.create).toHaveBeenCalledTimes(1);
    expect(f.transactionClient.recruitmentApplicationEvent.create).toHaveBeenCalledTimes(1);
    expect(f.transactionClient.notification.create).toHaveBeenCalledTimes(1);
    await expect(f.service.access(pid, applicant)).rejects.toMatchObject({ status: 404 });
  });

  test("다른 조직 ORG_ADMIN은 조직 전권이 없고 공연 PRODUCER 역할을 받았을 때만 모집을 관리한다", async () => {
    const f = fixture(); const outsider = { ...applicant, platformRole: "ORG_ADMIN" } as RequestUser;
    f.state.user.find((row) => row.id === applicant.id)!.platformRole = "ORG_ADMIN";
    await expect(f.service.rounds(pid, {}, outsider)).rejects.toMatchObject({ status: 403 });
    f.member(applicant.id, ["ACTOR"]);
    expect(await f.service.access(pid, outsider)).toEqual({ canManageRecruitment: false, canManageSchedule: false });
    await expect(f.service.createRound(pid, document() as never, outsider)).rejects.toMatchObject({ status: 403 });
    f.state.membershipRole.push({ id: "producer-role", membershipId: "existing-member", role: "PRODUCER" });
    expect(await f.service.access(pid, outsider)).toEqual({ canManageRecruitment: true, canManageSchedule: true });
    await expect(f.service.createRound(pid, document() as never, outsider)).resolves.toMatchObject({ status: "DRAFT", revision: 1 });
  });

  test("해당 조직 ORG_ADMIN과 SUPER_ADMIN은 공연 멤버가 아니어도 모집을 관리한다", async () => {
    const f = fixture(); Object.assign(f.state.user.find((row) => row.id === applicant.id)!, { organizationId: "production-org", platformRole: "ORG_ADMIN" });
    await expect(f.service.rounds(pid, {}, { ...applicant, platformRole: "ORG_ADMIN" })).resolves.toMatchObject({ total: 1 });
    expect(await f.service.access(pid, admin)).toEqual({ canManageRecruitment: true, canManageSchedule: true });
  });

  test("과거 SUPER_ADMIN 토큰이 있어도 현재 DB role이 MEMBER면 관리 권한을 얻지 못한다", async () => {
    const f = fixture(); f.state.user.find((row) => row.id === admin.id)!.platformRole = "MEMBER";
    await expect(f.service.createRound(pid, document() as never, admin)).rejects.toMatchObject({ status: 403 });
    expect(f.state.recruitmentRound).toHaveLength(1);
  });

  test.each(["DIRECTOR", "MUSIC_DIRECTOR", "STAGE_MANAGER", "ACTOR", "STAFF", "GUEST"])("%s의 일정 관리 권한과 모집 관리 권한을 구분한다", async (role) => {
    const f = fixture(); f.member(applicant.id, [role]);
    expect(await f.service.access(pid, applicant)).toEqual({ canManageRecruitment: false, canManageSchedule: ["DIRECTOR", "MUSIC_DIRECTOR", "STAGE_MANAGER"].includes(role) });
    await expect(f.service.applications(pid, rid, {}, applicant)).rejects.toMatchObject({ status: 403 });
  });

  test("같은 회차의 중복 지원과 기존 동일 역할 지원을 거절하고 다른 역할 지원은 허용한다", async () => {
    const f = fixture(); f.member(applicant.id, ["STAFF"]);
    await expect(f.submitted(applicant, staffPositionId)).rejects.toMatchObject({ status: 409 });
    const application = await f.submitted();
    await expect(f.submitted(applicant, staffPositionId)).rejects.toMatchObject({ status: 409 });
    expect(f.state.recruitmentApplication).toHaveLength(1);
    expect(application).toMatchObject({ positionId: actorPositionId });
  });

  test.each(["deleted", "archived"])("%s 공연은 SUPER_ADMIN도 조회하거나 변경할 수 없다", async (state) => {
    const f = fixture(); if (state === "deleted") f.state.production[0].deletedAt = now; else f.state.production[0].archived = true;
    await expect(f.service.opportunity(rid, admin)).rejects.toMatchObject({ status: 404 });
    await expect(f.service.rounds(pid, {}, admin)).rejects.toMatchObject({ status: 404 });
    await expect(f.service.closeRound(pid, rid, 1, admin)).rejects.toMatchObject({ status: 404 });
    await expect(f.submitted()).rejects.toMatchObject({ status: 404 });
  });
});

describe("지원 상태와 모집 조건", () => {
  test("목록은 유효 OPEN만 검색·역할·페이지 범위로 조회하고 마감·취소 회차 상세는 유지한다", async () => {
    const f = fixture();
    f.state.recruitmentRound.push(...["DRAFT", "CLOSED", "CANCELLED"].map((status) => ({ ...f.round, id: `round-${status}`, status, publishedAt: status === "DRAFT" ? null : now })),
      { ...f.round, id: "expired", deadlineAt: now }, { ...f.round, id: "different-region", region: "부산" });
    f.state.recruitmentPosition.push({ id: "only-staff", roundId: "different-region", role: "STAFF", label: "현장 스태프", capacity: 2, order: 0 });
    expect(await f.service.opportunities({ q: "서울", role: "ACTOR", limit: 1, offset: 0 }, applicant)).toMatchObject({ items: [{ id: rid }], total: 1, offset: 0, hasMore: false });
    expect(await f.service.opportunity("round-CANCELLED", applicant)).toMatchObject({ round: { status: "CANCELLED" }, eligiblePositionIds: [] });
    expect(await f.service.opportunity("expired", applicant)).toMatchObject({ round: { status: "OPEN", effectiveStatus: "CLOSED" }, eligiblePositionIds: [] });
  });

  test("초안만 수정할 수 있고 게시 뒤에는 조건·정원을 바꾸지 않는다", async () => {
    const f = fixture(); f.round.status = "DRAFT"; f.round.publishedAt = null;
    await expect(f.service.opportunity(rid, applicant)).rejects.toMatchObject({ status: 404 });
    await f.service.updateRound(pid, rid, { ...document(), expectedRevision: 1 } as never, admin);
    const published = await f.service.publishRound(pid, rid, 2, admin);
    expect(published).toMatchObject({ status: "OPEN", revision: 3 });
    await expect(f.service.updateRound(pid, rid, { ...document({ title: "게시 후 수정" }), expectedRevision: 3 } as never, admin)).rejects.toMatchObject({ status: 409 });
    expect(f.round.title).toBe("새 공연 참여 모집");
  });

  test.each(["new", "resubmission"])("마감 시각이 지난 OPEN 회차는 %s 지원을 거절한다", async (kind) => {
    const f = fixture(); let revision = 0;
    if (kind === "resubmission") { const application = await f.submitted(); revision = (await f.service.withdraw(application.id, application.revision, applicant)).revision; }
    f.round.deadlineAt = new Date("2026-10-01T00:00:00.000Z");
    await expect(f.service.submit(rid, { positionId: actorPositionId, message: "다시 지원합니다", expectedRevision: revision }, applicant)).rejects.toMatchObject({ status: 409 });
  });

  test("마감 시각과 정확히 같은 시각에도 신규 지원을 거절한다", async () => {
    const f = fixture(); f.round.deadlineAt = now;
    await expect(f.submitted()).rejects.toMatchObject({ status: 409 });
    expect(f.state.recruitmentApplication).toEqual([]);
  });

  test("다른 회차의 자리나 지원 ID를 바꿔 제출·심사할 수 없다", async () => {
    const f = fixture(); const application = await f.submitted();
    f.state.recruitmentRound.push({ ...f.round, id: "other-round" });
    await expect(f.service.submit("other-round", { positionId: actorPositionId, message: "다른 회차 자리", expectedRevision: 0 }, otherApplicant)).rejects.toMatchObject({ status: 400 });
    await expect(f.service.review(pid, "other-round", application.id, { status: "APPROVED", expectedRevision: 1 }, admin)).rejects.toMatchObject({ status: 404 });
    expect(f.state.membership).toEqual([]);
  });

  test("WITHDRAWN만 현재 revision으로 재지원하고 NOT_SELECTED는 같은 회차에 재지원하지 못한다", async () => {
    const f = fixture(); const initial = await f.submitted();
    await expect(f.service.withdraw(initial.id, initial.revision, otherApplicant)).rejects.toMatchObject({ status: 404 });
    const withdrawn = await f.service.withdraw(initial.id, initial.revision, applicant);
    expect(withdrawn).toMatchObject({ status: "WITHDRAWN", revision: 2 });
    await expect(f.service.submit(rid, { positionId: staffPositionId, message: "재지원", expectedRevision: 1 }, applicant)).rejects.toMatchObject({ status: 409 });
    const resubmitted = await f.service.submit(rid, { positionId: staffPositionId, message: "스태프로 재지원", expectedRevision: 2 }, applicant);
    expect(resubmitted).toMatchObject({ id: initial.id, positionId: staffPositionId, status: "SUBMITTED", revision: 3 });
    const rejected = await f.service.review(pid, rid, initial.id, { status: "NOT_SELECTED", expectedRevision: 3 }, admin);
    await expect(f.service.submit(rid, { positionId: actorPositionId, message: "다시 지원", expectedRevision: rejected.revision }, applicant)).rejects.toMatchObject({ status: 409 });
    await expect(f.service.withdraw(initial.id, rejected.revision, applicant)).rejects.toMatchObject({ status: 409 });
  });

  test.each(pending)("CLOSED 회차의 %s 지원은 검토·승인할 수 있다", async (status) => {
    const f = fixture(); const application = await f.submitted(); f.state.recruitmentApplication[0].status = status;
    await f.service.closeRound(pid, rid, 1, admin);
    await expect(approve(f, application)).resolves.toMatchObject({ status: "APPROVED" });
    await expect(f.submitted(otherApplicant)).rejects.toMatchObject({ status: 409 });
  });

  test("낡은 회차·지원 revision의 변경을 거절하고 이력과 알림을 추가하지 않는다", async () => {
    const f = fixture(); const application = await f.submitted(); const events = f.state.recruitmentApplicationEvent.length; const notifications = f.state.notification.length;
    await expect(f.service.closeRound(pid, rid, 0, admin)).rejects.toMatchObject({ status: 409 });
    await expect(f.service.review(pid, rid, application.id, { status: "REVIEWING", expectedRevision: 0 }, admin)).rejects.toMatchObject({ status: 409 });
    expect(f.state.recruitmentApplicationEvent).toHaveLength(events); expect(f.state.notification).toHaveLength(notifications);
  });
});

describe("승인 원자성과 정원", () => {
  test("지원 후 차단된 회원은 승인할 수 없고 역할·상태·이력은 그대로 남는다", async () => {
    const f = fixture(); const application = await f.submitted(); f.state.user.find((row) => row.id === applicant.id)!.status = "BLOCKED";
    const original = structuredClone(f.state);
    await expect(approve(f, application)).rejects.toMatchObject({ status: 409 });
    expect(f.state).toEqual(original);
  });

  test("기존 primaryRole·역할·배역·담당 직무·공개 동의·조직·플랫폼 권한을 보존하고 신청 역할만 추가한다", async () => {
    const f = fixture(); f.member(applicant.id, ["DIRECTOR", "STAFF"], "DIRECTOR"); const originalUser = structuredClone(f.state.user);
    const originalAssignments = structuredClone({ cast: f.state.castAssignment, staff: f.state.staffAssignment, consent: f.state.performanceCreditConsent });
    const application = await f.submitted(); const approved = await approve(f, application);
    expect(approved).toMatchObject({ status: "APPROVED", revision: 2, membershipId: "existing-member" });
    expect(f.state.membership).toEqual([{ id: "existing-member", userId: applicant.id, productionId: pid, primaryRole: "DIRECTOR" }]);
    expect(f.state.membershipRole.map((row) => row.role).sort()).toEqual(["ACTOR", "DIRECTOR", "STAFF"]);
    expect(f.state.user).toEqual(originalUser);
    expect({ cast: f.state.castAssignment, staff: f.state.staffAssignment, consent: f.state.performanceCreditConsent }).toEqual(originalAssignments);
    expect(f.prisma.membershipRole.deleteMany).not.toHaveBeenCalled();
    expect(f.state.notification.at(-1)).toMatchObject({ userId: applicant.id, type: "RECRUITMENT_APPLICATION_UPDATED", payload: expect.objectContaining({ href: `/app/p/${pid}` }) });
    expect(f.transactionClient.membership.upsert).toHaveBeenCalledTimes(1);
    expect(f.transactionClient.membershipRole.upsert).toHaveBeenCalledTimes(1);
    expect(f.transactionClient.recruitmentApplication.update).toHaveBeenCalledTimes(1);
    expect(f.transactionClient.recruitmentApplicationEvent.create).toHaveBeenCalledTimes(2);
    expect(f.transactionClient.notification.create).toHaveBeenCalledTimes(2);
    const queries = f.transactionClient.$queryRaw.mock.calls.map((call: any[]) => call[0].join("?"));
    expect(queries).toEqual([expect.stringMatching(/FROM productions .*FOR UPDATE/), expect.stringMatching(/FROM productions .*FOR UPDATE/), expect.stringMatching(/FROM users .*FOR UPDATE/)]);
    expect(f.transactionClient.$queryRaw.mock.invocationCallOrder[1]).toBeLessThan(f.transactionClient.membership.upsert.mock.invocationCallOrder[0]);
  });

  test("지원 후 수동으로 추가된 동일 역할은 중복 생성하지 않으며 승인 재요청도 멱등이다", async () => {
    const f = fixture(); const application = await f.submitted(); f.member(applicant.id, ["STAFF", "ACTOR"], "STAFF");
    await approve(f, application);
    const original = structuredClone({ members: f.state.membership, roles: f.state.membershipRole, events: f.state.recruitmentApplicationEvent, notifications: f.state.notification });
    await expect(approve(f, application)).resolves.toMatchObject({ status: "APPROVED", revision: 2 });
    expect({ members: f.state.membership, roles: f.state.membershipRole, events: f.state.recruitmentApplicationEvent, notifications: f.state.notification }).toEqual(original);
    expect(f.state.membershipRole.filter((row) => row.role === "ACTOR")).toHaveLength(1);
  });

  test("정원 1 자리의 동시 승인 중 하나만 성공하고 다른 지원은 미처리로 남는다", async () => {
    const f = fixture(); const a = await f.submitted(); const b = await f.submitted(otherApplicant);
    const result = await Promise.allSettled([approve(f, a), approve(f, b)]);
    expect(result.filter((entry) => entry.status === "fulfilled")).toHaveLength(1);
    expect(result.find((entry) => entry.status === "rejected")).toMatchObject({ reason: { status: 409 } });
    expect(f.state.recruitmentApplication.filter((row) => row.status === "APPROVED")).toHaveLength(1);
    expect(f.state.recruitmentApplication.filter((row) => row.status === "SUBMITTED")).toHaveLength(1);
    expect(f.state.membership).toHaveLength(1);
    expect(f.state.notification.filter((row) => row.payload?.href === `/app/p/${pid}`)).toHaveLength(1);
  });

  test.each(["recruitmentApplicationEvent", "notification"])("%s 저장 실패는 membership·역할·지원 상태를 함께 rollback한다", async (model) => {
    const f = fixture(); const application = await f.submitted(); const original = structuredClone(f.state);
    f.prisma[model].create.mockRejectedValueOnce(new Error("write failed"));
    await expect(approve(f, application)).rejects.toThrow("write failed");
    expect(f.state).toEqual(original);
    expect(f.prisma.$transaction).toHaveBeenCalledTimes(2);
  });

  test("초기 지원 알림 저장 실패도 지원·이력을 남기지 않는다", async () => {
    const f = fixture(); f.prisma.notification.create.mockRejectedValueOnce(new Error("notification failed"));
    await expect(f.submitted()).rejects.toThrow("notification failed");
    expect(f.state.recruitmentApplication).toEqual([]); expect(f.state.recruitmentApplicationEvent).toEqual([]); expect(f.state.notification).toEqual([]);
  });

  test("공연 취소 중 알림 저장 실패는 회차와 모든 미처리 지원 변경을 함께 되돌린다", async () => {
    const f = fixture(); await f.submitted(); await f.submitted(otherApplicant); const original = structuredClone(f.state);
    f.prisma.notification.createMany.mockRejectedValueOnce(new Error("notification failed"));
    await expect(f.service.cancelRound(pid, rid, 1, admin)).rejects.toThrow("notification failed");
    expect(f.state).toEqual(original);
  });

  test.each(["approval-first", "cancellation-first"])("승인·취소 경합 %s는 승인 멤버를 보존하거나 승인을 거절한다", async (order) => {
    const f = fixture(); const application = await f.submitted();
    const result = await Promise.allSettled(order === "approval-first"
      ? [approve(f, application), f.service.cancelRound(pid, rid, 1, admin)]
      : [f.service.cancelRound(pid, rid, 1, admin), approve(f, application)]);
    expect(f.round.status).toBe("CANCELLED");
    if (order === "approval-first") {
      expect(result.every((entry) => entry.status === "fulfilled")).toBe(true);
      expect(f.state.recruitmentApplication[0].status).toBe("APPROVED"); expect(f.state.membership).toHaveLength(1);
    } else {
      expect(result[1]).toMatchObject({ status: "rejected", reason: { status: 409 } });
      expect(f.state.recruitmentApplication[0].status).toBe("CANCELLED"); expect(f.state.membership).toEqual([]);
    }
  });
});

describe("응답 whitelist", () => {
  test("목록·상세·지원·관리 응답에서 연락처·profile·내부 메모·이력 actorId를 노출하지 않는다", async () => {
    const f = fixture(); const application = await f.submitted(); await approve(f, application);
    const responses = [await f.service.opportunities({}, applicant), await f.service.opportunity(rid, applicant),
      await f.service.myApplications({}, applicant), await f.service.rounds(pid, {}, admin), await f.service.applications(pid, rid, {}, admin)];
    const serialized = JSON.stringify(responses);
    for (const key of ["email", "phone", "profileType", "profileDetails", "passwordHash", "organizationId", "internalNote", "createdById", "reviewedById", "actorId"]) expect(serialized).not.toContain(`"${key}"`);
    for (const secret of ["private@example.test", "010-private", "비공개 프로필", "비공개 공연 메모"]) expect(serialized).not.toContain(secret);
    const own = (await f.service.myApplications({}, applicant)).items[0];
    expect(Object.keys(own).sort()).toEqual(["id", "roundId", "positionId", "userId", "applicantName", "status", "revision", "message", "availability", "reviewMessage", "membershipId", "createdAt", "updatedAt", "position", "round", "events"].sort());
    expect(Object.keys(own.events[0]).sort()).toEqual(["id", "fromStatus", "toStatus", "message", "createdAt"].sort());
    expect(Object.keys(own.round).sort()).toEqual(["id", "productionId", "productionTitle", "title", "summary", "description", "region", "activityStartDate", "activityEndDate", "conditions", "deadlineAt", "status", "effectiveStatus", "revision", "createdAt", "publishedAt", "positions"].sort());
    expect(Object.keys(own.position).sort()).toEqual(["id", "role", "label", "capacity", "approvedCount"].sort());
  });
});

describe("모집 입력 검증", () => {
  test.each([
    { title: " " }, { title: "제".repeat(121) }, { activityStartDate: "2026-02-30" }, { activityEndDate: "2026-11-30" },
    { deadlineAt: "2026-12-01T12:00:00" }, { positions: [] }, { positions: [{ role: "DIRECTOR", label: "연출", capacity: 1 }] },
    { positions: [{ role: "ACTOR", label: "배우", capacity: 0 }] }, { positions: [{ role: "ACTOR", label: "배우", capacity: 1001 }] }
  ])("잘못된 문서 %j는 저장 전에 거절한다", async (invalid) => {
    const f = fixture();
    await expect(f.service.createRound(pid, document(invalid) as never, admin)).rejects.toMatchObject({ status: 400 });
    expect(f.prisma.recruitmentRound.create).not.toHaveBeenCalled();
  });

  test("같은 ACTOR 역할의 여러 자리는 허용하며 순서와 서로 다른 정원을 보존한다", async () => {
    const f = fixture();
    const result = await f.service.createRound(pid, document({ positions: [{ role: "ACTOR", label: "주연", capacity: 1 }, { role: "ACTOR", label: "앙상블", capacity: 8 }] }) as never, admin);
    expect(result.positions).toEqual([
      expect.objectContaining({ role: "ACTOR", label: "주연", capacity: 1, approvedCount: 0 }),
      expect.objectContaining({ role: "ACTOR", label: "앙상블", capacity: 8, approvedCount: 0 })
    ]);
  });

  test("DTO가 지원자·심사자 ID 주입과 범위를 넘는 query·본문을 거절한다", async () => {
    const options = { whitelist: true, forbidNonWhitelisted: true };
    const submit = await validate(plainToInstance(SubmitRecruitmentApplicationDto, { positionId: actorPositionId, message: "지원", expectedRevision: 0, userId: admin.id, actorId: admin.id }), options);
    expect(submit.map((error) => error.property)).toEqual(expect.arrayContaining(["userId", "actorId"]));
    const review = await validate(plainToInstance(ReviewRecruitmentApplicationDto, { status: "APPROVED", expectedRevision: 1, reviewedById: admin.id, reviewMessage: "안".repeat(1001) }), options);
    expect(review.map((error) => error.property)).toEqual(expect.arrayContaining(["reviewedById", "reviewMessage"]));
    const query = await validate(plainToInstance(OpportunityQueryDto, { limit: "51", offset: "100001", q: "a".repeat(121), role: "DIRECTOR" }), options);
    expect(query.map((error) => error.property)).toEqual(expect.arrayContaining(["limit", "offset", "q", "role"]));
    const round = await validate(plainToInstance(RoundDocumentDto, document({ positions: [{ role: "ACTOR", label: "배우", capacity: 1, grantedById: admin.id }] })), options);
    expect(round.find((error) => error.property === "positions")?.children?.[0]?.children?.some((error) => error.property === "grantedById")).toBe(true);
  });
});
