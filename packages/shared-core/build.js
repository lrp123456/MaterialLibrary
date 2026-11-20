import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

let esbuild;
try {
  esbuild = require('esbuild');
} catch (e) {
  const candidates = [
    path.resolve(__dirname, '../../node_modules/esbuild'),
    path.resolve(__dirname, '../../apps/web-pro/node_modules/esbuild'),
    path.resolve(__dirname, '../../apps/editor/node_modules/esbuild'),
    path.resolve(__dirname, '../../material-library-web/web-pro/node_modules/esbuild'),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) {
      esbuild = require(c);
      break;
    }
  }
}

if (!esbuild) {
  console.error('[shared-core:build] esbuild not found');
  process.exit(1);
}

const distDir = path.resolve(__dirname, 'dist');
if (!fs.existsSync(distDir)) {
  fs.mkdirSync(distDir, { recursive: true });
}

// 1. Build ESM bundle
esbuild.buildSync({
  entryPoints: [path.resolve(__dirname, 'src/index.ts')],
  format: 'esm',
  bundle: true,
  outfile: path.resolve(distDir, 'index.mjs'),
  platform: 'neutral',
  target: ['node18', 'es2022'],
});

// 2. Build CJS bundle
esbuild.buildSync({
  entryPoints: [path.resolve(__dirname, 'src/index.ts')],
  format: 'cjs',
  bundle: true,
  outfile: path.resolve(distDir, 'index.cjs'),
  platform: 'neutral',
  target: ['node18', 'es2022'],
});

// 3. Generate declaration file
const dtsContent = `export * from './src/ml-asset-core/index';
export declare const STUDIO_CONTEXT_TOKENS: number;
export declare const REPLY_RESERVE_TOKENS: number;
export declare function estimateTokens(text: string): number;
export declare function contextBudgetTokens(modelContextTokens: number | null | undefined): number;
export declare function trimChatMessages(messages: any[], budgetTokens?: number): {
  messages: any[];
  kept: number;
  dropped: number;
  tokens: number;
  budget: number;
};
export declare function isFileLikeBracket(inner: string): boolean;
export declare function chipSubmitText(tag: string): string;
export declare function paintChipFinalTag(previousTag: string, nextTag: string): string;
export declare function computeOutpaintNorm(options?: {
  nativeW?: number;
  nativeH?: number;
  targetRatio?: string;
  occupancy?: number;
  offsetX?: number;
  offsetY?: number;
}): {
  canvasW: number;
  canvasH: number;
  innerW: number;
  innerH: number;
  left: number;
  top: number;
  leftPct: number;
  rightPct: number;
  topPct: number;
  bottomPct: number;
};
export declare function detectRegionTarget(region: any): { surface: string; role: string | null } | null;
export declare function pickSchemeSlot(slots: any[], options: { surface: string; role?: string | null; spaceKey?: string }): any;
export declare function subclassForSlot(slot: any): string;
export declare function mapSchemeToRegions(scheme: any, regions: any[], options?: any): any;
export declare function buildSchemeBrowse(options?: { styles?: any[]; schemes?: any[]; leaf?: string; pick?: string }): any;
`;

fs.writeFileSync(path.resolve(distDir, 'index.d.ts'), dtsContent);
console.log('[shared-core:build] Build complete: dist/index.mjs, dist/index.cjs, dist/index.d.ts');
