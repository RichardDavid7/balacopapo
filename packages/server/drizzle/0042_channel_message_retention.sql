ALTER TABLE `channels` ADD `retain_files` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `messages` ADD `retain_files` integer DEFAULT 0 NOT NULL;
