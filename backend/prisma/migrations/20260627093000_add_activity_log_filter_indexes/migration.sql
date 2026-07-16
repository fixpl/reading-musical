-- Add indexes for admin/org audit log filters by production, organization, user, action, and entity.
CREATE INDEX "ActivityLog_productionId_action_createdAt_idx" ON "ActivityLog"("productionId", "action", "createdAt");
CREATE INDEX "ActivityLog_organizationId_action_createdAt_idx" ON "ActivityLog"("organizationId", "action", "createdAt");
CREATE INDEX "ActivityLog_actorId_action_createdAt_idx" ON "ActivityLog"("actorId", "action", "createdAt");
CREATE INDEX "ActivityLog_entityId_createdAt_idx" ON "ActivityLog"("entityId", "createdAt");
CREATE INDEX "ActivityLog_entity_entityId_action_createdAt_idx" ON "ActivityLog"("entity", "entityId", "action", "createdAt");
