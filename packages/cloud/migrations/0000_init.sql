CREATE EXTENSION IF NOT EXISTS vector;--> statement-breakpoint
CREATE TABLE "change_log" (
	"seq" bigserial PRIMARY KEY NOT NULL,
	"thought_uuid" text NOT NULL,
	"changed_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chunk_embeddings" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"chunk_id" bigint NOT NULL,
	"embedding" vector(1536) NOT NULL,
	"model" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chunk_thoughts" (
	"chunk_id" bigint NOT NULL,
	"thought_uuid" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chunks" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"content" text NOT NULL,
	"context" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "devices" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"platform" text NOT NULL,
	"token_hash" text NOT NULL,
	"sudo_secret" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"last_seen_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "edit_operations" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"thought_uuid" text NOT NULL,
	"sequence_num" integer NOT NULL,
	"operation_type" text NOT NULL,
	"position" integer NOT NULL,
	"content" text NOT NULL,
	"content_length" integer NOT NULL,
	"timestamp_ms" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pipeline_state" (
	"key" text PRIMARY KEY NOT NULL,
	"value" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "thoughts" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"uuid" text NOT NULL,
	"content" text NOT NULL,
	"metadata" text,
	"timestamp" text DEFAULT (now() AT TIME ZONE 'utc')::text NOT NULL,
	"access_level" text DEFAULT 'standard' NOT NULL,
	"updated_at_ms" bigint NOT NULL,
	"deleted_at_ms" bigint,
	"origin_device" text
);
--> statement-breakpoint
ALTER TABLE "chunk_embeddings" ADD CONSTRAINT "chunk_embeddings_chunk_id_chunks_id_fk" FOREIGN KEY ("chunk_id") REFERENCES "public"."chunks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chunk_thoughts" ADD CONSTRAINT "chunk_thoughts_chunk_id_chunks_id_fk" FOREIGN KEY ("chunk_id") REFERENCES "public"."chunks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "change_log_thought_uuid_idx" ON "change_log" USING btree ("thought_uuid");--> statement-breakpoint
CREATE INDEX "chunk_embeddings_hnsw_idx" ON "chunk_embeddings" USING hnsw ("embedding" vector_cosine_ops);--> statement-breakpoint
CREATE INDEX "chunk_thoughts_thought_uuid_idx" ON "chunk_thoughts" USING btree ("thought_uuid");--> statement-breakpoint
CREATE UNIQUE INDEX "edit_operations_thought_seq_unique" ON "edit_operations" USING btree ("thought_uuid","sequence_num");--> statement-breakpoint
CREATE UNIQUE INDEX "thoughts_uuid_unique" ON "thoughts" USING btree ("uuid");--> statement-breakpoint
CREATE INDEX "thoughts_access_level_idx" ON "thoughts" USING btree ("access_level");