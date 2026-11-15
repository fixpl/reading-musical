import "reflect-metadata";
import { INTERCEPTORS_METADATA } from "@nestjs/common/constants";
import { from, lastValueFrom } from "rxjs";
import { MaskEmailsInterceptor } from "./mask-emails.interceptor";
import { ProductionScheduleController, MyScheduleController } from "../schedule/schedule.controller";
import { RunSheetsController } from "../run-sheets/run-sheets.controller";
import { ReadingSessionsController } from "../reading-sessions/reading-sessions.controller";
import type { RequestUser } from "./types/request-user";

const viewer: RequestUser = { id: "viewer", email: "viewer@example.test", name: "참여자", platformRole: "MEMBER" };
const source = {
  memberships: [{ user: { id: "member", name: "팀원", profileType: "ACTOR", email: "member@example.test" } }],
  events: [{ attendances: [{ membership: { user: { profileType: "STAFF", email: "staff@example.test" } } }] }],
  activeSession: { runSheet: { items: [{ ownerMembership: { user: { profileType: "ACTOR", email: "actor@example.test" } } }] } },
  note: { email: "team@example.test" }
};

const routes = [
  { Controller: ProductionScheduleController, call: () => new ProductionScheduleController({ getWorkspace: () => source } as never).getWorkspace("production", undefined, undefined, viewer) },
  { Controller: MyScheduleController, call: () => new MyScheduleController({ getMySchedule: () => source } as never).getMySchedule(viewer) },
  { Controller: RunSheetsController, call: () => new RunSheetsController({ getWorkspace: () => source } as never).getWorkspace("production", viewer) },
  { Controller: ReadingSessionsController, call: () => new ReadingSessionsController({ getEventWorkspace: () => source } as never).getEventWorkspace("production", "event", viewer) }
];

describe("공동 작업 controller의 연락처 응답 경계", () => {
  it.each(routes)("$Controller.name에서 모든 중첩 사용자 이메일을 가리고 원본은 보존한다", async ({ Controller, call }) => {
    expect(Reflect.getMetadata(INTERCEPTORS_METADATA, Controller)).toContain(MaskEmailsInterceptor);
    const response = await lastValueFrom(new MaskEmailsInterceptor().intercept({} as never, {
      handle: () => from(Promise.resolve(call()))
    }));
    const serialized = JSON.stringify(response);
    for (const address of ["member@example.test", "staff@example.test", "actor@example.test"]) expect(serialized).not.toContain(address);
    expect(response.note.email).toBe(source.note.email);
    expect(source.memberships[0].user.email).toBe("member@example.test");
    expect(source.events[0].attendances[0].membership.user.email).toBe("staff@example.test");
    expect(source.activeSession.runSheet.items[0].ownerMembership.user.email).toBe("actor@example.test");
  });
});
