CREATE TABLE `auras` (
	`id` text PRIMARY KEY NOT NULL,
	`collection` text NOT NULL,
	`image_key` text NOT NULL,
	`ar_url` text NOT NULL,
	`objects` text NOT NULL,
	`created_at` integer NOT NULL
);
