import type { FaqCategory, FaqQuestion } from "../api/site";

export type CategoryDraft = Pick<FaqCategory, "id" | "name" | "order" | "active" | "revision">;
export type QuestionDraft = Pick<FaqQuestion, "id" | "categoryId" | "title" | "body" | "order" | "active" | "revision">;
export function categoryDraft(value?: FaqCategory): CategoryDraft {
  return value ? { id: value.id, name: value.name, order: value.order, active: value.active, revision: value.revision }
    : { id: "", name: "", order: 10, active: true, revision: 1 };
}
export function questionDraft(value?: FaqQuestion, categoryId = ""): QuestionDraft {
  return value ? { id: value.id, categoryId: value.categoryId, title: value.title, body: value.body, order: value.order, active: value.active, revision: value.revision }
    : { id: "", categoryId, title: "", body: "", order: 10, active: true, revision: 1 };
}
export function sortFaq(items: FaqCategory[]): FaqCategory[] {
  return items.map((item) => ({ ...item, questions: [...item.questions].sort((a, b) => a.order - b.order || a.id.localeCompare(b.id)) }))
    .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name, "ko"));
}
export function applySavedCategory(items: FaqCategory[], saved: Omit<FaqCategory, "questions">): FaqCategory[] {
  const old = items.find((item) => item.id === saved.id);
  return sortFaq([...items.filter((item) => item.id !== saved.id), { ...saved, questions: old?.questions ?? [] }]);
}
export function applySavedQuestion(items: FaqCategory[], saved: FaqQuestion): FaqCategory[] {
  return sortFaq(items.map((item) => ({ ...item, questions: [
    ...item.questions.filter((question) => question.id !== saved.id),
    ...(item.id === saved.categoryId ? [saved] : [])
  ] })));
}
export function validOrder(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 100000;
}
