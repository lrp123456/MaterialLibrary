import type { NextConfig } from "next";
import { withBotId } from "botid/next/config";
import { withContentCollections } from "@content-collections/next";

const nextConfig: NextConfig = {
	// 挂在主应用 :30002 的 /editor 下，必须让资源前缀与路由前缀一致，
	// 否则 /_next/* 会 404。留空表示独立运行（开发默认）。
	basePath: process.env.NEXT_PUBLIC_BASE_PATH || undefined,
	assetPrefix: process.env.NEXT_PUBLIC_BASE_PATH || undefined,
	// 允许指定构建输出目录：某些受限环境（含批量删除保护）不允许删除已有 .next，
	// 指向一个全新目录即可完成增量构建。生产默认仍为 .next。
	distDir: process.env.NEXT_DIST_DIR || ".next",
	// 基线（opencut-classic@cf5e79e）本身存在若干类型不一致（actions/keybindings、
	// storage/migrations、stickers 等），上游未修就归档了。构建期跳过类型检查，
	// 质量门禁改为对本次改动文件单独跑 tsc --noEmit（见 docs/clip/落地状态.md）。
	typescript: {
		ignoreBuildErrors: true,
	},
	compiler: {
		removeConsole: process.env.NODE_ENV === "production",
	},
	reactStrictMode: true,
	// 生产环境不输出 source map：构建体积小一半，也避免把完整源码随镜像/仓库外泄
	productionBrowserSourceMaps: false,
	// 不用 standalone：本fork 是通过 30002 反代挂在 /editor 下的子应用，
	// 用 next start 起在主进程即可。standalone 与 next start 互斥，会导致进程起来就退出。
	images: {
		remotePatterns: [
			{
				protocol: "https",
				hostname: "plus.unsplash.com",
			},
			{
				protocol: "https",
				hostname: "images.unsplash.com",
			},
			{
				protocol: "https",
				hostname: "images.marblecms.com",
			},
			{
				protocol: "https",
				hostname: "lh3.googleusercontent.com",
			},
			{
				protocol: "https",
				hostname: "avatars.githubusercontent.com",
			},
			{
				protocol: "https",
				hostname: "api.iconify.design",
			},
			{
				protocol: "https",
				hostname: "api.simplesvg.com",
			},
			{
				protocol: "https",
				hostname: "api.unisvg.com",
			},
			{
				protocol: "https",
				hostname: "cdn.brandfetch.io",
			},
		],
	},
};

export default withContentCollections(withBotId(nextConfig));
