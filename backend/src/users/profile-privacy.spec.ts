import { addsOptionalProfileData } from "./profile-privacy";

describe("optional profile consent decision", () => {
  it("requires consent for a new phone", () => {
    expect(addsOptionalProfileData({ phone: "01012345678" }, { phone: null })).toBe(true);
  });
  it("does not require consent for clearing optional fields", () => {
    expect(addsOptionalProfileData({ phone: null, address: "", birthDate: null, photoAssetId: null, gender: "UNSPECIFIED", profileDetails: null }, { phone: "01012345678", address: "서울", birthDate: "1990-01-01", photoAssetId: "photo", gender: "FEMALE", profileDetails: { voiceRange: "alto" } })).toBe(false);
  });
  it("does not treat whitespace normalization as new collection", () => {
    expect(addsOptionalProfileData({ phone: " 01012345678 ", address: " 서울 " }, { phone: "01012345678", address: "서울" })).toBe(false);
  });
  it("leaves omitted fields unchanged without requiring consent", () => {
    expect(addsOptionalProfileData({}, { phone: "01012345678", address: "서울" })).toBe(false);
  });
  it("compares stored dates and input dates consistently", () => {
    expect(addsOptionalProfileData({ birthDate: "1990-01-01" }, { birthDate: new Date("1990-01-01T00:00:00.000Z") })).toBe(false);
    expect(addsOptionalProfileData({ birthDate: "1990-01-02" }, { birthDate: "1990-01-01" })).toBe(true);
  });
  it("allows removal of one specialty while retaining the others", () => {
    expect(addsOptionalProfileData({ profileDetails: { specialties: ["노래"], voiceRange: "" } }, { profileDetails: { specialties: ["노래", "연기"], voiceRange: "alto" } })).toBe(false);
  });
  it("requires consent for a new specialty or photo reference", () => {
    expect(addsOptionalProfileData({ profileDetails: { specialties: ["노래", "춤"] } }, { profileDetails: { specialties: ["노래"] } })).toBe(true);
    expect(addsOptionalProfileData({ photoAssetId: "new-photo" }, { photoAssetId: "old-photo" })).toBe(true);
  });
  it("ignores key ordering and ordinary UI preference changes", () => {
    expect(addsOptionalProfileData({ profileDetails: { voiceRange: "alto", specialties: ["노래"], settings: { theme: "dark" } } }, { profileDetails: { settings: { theme: "light" }, specialties: ["노래"], voiceRange: "alto" } })).toBe(false);
  });
});
