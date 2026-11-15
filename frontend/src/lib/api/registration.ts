import { anonymousJsonPost, ApiError, apiRequest, saveTokens, type AuthTokens } from "./client";
import { fetchCurrentUser, homePathFor } from "./auth";
import { assertCurrentSession, captureSession, isCurrentSession, sessionRequestSignal, subscribeSession, type ClientSession } from "./session";

export type RegistrationEmailProof = Readonly<{ email: string; token: string; expiresAt: number }>;
export type RegistrationEmailState = Readonly<{
  phase: "idle" | "sending" | "code" | "verifying" | "verified";
  challengeExpiresAt: number;
  proofExpiresAt: number;
  retryAt: number;
  error: string;
  stopped: boolean;
}>;

type EmailChallenge = { challengeId: string; expiresAt: string; retryAfterSeconds: number };
type VerifiedEmail = { emailVerificationToken: string; expiresAt: string };

function aborted() { return new DOMException("이메일 인증 화면이 변경됐어요.", "AbortError"); }
export function isRegistrationEmailProofError(error: unknown) {
  return error instanceof ApiError && Boolean(error.code?.startsWith("REGISTRATION_EMAIL_VERIFICATION_"));
}

async function verificationPost<T>(path: string, body: unknown, session: ClientSession, signal: AbortSignal): Promise<T> {
  assertCurrentSession(session, true);
  const request = sessionRequestSignal(session, signal);
  try {
    const response = await anonymousJsonPost(path, body, { signal: request.signal });
    assertCurrentSession(session, true);
    if (signal.aborted) throw aborted();
    const payload = await response.json().catch(() => null);
    assertCurrentSession(session, true);
    if (signal.aborted) throw aborted();
    if (!response.ok) {
      const detail = payload?.message && typeof payload.message === "object" ? payload.message : payload;
      const retryAfterSeconds = Number(response.headers.get("retry-after")) || Number(detail?.retryAfterSeconds) || 60;
      throw new ApiError(typeof detail?.message === "string" ? detail.message : "이메일 인증을 진행하지 못했어요. 잠시 후 다시 시도해 주세요.", response.status, detail?.code ?? payload?.code, { retryAfterSeconds });
    }
    if (!payload || typeof payload !== "object") throw new ApiError("이메일 인증 응답을 확인하지 못했어요. 다시 시도해 주세요.", response.status);
    return payload as T;
  } finally { request.dispose(); }
}

/** 인증번호와 proof는 화면 수명과 시작 session 안에서만 유지한다. */
export class RegistrationEmailVerification {
  private readonly session = captureSession();
  private email = "";
  private challengeId = "";
  private proof: RegistrationEmailProof | null = null;
  private revision = 0;
  private request: AbortController | null = null;
  private unsubscribe: () => void;
  private state: RegistrationEmailState = { phase: "idle", challengeExpiresAt: 0, proofExpiresAt: 0, retryAt: 0, error: "", stopped: false };

  constructor(private readonly changed: (state: RegistrationEmailState) => void, private readonly now = Date.now) {
    this.unsubscribe = subscribeSession(() => {
      this.stop("로그인 상태가 바뀌었어요. 이 화면을 새로 열어 가입해 주세요.");
    });
    this.publish({});
  }

  private publish(update: Partial<RegistrationEmailState>) {
    this.state = { ...this.state, ...update };
    this.changed(this.state);
  }

  private cancel() {
    this.revision += 1;
    this.request?.abort();
    this.request = null;
  }

  setEmail(email: string) {
    if (email === this.email) return;
    this.email = email;
    this.reset();
  }

  reset(message = "") {
    this.cancel();
    this.challengeId = "";
    this.proof = null;
    this.publish({ phase: "idle", challengeExpiresAt: 0, proofExpiresAt: 0, retryAt: 0, error: message });
  }

  private stop(message: string) {
    this.reset(message);
    this.publish({ stopped: true });
    this.unsubscribe?.();
  }

  dispose() { this.stop(""); }

  private current(revision: number) {
    return revision === this.revision && !this.state.stopped && isCurrentSession(this.session, true);
  }

  getProof(email: string): RegistrationEmailProof | null {
    if (!this.current(this.revision) || email !== this.email || !this.proof || this.proof.expiresAt <= this.now()) return null;
    return this.proof;
  }

  tick() {
    if (this.state.stopped) return;
    if (this.proof && this.proof.expiresAt <= this.now()) this.reset("인증 시간이 지났어요. 인증번호를 다시 받아 주세요.");
    else if (this.challengeId && !this.proof && this.state.phase === "code" && this.state.challengeExpiresAt <= this.now()) {
      this.reset("인증번호 사용 시간이 지났어요. 새 번호를 받아 주세요.");
    }
  }

