export const CHANGE_NOTIFICATION_TYPES = [
  "production.member_removed",
  "production.published",
  "schedule.event_created",
  "schedule.event_updated",
  "schedule.event_canceled",
  "schedule.attendance_reminder",
  "script.version_created",
  "script.version_restored",
  "music.cue_created",
  "music.cue_updated",
  "music.cue_anchor_updated",
  "music.cue_deleted",
  "checklist.waiting_approval",
  "checklist.approved",
  "checklist.rejected",
  "READING_SESSION_STARTED",
  "READING_SESSION_ENDED"
] as const;
