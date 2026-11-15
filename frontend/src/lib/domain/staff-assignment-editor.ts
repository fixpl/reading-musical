export type StaffAssignmentValue = { discipline: string; customLabel: string | null; isLead: boolean };

/** PUT 전체 교체 전에 라벨을 검증하고 기존 직무의 이름·대표 담당 여부를 보존한다. */
export function staffAssignmentInput(disciplines: string[], otherLabels: string[], previous: StaffAssignmentValue[]): StaffAssignmentValue[] {
  const selected = [...new Set(disciplines)];
  const existingOther = previous.filter((item) => item.discipline === "OTHER");
  const assignments = selected.flatMap((discipline) => {
    if (discipline !== "OTHER") {
      const saved = previous.find((item) => item.discipline === discipline);
      return [{ discipline, customLabel: saved?.customLabel ?? null, isLead: saved?.isLead ?? false }];
    }
    if (otherLabels.length === 0) throw new Error("기타 직무 이름을 입력해 주세요.");
    return otherLabels.map((value, index) => {
      const customLabel = value.trim();
      if (!customLabel) throw new Error("기타 직무 이름을 입력해 주세요.");
      if (customLabel.length > 80) throw new Error("기타 직무 이름은 80자 이내로 입력해 주세요.");
      return { discipline, customLabel, isLead: existingOther[index]?.isLead ?? false };
    });
  });
  if (assignments.length > 100) throw new Error("스태프 직무는 100개까지 지정할 수 있어요.");
  const keys = assignments.map((item) => item.discipline === "OTHER" ? `OTHER:${item.customLabel?.toLowerCase().replace(/\s+/g, "-")}` : item.discipline);
  if (new Set(keys).size !== keys.length) throw new Error("같은 기타 직무 이름이 있어요. 이름을 구분해 주세요.");
  return assignments;
}
