import { Phase, Prisma } from "@prisma/client";
import { defaultChecklistItemsForPhase } from "./default-checklist";

export const CHECKLIST_PHASE_ORDER = [Phase.PLANNING, Phase.READING, Phase.REHEARSAL, Phase.PERFORMANCE] as const;

type ChecklistTemplateClient = {
  checklistTemplate: {
    count(args?: Prisma.ChecklistTemplateCountArgs): Promise<number>;
    createMany(args: Prisma.ChecklistTemplateCreateManyArgs): Promise<Prisma.BatchPayload>;
    findMany(args: Prisma.ChecklistTemplateFindManyArgs): Promise<
      Array<{
        phase: Phase;
        order: number;
        label: string;
        description: string | null;
        assigneeRole: Prisma.ChecklistTemplateGetPayload<{}>["assigneeRole"];
        staffDiscipline: Prisma.ChecklistTemplateGetPayload<{}>["staffDiscipline"];
        requiresApproval: boolean;
      }>
    >;
  };
};

export type ChecklistItemSeed = {
  order: number;
  label: string;
  description?: string | null;
  assigneeRole?: Prisma.ChecklistItemCreateManyInput["assigneeRole"];
  staffDiscipline?: Prisma.ChecklistItemCreateManyInput["staffDiscipline"];
  requiresApproval: boolean;
};

export async function ensureGlobalChecklistTemplates(client: ChecklistTemplateClient) {
  const existing = await client.checklistTemplate.count();
  if (existing > 0) {
    return;
  }

  await client.checklistTemplate.createMany({
    data: CHECKLIST_PHASE_ORDER.flatMap((phase) =>
      defaultChecklistItemsForPhase(phase).map((item) => ({
        phase,
        order: item.order,
        label: item.label,
        description: item.description,
        assigneeRole: item.assigneeRole,
        staffDiscipline: item.staffDiscipline,
        requiresApproval: item.requiresApproval
      }))
    ),
    skipDuplicates: true
  });
}

export async function activeChecklistTemplateSeeds(client: ChecklistTemplateClient) {
  await ensureGlobalChecklistTemplates(client);
  const templates = await client.checklistTemplate.findMany({
    where: { active: true },
    orderBy: [{ phase: "asc" }, { order: "asc" }, { createdAt: "asc" }]
  });
  const byPhase = new Map<Phase, ChecklistItemSeed[]>();

  for (const template of templates) {
    const items = byPhase.get(template.phase) ?? [];
    items.push({
      order: items.length + 1,
      label: template.label,
      description: template.description,
      assigneeRole: template.assigneeRole,
      staffDiscipline: template.staffDiscipline,
      requiresApproval: template.requiresApproval
    });
    byPhase.set(template.phase, items);
  }

  return byPhase;
}

export async function checklistPhaseCreateDataFromTemplates(client: ChecklistTemplateClient) {
  const seedsByPhase = await activeChecklistTemplateSeeds(client);
  return CHECKLIST_PHASE_ORDER.map((phase) => ({
    phase,
    items: { create: seedsByPhase.get(phase) ?? [] }
  }));
}
