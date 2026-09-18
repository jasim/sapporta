CREATE TABLE `categories` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `name` text NOT NULL,
  `parent_id` integer REFERENCES `categories`(`id`),
  `archived` integer DEFAULT false NOT NULL,
  `workspace_id` text NOT NULL,
  `scoped_to_user_id` text NOT NULL
);
