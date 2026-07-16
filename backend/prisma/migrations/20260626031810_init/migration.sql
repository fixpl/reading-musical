-- CreateEnum
CREATE TYPE "PlatformRole" AS ENUM ('SUPER_ADMIN', 'ORG_ADMIN', 'MEMBER');

-- CreateEnum
CREATE TYPE "ProfileType" AS ENUM ('ACTOR', 'STAFF', 'DIRECTOR', 'MUSIC_DIRECTOR', 'STAGE_MANAGER', 'PLANNER', 'OTHER');

-- CreateEnum
CREATE TYPE "ProductionRole" AS ENUM ('PRODUCER', 'DIRECTOR', 'MUSIC_DIRECTOR', 'STAGE_MANAGER', 'ACTOR', 'STAFF', 'GUEST');

-- CreateEnum
CREATE TYPE "StaffDiscipline" AS ENUM ('SOUND', 'LIGHTING', 'STAGE_CREW', 'PROPS', 'COSTUME', 'MAKEUP', 'VIDEO', 'FRONT_OF_HOUSE', 'PRODUCTION_ASSISTANT', 'ACCOMPANIST', 'OTHER');

-- CreateEnum
CREATE TYPE "Gender" AS ENUM ('MALE', 'FEMALE', 'OTHER', 'UNSPECIFIED');

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'BLOCKED');

-- CreateEnum
CREATE TYPE "Phase" AS ENUM ('PLANNING', 'READING', 'REHEARSAL', 'PERFORMANCE');

-- CreateEnum
CREATE TYPE "Visibility" AS ENUM ('DRAFT', 'PUBLISHED');

-- CreateEnum
CREATE TYPE "EventType" AS ENUM ('READING', 'MUSIC_PRACTICE', 'REHEARSAL', 'ENSEMBLE', 'PERFORMANCE');

-- CreateEnum
CREATE TYPE "AttendanceStatus" AS ENUM ('INVITED', 'ACCEPTED', 'DECLINED', 'TENTATIVE');

-- CreateEnum
CREATE TYPE "InviteStatus" AS ENUM ('PENDING', 'ACCEPTED', 'EXPIRED', 'REVOKED');

-- CreateEnum
CREATE TYPE "AssetKind" AS ENUM ('AUDIO', 'IMAGE', 'DOCUMENT');

-- CreateEnum
CREATE TYPE "SceneBlockType" AS ENUM ('DIALOGUE', 'LYRIC', 'STAGE_DIRECTION', 'NOTE');

-- CreateEnum
CREATE TYPE "AnnotationType" AS ENUM ('DIRECTION', 'PRONUNCIATION', 'ACTING', 'NOTE');

-- CreateEnum
CREATE TYPE "AnchorStatus" AS ENUM ('OK', 'UNLINKED', 'BROKEN');

-- CreateEnum
CREATE TYPE "CastAssignmentKind" AS ENUM ('MAIN', 'DOUBLE', 'UNDERSTUDY');

-- CreateEnum
CREATE TYPE "CueType" AS ENUM ('START', 'STOP', 'PAUSE', 'RESUME', 'SFX', 'MIC', 'NOTE');

-- CreateEnum
CREATE TYPE "CueFireMode" AS ENUM ('MANUAL', 'AUTO_MARKER');

-- CreateEnum
CREATE TYPE "ChecklistStatus" AS ENUM ('TODO', 'IN_PROGRESS', 'WAITING_APPROVAL', 'DONE', 'BLOCKED');

-- CreateEnum
CREATE TYPE "LinkedResourceType" AS ENUM ('SCRIPT', 'SCENE', 'SCENE_BLOCK', 'MUSIC_CUE', 'STAGE_PLAN', 'EVENT', 'ASSET', 'RUN_SHEET', 'RUN_SHEET_ITEM');

-- CreateEnum
CREATE TYPE "RunSheetStatus" AS ENUM ('DRAFT', 'LOCKED', 'COMPLETED');

