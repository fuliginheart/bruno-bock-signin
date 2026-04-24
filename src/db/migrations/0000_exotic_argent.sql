CREATE TABLE `employees` (
	`id` text PRIMARY KEY NOT NULL,
	`display_name` text NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer
);
--> statement-breakpoint
CREATE TABLE `events` (
	`seq` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`id` text NOT NULL,
	`subject_type` text,
	`subject_id` text,
	`action` text NOT NULL,
	`kiosk_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`payload_json` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `events_id_unique` ON `events` (`id`);--> statement-breakpoint
CREATE INDEX `events_created_at_idx` ON `events` (`created_at`);--> statement-breakpoint
CREATE INDEX `events_subject_idx` ON `events` (`subject_type`,`subject_id`);--> statement-breakpoint
CREATE TABLE `kiosks` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`last_seen` integer NOT NULL,
	`role` text DEFAULT 'follower' NOT NULL
);
--> statement-breakpoint
CREATE TABLE `presence` (
	`subject_type` text NOT NULL,
	`subject_id` text NOT NULL,
	`on_site` integer DEFAULT false NOT NULL,
	`since` integer NOT NULL,
	`last_kiosk_id` text NOT NULL,
	PRIMARY KEY(`subject_type`, `subject_id`)
);
--> statement-breakpoint
CREATE INDEX `presence_on_site_idx` ON `presence` (`on_site`);--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `visitors` (
	`id` text PRIMARY KEY NOT NULL,
	`first_name` text NOT NULL,
	`last_name` text NOT NULL,
	`company` text NOT NULL,
	`reason` text NOT NULL,
	`host_employee_id` text,
	`photo_path` text NOT NULL,
	`signature_path` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`host_employee_id`) REFERENCES `employees`(`id`) ON UPDATE no action ON DELETE no action
);
