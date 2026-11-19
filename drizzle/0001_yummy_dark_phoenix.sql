CREATE TABLE `digest_deliveries` (
	`id` varchar(64) NOT NULL,
	`boardId` varchar(64) NOT NULL,
	`personId` varchar(64) NOT NULL,
	`singaporeDate` varchar(10) NOT NULL,
	`kind` enum('manual','scheduled') NOT NULL,
	`notificationId` varchar(64) NOT NULL,
	CONSTRAINT `digest_deliveries_id` PRIMARY KEY(`id`),
	CONSTRAINT `digest_delivery_once` UNIQUE(`boardId`,`personId`,`singaporeDate`,`kind`)
);
--> statement-breakpoint
CREATE TABLE `workspace_boards` (
	`id` varchar(64) NOT NULL,
	`data` json NOT NULL,
	CONSTRAINT `workspace_boards_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `workspace_logs` (
	`id` varchar(64) NOT NULL,
	`boardId` varchar(64) NOT NULL,
	`kind` enum('manual','scheduled','completion') NOT NULL,
	`status` varchar(64) NOT NULL,
	`message` text NOT NULL,
	`createdAt` varchar(32) NOT NULL,
	`dedupeKey` varchar(255),
	CONSTRAINT `workspace_logs_id` PRIMARY KEY(`id`),
	CONSTRAINT `workspace_logs_dedupeKey_unique` UNIQUE(`dedupeKey`)
);
--> statement-breakpoint
CREATE TABLE `workspace_meta` (
	`id` varchar(32) NOT NULL,
	`seeded` int NOT NULL DEFAULT 0,
	CONSTRAINT `workspace_meta_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `workspace_notifications` (
	`id` varchar(64) NOT NULL,
	`boardId` varchar(64) NOT NULL,
	`personId` varchar(64) NOT NULL,
	`title` varchar(255) NOT NULL,
	`body` text NOT NULL,
	`createdAt` varchar(32) NOT NULL,
	`isRead` int NOT NULL DEFAULT 0,
	`kind` enum('completion','digest') NOT NULL,
	CONSTRAINT `workspace_notifications_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `workspace_people` (
	`id` varchar(64) NOT NULL,
	`data` json NOT NULL,
	CONSTRAINT `workspace_people_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `workspace_schedules` (
	`id` varchar(32) NOT NULL,
	`taskUid` varchar(128),
	`status` varchar(32) NOT NULL DEFAULT 'not_configured',
	CONSTRAINT `workspace_schedules_id` PRIMARY KEY(`id`),
	CONSTRAINT `workspace_schedules_taskUid_unique` UNIQUE(`taskUid`)
);
