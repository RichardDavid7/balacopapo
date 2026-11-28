ALTER TABLE `users` ADD `lastfm_username` text;
--> statement-breakpoint
ALTER TABLE `users` ADD `lastfm_show_now_playing` integer DEFAULT 1 NOT NULL;
--> statement-breakpoint
ALTER TABLE `instance_settings` ADD `lastfm_api_key` text;
