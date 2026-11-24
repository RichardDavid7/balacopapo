CREATE TABLE IF NOT EXISTS `user_oidc_links` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`issuer` text NOT NULL,
	`subject` text NOT NULL,
	`email` text,
	`preferred_username` text,
	`last_avatar_source_url` text,
	`linked_at` integer NOT NULL,
	`last_login_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `idx_user_oidc_links_issuer_subject` ON `user_oidc_links` (`issuer`,`subject`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_user_oidc_links_user_id` ON `user_oidc_links` (`user_id`);
