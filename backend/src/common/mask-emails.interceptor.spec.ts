import { maskEmail, maskUserEmails } from "./mask-emails.interceptor";

describe("mask user emails", () => {
  test("masks the local part of user summaries at any depth and leaves other fields alone", () => {
    const body = { memberships: [{ id: "m", user: { id: "u", email: "kim.minjun@example.com", name: "민준", profileType: "ACTOR", profileComplete: true } }], note: { email: "keep@x.com" }, at: new Date(0) };
    const masked = maskUserEmails(body);
    expect(masked.memberships[0].user.email).toBe("ki********@example.com");
    expect(masked.memberships[0].user.name).toBe("민준");
    expect(masked.note.email).toBe("keep@x.com");
    expect(masked.at).toEqual(new Date(0));
    expect(body.memberships[0].user.email).toBe("kim.minjun@example.com");
  });
  test("short or malformed addresses never leak", () => {
    expect(maskEmail("ab@x.com")).toBe("ab***@x.com");
    expect(maskEmail("nodomain")).toBe("***");
  });
});
