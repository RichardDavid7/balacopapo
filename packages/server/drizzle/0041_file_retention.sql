ALTER TABLE `spaces` ADD `allow_file_retention` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE `spaces` ADD `file_retention_enabled` integer DEFAULT 0 NOT NULL;
