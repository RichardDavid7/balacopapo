CREATE TABLE IF NOT EXISTS `space_api_keys` (
	`id` text PRIMARY KEY NOT NULL,
	`space_id` text NOT NULL REFERENCES `spaces`(`id`) ON DELETE CASCADE,
	`name` text NOT NULL,
	`key_prefix` text NOT NULL,
	`key_hash` text NOT NULL,
	`scopes` text NOT NULL DEFAULT '["music"]',
	`created_by` text REFERENCES `users`(`id`) ON DELETE SET NULL,
	`last_used_at` integer,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `idx_space_api_keys_hash` ON `space_api_keys` (`key_hash`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_space_api_keys_space_id` ON `space_api_keys` (`space_id`);