-- CreateEnum
CREATE TYPE "RunSheetItemType" AS ENUM ('SCENE', 'CUE', 'STAGE_NOTE', 'CHECK', 'BREAK', 'ANNOUNCEMENT');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "gender" "Gender" NOT NULL DEFAULT 'UNSPECIFIED',
    "birthDate" TIMESTAMP(3),
    "address" TEXT,
    "profileType" "ProfileType" NOT NULL DEFAULT 'ACTOR',
    "profileDetails" JSONB,
    "photoAssetId" TEXT,
    "profileComplete" BOOLEAN NOT NULL DEFAULT false,
    "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
    "emailNotify" BOOLEAN NOT NULL DEFAULT true,
    "platformRole" "PlatformRole" NOT NULL DEFAULT 'MEMBER',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Organization" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Organization_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Production" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "slug" TEXT,
    "synopsis" TEXT,
    "description" TEXT,
    "venue" TEXT,
    "startDate" TIMESTAMP(3),
    "endDate" TIMESTAMP(3),
    "currentPhase" "Phase" NOT NULL DEFAULT 'PLANNING',
    "visibility" "Visibility" NOT NULL DEFAULT 'DRAFT',
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Production_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Membership" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "productionId" TEXT NOT NULL,
    "primaryRole" "ProductionRole" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Membership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MembershipRole" (
    "id" TEXT NOT NULL,
    "membershipId" TEXT NOT NULL,
    "role" "ProductionRole" NOT NULL,
    "grantedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MembershipRole_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StaffAssignment" (
    "id" TEXT NOT NULL,
    "productionId" TEXT NOT NULL,
    "membershipId" TEXT NOT NULL,
    "discipline" "StaffDiscipline" NOT NULL,
    "assignmentKey" TEXT NOT NULL,
    "customLabel" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StaffAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Invitation" (
    "id" TEXT NOT NULL,
    "productionId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "role" "ProductionRole" NOT NULL,
    "token" TEXT NOT NULL,
    "status" "InviteStatus" NOT NULL DEFAULT 'PENDING',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Invitation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PositionRequirement" (
    "id" TEXT NOT NULL,
    "productionId" TEXT NOT NULL,
    "role" "ProductionRole" NOT NULL,
    "label" TEXT NOT NULL,
    "requiredCount" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "PositionRequirement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Availability" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "startAt" TIMESTAMP(3) NOT NULL,
    "endAt" TIMESTAMP(3) NOT NULL,
    "isAvailable" BOOLEAN NOT NULL DEFAULT false,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Availability_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Script" (
    "id" TEXT NOT NULL,
    "productionId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Script_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScriptImport" (
    "id" TEXT NOT NULL,
    "scriptId" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "parsedJson" JSONB,
    "errorMessage" TEXT,
    "createdById" TEXT NOT NULL,
    "appliedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ScriptImport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Act" (
    "id" TEXT NOT NULL,
    "scriptId" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "title" TEXT NOT NULL,

    CONSTRAINT "Act_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Scene" (
    "id" TEXT NOT NULL,
    "actId" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT,

    CONSTRAINT "Scene_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SceneBlock" (
    "id" TEXT NOT NULL,
    "sceneId" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "type" "SceneBlockType" NOT NULL,
    "characterId" TEXT,
    "text" TEXT NOT NULL,
    "cueLabel" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SceneBlock_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScriptVersion" (
    "id" TEXT NOT NULL,
    "scriptId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "snapshot" JSONB NOT NULL,
    "authorId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ScriptVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Annotation" (
    "id" TEXT NOT NULL,
    "sceneId" TEXT NOT NULL,
    "anchorBlockId" TEXT,
    "authorId" TEXT NOT NULL,
    "type" "AnnotationType" NOT NULL,
    "content" TEXT NOT NULL,
    "isShared" BOOLEAN NOT NULL DEFAULT false,
    "anchorStatus" "AnchorStatus" NOT NULL DEFAULT 'OK',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Annotation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Role" (
    "id" TEXT NOT NULL,
    "productionId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,

    CONSTRAINT "Role_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CastAssignment" (
    "id" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "membershipId" TEXT NOT NULL,
    "kind" "CastAssignmentKind" NOT NULL DEFAULT 'MAIN',

    CONSTRAINT "CastAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SceneRole" (
    "id" TEXT NOT NULL,
    "sceneId" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "lineCount" INTEGER NOT NULL DEFAULT 0,
    "songCount" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "SceneRole_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MusicTrack" (
    "id" TEXT NOT NULL,
    "productionId" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "durationMs" INTEGER,
    "waveformPeaksJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MusicTrack_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MusicCue" (
    "id" TEXT NOT NULL,
    "productionId" TEXT NOT NULL,
    "trackId" TEXT NOT NULL,
    "sceneId" TEXT,
    "anchorBlockId" TEXT,
    "cueNumber" TEXT NOT NULL,
    "cueType" "CueType" NOT NULL DEFAULT 'START',
    "order" INTEGER NOT NULL,
    "trackStartMs" INTEGER NOT NULL DEFAULT 0,
    "trackEndMs" INTEGER,
    "fadeInMs" INTEGER NOT NULL DEFAULT 0,
    "fadeOutMs" INTEGER NOT NULL DEFAULT 0,
    "volumeDb" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "fireMode" "CueFireMode" NOT NULL DEFAULT 'MANUAL',
    "note" TEXT,
    "anchorStatus" "AnchorStatus" NOT NULL DEFAULT 'UNLINKED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MusicCue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StagePlan" (
    "id" TEXT NOT NULL,
    "productionId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "layout" JSONB NOT NULL,

    CONSTRAINT "StagePlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StageElement" (
    "id" TEXT NOT NULL,
    "stagePlanId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "x" DOUBLE PRECISION NOT NULL,
    "y" DOUBLE PRECISION NOT NULL,
    "note" TEXT,

    CONSTRAINT "StageElement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StageSceneNote" (
    "id" TEXT NOT NULL,
    "stagePlanId" TEXT NOT NULL,
    "sceneId" TEXT NOT NULL,
    "note" TEXT NOT NULL,
    "checklistItemId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StageSceneNote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScheduleEvent" (
    "id" TEXT NOT NULL,
    "productionId" TEXT NOT NULL,
    "type" "EventType" NOT NULL,
    "title" TEXT NOT NULL,
    "startAt" TIMESTAMP(3) NOT NULL,
    "endAt" TIMESTAMP(3) NOT NULL,
    "location" TEXT,
    "meetingUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ScheduleEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EventScene" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "sceneId" TEXT NOT NULL,

    CONSTRAINT "EventScene_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EventMusicCue" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "cueId" TEXT NOT NULL,

    CONSTRAINT "EventMusicCue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Attendance" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "membershipId" TEXT NOT NULL,
    "status" "AttendanceStatus" NOT NULL DEFAULT 'INVITED',
    "forced" BOOLEAN NOT NULL DEFAULT false,
    "forcedReason" TEXT,

    CONSTRAINT "Attendance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RunSheet" (
    "id" TEXT NOT NULL,
    "productionId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "RunSheetStatus" NOT NULL DEFAULT 'DRAFT',
    "createdById" TEXT NOT NULL,
    "lockedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RunSheet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RunSheetItem" (
    "id" TEXT NOT NULL,
    "runSheetId" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "itemType" "RunSheetItemType" NOT NULL,
    "sceneId" TEXT,
    "cueId" TEXT,
    "stageSceneNoteId" TEXT,
    "checklistItemId" TEXT,
    "title" TEXT NOT NULL,
    "estimatedDurationMin" INTEGER,
    "ownerRole" "ProductionRole",
    "ownerMembershipId" TEXT,
    "staffDiscipline" "StaffDiscipline",
    "note" TEXT,
    "completedAt" TIMESTAMP(3),
    "completedById" TEXT,

    CONSTRAINT "RunSheetItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReadingSession" (
    "id" TEXT NOT NULL,
    "productionId" TEXT NOT NULL,
    "eventId" TEXT,
    "runSheetId" TEXT,
    "startedAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "currentSceneId" TEXT,
    "currentBlockId" TEXT,
    "progressNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReadingSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CueFireLog" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "cueId" TEXT NOT NULL,
    "firedById" TEXT NOT NULL,
    "firedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "payload" JSONB,

    CONSTRAINT "CueFireLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChecklistPhase" (
    "id" TEXT NOT NULL,
    "productionId" TEXT NOT NULL,
    "phase" "Phase" NOT NULL,

    CONSTRAINT "ChecklistPhase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChecklistItem" (
    "id" TEXT NOT NULL,
    "phaseId" TEXT NOT NULL,
    "eventId" TEXT,
    "order" INTEGER NOT NULL,
    "label" TEXT NOT NULL,
    "description" TEXT,
    "status" "ChecklistStatus" NOT NULL DEFAULT 'TODO',
    "assigneeRole" "ProductionRole",
    "staffDiscipline" "StaffDiscipline",
    "requiresApproval" BOOLEAN NOT NULL DEFAULT false,
    "dueAt" TIMESTAMP(3),
    "linkedResourceType" "LinkedResourceType",
    "linkedResourceId" TEXT,
    "done" BOOLEAN NOT NULL DEFAULT false,
    "doneAt" TIMESTAMP(3),
    "doneBy" TEXT,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),

    CONSTRAINT "ChecklistItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChecklistAssignment" (
    "id" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "membershipId" TEXT NOT NULL,

    CONSTRAINT "ChecklistAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "productionId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ActivityLog" (
    "id" TEXT NOT NULL,
    "productionId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ActivityLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Asset" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "productionId" TEXT,
    "kind" "AssetKind" NOT NULL,
    "storageKey" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "checksum" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Asset_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_profileType_idx" ON "User"("profileType");

-- CreateIndex
CREATE INDEX "User_status_idx" ON "User"("status");

-- CreateIndex
CREATE UNIQUE INDEX "Production_slug_key" ON "Production"("slug");

-- CreateIndex
CREATE INDEX "Production_organizationId_idx" ON "Production"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "Production_organizationId_title_key" ON "Production"("organizationId", "title");

-- CreateIndex
CREATE INDEX "Membership_productionId_idx" ON "Membership"("productionId");

-- CreateIndex
CREATE UNIQUE INDEX "Membership_userId_productionId_key" ON "Membership"("userId", "productionId");

-- CreateIndex
CREATE INDEX "MembershipRole_role_idx" ON "MembershipRole"("role");

-- CreateIndex
CREATE UNIQUE INDEX "MembershipRole_membershipId_role_key" ON "MembershipRole"("membershipId", "role");

-- CreateIndex
CREATE INDEX "StaffAssignment_productionId_discipline_idx" ON "StaffAssignment"("productionId", "discipline");

-- CreateIndex
CREATE UNIQUE INDEX "StaffAssignment_membershipId_assignmentKey_key" ON "StaffAssignment"("membershipId", "assignmentKey");

-- CreateIndex
CREATE UNIQUE INDEX "Invitation_token_key" ON "Invitation"("token");

-- CreateIndex
CREATE INDEX "Invitation_productionId_idx" ON "Invitation"("productionId");

-- CreateIndex
CREATE INDEX "PositionRequirement_productionId_idx" ON "PositionRequirement"("productionId");

-- CreateIndex
CREATE INDEX "Availability_userId_startAt_idx" ON "Availability"("userId", "startAt");

-- CreateIndex
CREATE INDEX "Script_productionId_idx" ON "Script"("productionId");

-- CreateIndex
CREATE INDEX "ScriptImport_scriptId_status_idx" ON "ScriptImport"("scriptId", "status");

-- CreateIndex
CREATE INDEX "Scene_actId_idx" ON "Scene"("actId");

-- CreateIndex
CREATE INDEX "SceneBlock_sceneId_order_idx" ON "SceneBlock"("sceneId", "order");

-- CreateIndex
CREATE INDEX "SceneBlock_characterId_idx" ON "SceneBlock"("characterId");

-- CreateIndex
CREATE INDEX "ScriptVersion_scriptId_idx" ON "ScriptVersion"("scriptId");

-- CreateIndex
CREATE INDEX "Annotation_sceneId_idx" ON "Annotation"("sceneId");

-- CreateIndex
CREATE INDEX "Annotation_anchorBlockId_idx" ON "Annotation"("anchorBlockId");

-- CreateIndex
CREATE INDEX "Role_productionId_idx" ON "Role"("productionId");

-- CreateIndex
CREATE UNIQUE INDEX "CastAssignment_roleId_membershipId_key" ON "CastAssignment"("roleId", "membershipId");

-- CreateIndex
CREATE UNIQUE INDEX "SceneRole_sceneId_roleId_key" ON "SceneRole"("sceneId", "roleId");

-- CreateIndex
CREATE INDEX "MusicTrack_productionId_idx" ON "MusicTrack"("productionId");

-- CreateIndex
CREATE INDEX "MusicTrack_assetId_idx" ON "MusicTrack"("assetId");

-- CreateIndex
CREATE INDEX "MusicCue_sceneId_idx" ON "MusicCue"("sceneId");

-- CreateIndex
CREATE INDEX "MusicCue_anchorBlockId_idx" ON "MusicCue"("anchorBlockId");

-- CreateIndex
CREATE INDEX "MusicCue_productionId_order_idx" ON "MusicCue"("productionId", "order");

-- CreateIndex
CREATE INDEX "StagePlan_productionId_idx" ON "StagePlan"("productionId");

-- CreateIndex
CREATE INDEX "StageSceneNote_sceneId_idx" ON "StageSceneNote"("sceneId");

-- CreateIndex
CREATE UNIQUE INDEX "StageSceneNote_stagePlanId_sceneId_key" ON "StageSceneNote"("stagePlanId", "sceneId");

-- CreateIndex
CREATE INDEX "ScheduleEvent_productionId_startAt_idx" ON "ScheduleEvent"("productionId", "startAt");

-- CreateIndex
CREATE UNIQUE INDEX "EventScene_eventId_sceneId_key" ON "EventScene"("eventId", "sceneId");

-- CreateIndex
CREATE UNIQUE INDEX "EventMusicCue_eventId_cueId_key" ON "EventMusicCue"("eventId", "cueId");

-- CreateIndex
CREATE UNIQUE INDEX "Attendance_eventId_membershipId_key" ON "Attendance"("eventId", "membershipId");

-- CreateIndex
CREATE INDEX "RunSheet_productionId_idx" ON "RunSheet"("productionId");

-- CreateIndex
CREATE UNIQUE INDEX "RunSheet_eventId_version_key" ON "RunSheet"("eventId", "version");

-- CreateIndex
CREATE INDEX "RunSheetItem_runSheetId_order_idx" ON "RunSheetItem"("runSheetId", "order");

-- CreateIndex
CREATE INDEX "RunSheetItem_sceneId_idx" ON "RunSheetItem"("sceneId");

-- CreateIndex
CREATE INDEX "RunSheetItem_cueId_idx" ON "RunSheetItem"("cueId");

-- CreateIndex
CREATE INDEX "RunSheetItem_staffDiscipline_idx" ON "RunSheetItem"("staffDiscipline");

-- CreateIndex
CREATE INDEX "ReadingSession_productionId_idx" ON "ReadingSession"("productionId");

-- CreateIndex
CREATE INDEX "ReadingSession_eventId_idx" ON "ReadingSession"("eventId");

-- CreateIndex
CREATE INDEX "ReadingSession_runSheetId_idx" ON "ReadingSession"("runSheetId");

-- CreateIndex
CREATE INDEX "CueFireLog_sessionId_firedAt_idx" ON "CueFireLog"("sessionId", "firedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ChecklistPhase_productionId_phase_key" ON "ChecklistPhase"("productionId", "phase");

-- CreateIndex
CREATE INDEX "ChecklistItem_phaseId_status_idx" ON "ChecklistItem"("phaseId", "status");

-- CreateIndex
CREATE INDEX "ChecklistItem_eventId_idx" ON "ChecklistItem"("eventId");

-- CreateIndex
CREATE UNIQUE INDEX "ChecklistAssignment_itemId_membershipId_key" ON "ChecklistAssignment"("itemId", "membershipId");

-- CreateIndex
CREATE INDEX "Notification_userId_readAt_idx" ON "Notification"("userId", "readAt");

-- CreateIndex
CREATE INDEX "ActivityLog_productionId_createdAt_idx" ON "ActivityLog"("productionId", "createdAt");

-- CreateIndex
CREATE INDEX "Asset_productionId_idx" ON "Asset"("productionId");

-- CreateIndex
CREATE INDEX "Asset_ownerId_idx" ON "Asset"("ownerId");

-- AddForeignKey
ALTER TABLE "Production" ADD CONSTRAINT "Production_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_productionId_fkey" FOREIGN KEY ("productionId") REFERENCES "Production"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MembershipRole" ADD CONSTRAINT "MembershipRole_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "Membership"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffAssignment" ADD CONSTRAINT "StaffAssignment_productionId_fkey" FOREIGN KEY ("productionId") REFERENCES "Production"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffAssignment" ADD CONSTRAINT "StaffAssignment_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "Membership"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invitation" ADD CONSTRAINT "Invitation_productionId_fkey" FOREIGN KEY ("productionId") REFERENCES "Production"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PositionRequirement" ADD CONSTRAINT "PositionRequirement_productionId_fkey" FOREIGN KEY ("productionId") REFERENCES "Production"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Availability" ADD CONSTRAINT "Availability_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Script" ADD CONSTRAINT "Script_productionId_fkey" FOREIGN KEY ("productionId") REFERENCES "Production"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScriptImport" ADD CONSTRAINT "ScriptImport_scriptId_fkey" FOREIGN KEY ("scriptId") REFERENCES "Script"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScriptImport" ADD CONSTRAINT "ScriptImport_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Act" ADD CONSTRAINT "Act_scriptId_fkey" FOREIGN KEY ("scriptId") REFERENCES "Script"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Scene" ADD CONSTRAINT "Scene_actId_fkey" FOREIGN KEY ("actId") REFERENCES "Act"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SceneBlock" ADD CONSTRAINT "SceneBlock_sceneId_fkey" FOREIGN KEY ("sceneId") REFERENCES "Scene"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SceneBlock" ADD CONSTRAINT "SceneBlock_characterId_fkey" FOREIGN KEY ("characterId") REFERENCES "Role"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScriptVersion" ADD CONSTRAINT "ScriptVersion_scriptId_fkey" FOREIGN KEY ("scriptId") REFERENCES "Script"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Annotation" ADD CONSTRAINT "Annotation_sceneId_fkey" FOREIGN KEY ("sceneId") REFERENCES "Scene"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Annotation" ADD CONSTRAINT "Annotation_anchorBlockId_fkey" FOREIGN KEY ("anchorBlockId") REFERENCES "SceneBlock"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Role" ADD CONSTRAINT "Role_productionId_fkey" FOREIGN KEY ("productionId") REFERENCES "Production"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CastAssignment" ADD CONSTRAINT "CastAssignment_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CastAssignment" ADD CONSTRAINT "CastAssignment_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "Membership"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SceneRole" ADD CONSTRAINT "SceneRole_sceneId_fkey" FOREIGN KEY ("sceneId") REFERENCES "Scene"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SceneRole" ADD CONSTRAINT "SceneRole_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MusicTrack" ADD CONSTRAINT "MusicTrack_productionId_fkey" FOREIGN KEY ("productionId") REFERENCES "Production"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MusicTrack" ADD CONSTRAINT "MusicTrack_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MusicCue" ADD CONSTRAINT "MusicCue_productionId_fkey" FOREIGN KEY ("productionId") REFERENCES "Production"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MusicCue" ADD CONSTRAINT "MusicCue_trackId_fkey" FOREIGN KEY ("trackId") REFERENCES "MusicTrack"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MusicCue" ADD CONSTRAINT "MusicCue_sceneId_fkey" FOREIGN KEY ("sceneId") REFERENCES "Scene"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MusicCue" ADD CONSTRAINT "MusicCue_anchorBlockId_fkey" FOREIGN KEY ("anchorBlockId") REFERENCES "SceneBlock"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StagePlan" ADD CONSTRAINT "StagePlan_productionId_fkey" FOREIGN KEY ("productionId") REFERENCES "Production"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StageElement" ADD CONSTRAINT "StageElement_stagePlanId_fkey" FOREIGN KEY ("stagePlanId") REFERENCES "StagePlan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StageSceneNote" ADD CONSTRAINT "StageSceneNote_stagePlanId_fkey" FOREIGN KEY ("stagePlanId") REFERENCES "StagePlan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StageSceneNote" ADD CONSTRAINT "StageSceneNote_sceneId_fkey" FOREIGN KEY ("sceneId") REFERENCES "Scene"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduleEvent" ADD CONSTRAINT "ScheduleEvent_productionId_fkey" FOREIGN KEY ("productionId") REFERENCES "Production"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventScene" ADD CONSTRAINT "EventScene_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "ScheduleEvent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventScene" ADD CONSTRAINT "EventScene_sceneId_fkey" FOREIGN KEY ("sceneId") REFERENCES "Scene"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventMusicCue" ADD CONSTRAINT "EventMusicCue_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "ScheduleEvent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventMusicCue" ADD CONSTRAINT "EventMusicCue_cueId_fkey" FOREIGN KEY ("cueId") REFERENCES "MusicCue"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attendance" ADD CONSTRAINT "Attendance_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "ScheduleEvent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attendance" ADD CONSTRAINT "Attendance_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "Membership"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RunSheet" ADD CONSTRAINT "RunSheet_productionId_fkey" FOREIGN KEY ("productionId") REFERENCES "Production"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RunSheet" ADD CONSTRAINT "RunSheet_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "ScheduleEvent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RunSheetItem" ADD CONSTRAINT "RunSheetItem_runSheetId_fkey" FOREIGN KEY ("runSheetId") REFERENCES "RunSheet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RunSheetItem" ADD CONSTRAINT "RunSheetItem_sceneId_fkey" FOREIGN KEY ("sceneId") REFERENCES "Scene"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RunSheetItem" ADD CONSTRAINT "RunSheetItem_cueId_fkey" FOREIGN KEY ("cueId") REFERENCES "MusicCue"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RunSheetItem" ADD CONSTRAINT "RunSheetItem_stageSceneNoteId_fkey" FOREIGN KEY ("stageSceneNoteId") REFERENCES "StageSceneNote"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RunSheetItem" ADD CONSTRAINT "RunSheetItem_checklistItemId_fkey" FOREIGN KEY ("checklistItemId") REFERENCES "ChecklistItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RunSheetItem" ADD CONSTRAINT "RunSheetItem_ownerMembershipId_fkey" FOREIGN KEY ("ownerMembershipId") REFERENCES "Membership"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReadingSession" ADD CONSTRAINT "ReadingSession_productionId_fkey" FOREIGN KEY ("productionId") REFERENCES "Production"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReadingSession" ADD CONSTRAINT "ReadingSession_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "ScheduleEvent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReadingSession" ADD CONSTRAINT "ReadingSession_runSheetId_fkey" FOREIGN KEY ("runSheetId") REFERENCES "RunSheet"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CueFireLog" ADD CONSTRAINT "CueFireLog_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "ReadingSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CueFireLog" ADD CONSTRAINT "CueFireLog_cueId_fkey" FOREIGN KEY ("cueId") REFERENCES "MusicCue"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChecklistPhase" ADD CONSTRAINT "ChecklistPhase_productionId_fkey" FOREIGN KEY ("productionId") REFERENCES "Production"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChecklistItem" ADD CONSTRAINT "ChecklistItem_phaseId_fkey" FOREIGN KEY ("phaseId") REFERENCES "ChecklistPhase"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChecklistItem" ADD CONSTRAINT "ChecklistItem_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "ScheduleEvent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChecklistAssignment" ADD CONSTRAINT "ChecklistAssignment_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "ChecklistItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChecklistAssignment" ADD CONSTRAINT "ChecklistAssignment_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "Membership"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_productionId_fkey" FOREIGN KEY ("productionId") REFERENCES "Production"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActivityLog" ADD CONSTRAINT "ActivityLog_productionId_fkey" FOREIGN KEY ("productionId") REFERENCES "Production"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Asset" ADD CONSTRAINT "Asset_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Asset" ADD CONSTRAINT "Asset_productionId_fkey" FOREIGN KEY ("productionId") REFERENCES "Production"("id") ON DELETE SET NULL ON UPDATE CASCADE;
