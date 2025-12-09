CREATE TABLE `edit_history` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`thought_id` integer,
	`content_snapshot` text NOT NULL,
	`timestamp` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`delta_type` text
);
