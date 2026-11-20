/**
 * SOLO 模式（OPEN_CUT_SOLO=1）：内网单用户部署，不接 Postgres / Upstash / better-auth。
 * 直接返回一个本地会话，避免为了一个本地工具去跑一整套账号体系。
 *
 * 非 SOLO 时才会加载真正的 better-auth。这里用 webpackIgnore 动态 import，
 * 是为了让 SOLO 构建在**没有安装 better-auth** 的机器上也能通过 ——
 * 我们这份 fork 的依赖里已经把它摘掉了，需要多用户时再装回去。
 */
const SOLO = process.env.OPEN_CUT_SOLO !== "0";

const soloUser = {
	id: "local-user",
	name: "本地用户",
	email: "local@localhost",
	emailVerified: true,
	image: null,
	createdAt: new Date(0).toISOString(),
	updatedAt: new Date().toISOString(),
};

const soloSession = {
	id: "local-session",
	userId: "local-user",
	token: "local-solo",
	expiresAt: new Date(Date.now() + 10 * 365 * 24 * 3600 * 1000).toISOString(),
	createdAt: new Date(0).toISOString(),
	updatedAt: new Date().toISOString(),
	ipAddress: "127.0.0.1",
	userAgent: "solo",
};

function soloHandler(req: Request): Response {
	const path = new URL(req.url).pathname.replace(/^\/editor/, "");
	if (path.endsWith("/get-session")) {
		return Response.json({ session: soloSession, user: soloUser });
	}
	if (path.endsWith("/sign-out")) {
		return Response.json({ success: true });
	}
	return Response.json({ ok: true, solo: true });
}

async function realHandler(_req: Request): Promise<Response> {
	// 本 fork 已移除 better-auth / Postgres / Upstash（见 FORK.md）。
	// 需要多用户时，从上游恢复 src/auth/* 与依赖后，把这里改回 toNextJsHandler(auth)。
	return Response.json(
		{
			error:
				"多用户鉴权未启用：本构建为 SOLO 模式。若需恢复，请参考 FORK.md「恢复多用户」一节。",
		},
		{ status: 501 },
	);
}

export async function GET(req: Request): Promise<Response> {
	if (SOLO) return soloHandler(req);
	return realHandler(req);
}

export async function POST(req: Request): Promise<Response> {
	if (SOLO) return soloHandler(req);
	return realHandler(req);
}
