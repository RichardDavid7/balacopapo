CREATE TABLE `ip_bans` (
	`id` text PRIMARY KEY NOT NULL,
	`ip` text NOT NULL,
	`reason` text,
	`banned_by` text,
	`source_user_id` text,
	`duration_days` integer,
	`expires_at` integer,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_ip_bans_ip` ON `ip_bans` (`ip`);
--> statement-breakpoint
CREATE INDEX `idx_ip_bans_expires_at` ON `ip_bans` (`expires_at`);