  async send() {
    if (this.state.stopped || this.state.phase === "sending" || this.state.phase === "verifying" || this.state.retryAt > this.now()) return false;
    this.cancel();
    const revision = this.revision;
    const request = new AbortController();
    this.request = request;
    this.proof = null;
    this.challengeId = "";
    this.publish({ phase: "sending", proofExpiresAt: 0, challengeExpiresAt: 0, error: "" });
    try {
      const result = await verificationPost<EmailChallenge>("/auth/registration/email/request", { email: this.email }, this.session, request.signal);
      if (!this.current(revision)) return false;
      const expiresAt = Date.parse(result.expiresAt);
      if (!result.challengeId || !Number.isFinite(expiresAt) || expiresAt <= this.now()) throw new Error("인증번호 응답을 확인하지 못했어요. 다시 시도해 주세요.");
      this.challengeId = result.challengeId;
      this.publish({ phase: "code", challengeExpiresAt: expiresAt, retryAt: this.now() + Math.max(60, Number(result.retryAfterSeconds) || 60) * 1000 });
      return true;
    } catch (error) {
      if (!this.current(revision) || request.signal.aborted) return false;
      const retry = error instanceof ApiError && error.status === 429 ? Number((error.details as { retryAfterSeconds?: number })?.retryAfterSeconds) || 60 : 0;
      this.publish({ phase: "idle", retryAt: retry ? this.now() + retry * 1000 : 0, error: error instanceof Error ? error.message : "인증번호를 보내지 못했어요. 다시 시도해 주세요." });
      return false;
    } finally { if (this.current(revision)) this.request = null; }
  }

  async verify(code: string) {
    this.tick();
    if (!this.challengeId || this.state.phase !== "code" || !/^\d{6}$/.test(code)) return false;
    const revision = this.revision;
    const request = new AbortController();
    this.request = request;
    this.publish({ phase: "verifying", error: "" });
    try {
      const result = await verificationPost<VerifiedEmail>("/auth/registration/email/verify", { email: this.email, challengeId: this.challengeId, code }, this.session, request.signal);
      if (!this.current(revision)) return false;
      const expiresAt = Date.parse(result.expiresAt);
      if (!result.emailVerificationToken || !Number.isFinite(expiresAt) || expiresAt <= this.now()) throw new Error("이메일 인증 응답을 확인하지 못했어요. 새 번호로 다시 확인해 주세요.");
      this.proof = { email: this.email, token: result.emailVerificationToken, expiresAt };
      this.publish({ phase: "verified", proofExpiresAt: this.proof.expiresAt });
      return true;
    } catch (error) {
      if (!this.current(revision) || request.signal.aborted) return false;
      this.publish({ phase: "code", error: error instanceof Error ? error.message : "인증번호를 확인하지 못했어요. 다시 시도해 주세요." });
      return false;
    } finally { if (this.current(revision)) this.request = null; }
  }
}

export type RegistrationInput = {
  email: string;
  password: string;
  name: string;
  phone?: string;
  profileType: string;
  emailVerificationToken: string;
  agreements: Record<string, boolean | string | undefined>;
};

/** 가입 응답이 시작 session에 속할 때만 새 계정으로 전환한다. */
export async function registerVerifiedAccount(input: RegistrationInput, session: ClientSession, signal: AbortSignal) {
  assertCurrentSession(session, true);
  const result = await apiRequest<{ tokens: AuthTokens }>("/auth/register", { method: "POST", body: JSON.stringify(input), session, signal });
  assertCurrentSession(session, true);
  if (signal.aborted) throw aborted();
  if (typeof result.tokens?.accessToken !== "string" || !result.tokens.accessToken) throw new ApiError("가입 결과를 확인하지 못했어요. 로그인 화면에서 계정을 확인해 주세요.", 502);
  // 신규 계정은 owner가 바뀌므로 기존 owner용 saveTokens guard 대신 전환 직전에 session을 검증한다.
  saveTokens(result.tokens);
  const committed = captureSession();
  if (committed.token !== result.tokens.accessToken || !committed.owner) throw aborted();
  return committed;
}

/** 로그인 commit으로 가입 화면이 재마운트돼도 후속 작업은 새 owner 안에서 완료한다. */
export async function finishVerifiedRegistration(session: ClientSession, inviteToken: string) {
  assertCurrentSession(session);
  if (inviteToken) {
    try {
      await apiRequest(`/invitations/${encodeURIComponent(inviteToken)}/accept`, { method: "POST", session });
    } catch {
      assertCurrentSession(session);
      return `/invite/${encodeURIComponent(inviteToken)}`;
    }
  }
  assertCurrentSession(session);
  const me = await fetchCurrentUser({ fresh: true });
  assertCurrentSession(session);
  return homePathFor(me?.platformRole);
}
