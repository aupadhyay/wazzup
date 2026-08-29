CREATE TABLE `sync_state` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
ALTER TABLE `thoughts` ADD `uuid` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `thoughts` ADD `access_level` text DEFAULT 'standard' NOT NULL;--> statement-breakpoint
ALTER TABLE `thoughts` ADD `updated_at_ms` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `thoughts` ADD `deleted_at_ms` integer;--> statement-breakpoint
ALTER TABLE `thoughts` ADD `origin_device` text;--> statement-breakpoint
UPDATE `thoughts` SET `uuid` = lower(
	hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)), 2) || '-' ||
	substr('89ab', abs(random()) % 4 + 1, 1) || substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6))
) WHERE `uuid` = '';--> statement-breakpoint
UPDATE `thoughts` SET `updated_at_ms` = CAST(strftime('%s', `timestamp`) AS INTEGER) * 1000 WHERE `updated_at_ms` = 0;--> statement-breakpoint
CREATE UNIQUE INDEX `thoughts_uuid_unique` ON `thoughts` (`uuid`);