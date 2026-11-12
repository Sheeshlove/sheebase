import { pgEnum } from 'drizzle-orm/pg-core';

// Перечисления PostgreSQL (docs/SPEC.md, 7.1). Порядок значений — как в спецификации.

export const emailTokenPurpose = pgEnum('email_token_purpose', ['verify_email', 'reset_password']);
export const workspaceKind = pgEnum('workspace_kind', ['personal', 'team']);
export const workspacePlan = pgEnum('workspace_plan', ['student', 'team', 'org', 'guest']);
export const memberRole = pgEnum('member_role', ['owner', 'editor', 'viewer']);
export const pageKind = pgEnum('page_kind', ['document', 'board']);
export const snapshotReason = pgEnum('snapshot_reason', ['auto', 'before_restore', 'manual']);
export const taskStatus = pgEnum('task_status', ['draft', 'todo', 'in_progress', 'review', 'done']);
export const taskOrigin = pgEnum('task_origin', ['manual', 'ai']);
export const linkEndpointKind = pgEnum('link_endpoint_kind', ['page', 'block', 'board_item', 'task']);
export const linkRelation = pgEnum('link_relation', ['source', 'related', 'generated_from', 'mention']);
export const importKind = pgEnum('import_kind', ['docx', 'pdf', 'markdown', 'notion']);
export const importStatus = pgEnum('import_status', ['queued', 'running', 'done', 'failed']);
export const aiRunStatus = pgEnum('ai_run_status', [
  'queued',
  'segmenting',
  'extracting',
  'merging',
  'layouting',
  'writing',
  'done',
  'failed',
  'cancelled',
]);
export const feedbackKind = pgEnum('feedback_kind', ['general', 'survey_7d']);
