import { ThemeProvider } from "next-themes";
import "./globals.css";
import { Toaster } from "../components/ui/sonner";
import { TooltipProvider } from "../components/ui/tooltip";
import { baseMetaData } from "./metadata";
import { ThemeSync } from "@/components/theme-sync";
import { AutoSync } from "@/components/auto-sync";
import localFont from "next/font/local";

// Inter 可变字体（拉丁子集，weight 100-900）已本地化。
// 之前用 next/font/google 在线拉取，构建会因 fonts.googleapis.com 不可达而失败，
// 且失败与网络状态强相关（时好时坏）。本地化后构建完全离线。
// 来源：OpenCut 上游构建产物中的 Inter woff2（SIL OFL 许可）。
const siteFont = localFont({
	src: "../fonts/inter-var-latin.woff2",
	weight: "100 900",
	display: "swap",
});

export const metadata = {
	...baseMetaData,
	title: "剪辑工作台",
};

export default function RootLayout({
	children,
}: Readonly<{
	children: React.ReactNode;
}>) {
	return (
		<html lang="zh-CN" suppressHydrationWarning>
			<body className={`${siteFont.className} font-sans antialiased`}>
				<ThemeProvider
					attribute="class"
					defaultTheme="dark"
					disableTransitionOnChange={true}
				>
					<ThemeSync />
					<AutoSync />
					<TooltipProvider>
						<Toaster />
						{children}
					</TooltipProvider>
				</ThemeProvider>
			</body>
		</html>
	);
}
