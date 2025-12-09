CREATE TABLE `edit_operations` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`thought_id` integer,
	`sequence_num` integer NOT NULL,
	`operation_type` text NOT NULL,
	`position` integer NOT NULL,
	`content` text NOT NULL,
	`content_length` integer NOT NULL,
	`timestamp_ms` integer NOT NULL
);
--> statement-breakpoint
DROP TABLE `edit_history`;