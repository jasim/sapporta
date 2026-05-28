CREATE TABLE `accounts` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `name` text NOT NULL,
  `type` text NOT NULL,
  `balance` integer,
  `created_at` text,
  `updated_at` text
);
--> statement-breakpoint
CREATE TABLE `agents` (
  `id` text PRIMARY KEY NOT NULL,
  `name` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `articles` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `title` text NOT NULL,
  `body` text NOT NULL,
  `status` text NOT NULL,
  `created_at` text,
  `updated_at` text
);
--> statement-breakpoint
CREATE TABLE `audit_log` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `event` text NOT NULL,
  `detail` text,
  `created_at` text
);
--> statement-breakpoint
CREATE TABLE `journal_entries` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `account_id` integer NOT NULL,
  `description` text NOT NULL,
  `amount` integer NOT NULL,
  `created_at` text
);
