import { z } from "zod";

const webEnvSchema = z.object({
	// Node
	NODE_ENV: z.enum(["development", "production", "test"]),
	ANALYZE: z.string().optional(),
	NEXT_RUNTIME: z.enum(["nodejs", "edge"]).optional(),

	// Public
	NEXT_PUBLIC_SITE_URL: z.url().default("http://localhost:3000"),
	NEXT_PUBLIC_MARBLE_API_URL: z.url(),

	// Server
	DATABASE_URL: z.string().refine(
		(url) =>
			url.startsWith("postgres://") || url.startsWith("postgresql://"),
		"DATABASE_URL must be a postgres:// or postgresql:// URL",
	),

	BETTER_AUTH_SECRET: z.string(),
	UPSTASH_REDIS_REST_URL: z.url(),
	UPSTASH_REDIS_REST_TOKEN: z.string(),
	MARBLE_WORKSPACE_KEY: z.string(),
	FREESOUND_CLIENT_ID: z.string(),
	FREESOUND_API_KEY: z.string(),
});

export type WebEnv = z.infer<typeof webEnvSchema>;

/**
 * SOLO 模式（内网单用户）不需要 Postgres / Upstash / Marble / Freesound。
 * 这些变量在原版是必填的，缺一个就在 import 期抛错；这里给占位值，
 * 让编辑器能在没有外部依赖的机器上直接起来。
 */
const SOLO = process.env.OPEN_CUT_SOLO === "1";

const soloDefaults: Partial<Record<keyof WebEnv, string>> = {
	NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000",
	NEXT_PUBLIC_MARBLE_API_URL: "http://127.0.0.1:30001",
	DATABASE_URL: "postgres://solo:solo@127.0.0.1:5432/solo",
	BETTER_AUTH_SECRET: "solo-local-only-secret-please-ignore",
	UPSTASH_REDIS_REST_URL: "http://127.0.0.1:8079",
	UPSTASH_REDIS_REST_TOKEN: "solo",
	MARBLE_WORKSPACE_KEY: "solo",
	FREESOUND_CLIENT_ID: "solo",
	FREESOUND_API_KEY: "solo",
};

export const webEnv = webEnvSchema.parse({
	...(SOLO ? soloDefaults : {}),
	...process.env,
});
