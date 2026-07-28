CREATE TABLE `user_progress` (
	`user_id` text PRIMARY KEY NOT NULL,
	`progress_json` text NOT NULL,
	`revision` integer DEFAULT 0 NOT NULL,
	`updated_at` integer NOT NULL
);
