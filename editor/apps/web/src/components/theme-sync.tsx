"use client";

import { useEffect } from "react";
import { useTheme } from "next-themes";

/**
 * 与 Material Studio Pro 主系统深度双向联动：
 * 1. 响应父页面的 postMessage（MLS_THEME_CHANGE: dark | light | eye-care, seniorMode, token）
 * 2. 响应 MLS_AUTH_TOKEN，写入 localStorage 并派发 mls_token_updated 事件
 * 3. 页面载入时主动向父窗口发起 MLS_REQUEST_TOKEN 请求，确保首屏免 401
 */
export function ThemeSync() {
	const { setTheme } = useTheme();

	// 适老模式下的自定义等比缩放范围：支持 100% ~ 220% 任意自定义缩放
	const normalizeZoom = (raw: unknown) => {
		const n = Number(raw);
		if (Number.isFinite(n) && n >= 1 && n <= 2.2) return n;
		return 1.3; // 适老默认放大至 130%
	};

	useEffect(() => {
		function applyTheme(targetTheme: string, isSenior = false, zoom = 1) {
			const root = document.documentElement;
			root.classList.remove("dark", "light", "eye-care", "senior-mode");

			if (targetTheme === "eye-care") {
				root.classList.add("light", "eye-care");
				setTheme("light");
			} else if (targetTheme === "light") {
				root.classList.add("light");
				setTheme("light");
			} else {
				root.classList.add("dark");
				setTheme("dark");
			}

			if (isSenior) {
				root.classList.add("senior-mode");
				const effectiveZoom = zoom > 1 ? zoom : 1.3;
				root.style.zoom = String(effectiveZoom);
				root.style.setProperty("--senior-scale", String(effectiveZoom));
			} else {
				root.style.zoom = "";
				root.style.removeProperty("--senior-scale");
			}
		}

		function applyToken(token: string) {
			if (!token) return;
			try {
				const current = localStorage.getItem("ml_token");
				if (current !== token) {
					localStorage.setItem("ml_token", token);
					window.dispatchEvent(new CustomEvent("mls_token_updated", { detail: token }));
				}
			} catch {
				/* ignore */
			}
		}

		// 初始化读取同源 localStorage 与 URL 参数
		try {
			const search = new URLSearchParams(window.location.search);
			const urlToken = search.get("token") || search.get("ml_token");
			if (urlToken) {
				applyToken(urlToken);
			}
			const saved = localStorage.getItem("material_theme") || "dark";
			const savedSenior = localStorage.getItem("ml_senior_mode") === "true";
			const savedZoom = normalizeZoom(localStorage.getItem("ml_senior_zoom"));
			applyTheme(saved, savedSenior, savedZoom);
		} catch {
			/* ignore */
		}

		// 监听父窗口消息
		function handleMessage(event: MessageEvent) {
			if (!event.data || typeof event.data !== "object") return;

			if (event.data.type === "MLS_THEME_CHANGE") {
				const theme = typeof event.data.theme === "string" ? event.data.theme : "dark";
				const senior = Boolean(event.data.seniorMode);
				const zoom = normalizeZoom(event.data.seniorZoom ?? localStorage.getItem("ml_senior_zoom"));
				applyTheme(theme, senior, zoom);
				if (event.data.token) {
					applyToken(event.data.token);
				}
			} else if (
				(event.data.type === "MLS_AUTH_TOKEN" || event.data.type === "MLS_AUTH_SYNC") &&
				typeof event.data.token === "string"
			) {
				applyToken(event.data.token);
			}
		}

		window.addEventListener("message", handleMessage);

		// 主动向父级请求 Token 与主题
		try {
			if (window.parent && window.parent !== window) {
				window.parent.postMessage({ type: "MLS_REQUEST_TOKEN" }, "*");
			}
		} catch {
			/* ignore */
		}

		return () => {
			window.removeEventListener("message", handleMessage);
		};
	}, [setTheme]);

	return null;
}
