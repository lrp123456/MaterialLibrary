/**
 * 限流（SOLO 版）。
 *
 * 原实现依赖 Upstash Redis。内网单用户部署不需要分布式限流，
 * 而保留 Redis 依赖会让构建在没有该包的机器上直接失败。
 * 这里退化为内存计数：同一 IP 每分钟 300 次，超了才拒绝。
 * 需要多机共享限流时，再把 Upstash 加回来。
 */
const WINDOW_MS = 60_000;
const LIMIT = 300;

const buckets = new Map<string, { count: number; resetAt: number }>();

export const baseRateLimit = {
	async limit(key: string) {
		const now = Date.now();
		const bucket = buckets.get(key);
		if (!bucket || bucket.resetAt <= now) {
			buckets.set(key, { count: 1, resetAt: now + WINDOW_MS });
			return { success: true };
		}
		bucket.count += 1;
		return { success: bucket.count <= LIMIT };
	},
};

export async function checkRateLimit({ request }: { request: Request }) {
	const ip = request.headers.get("x-forwarded-for") ?? "anonymous";
	const { success } = await baseRateLimit.limit(ip);
	return { success, limited: !success };
}
