/**
 * 轻量词级 Diff 算法
 * 对比两段文本，计算增删差异（删除线 / 增词高亮 / 无变化）
 */
function tokenize(text) {
  if (!text) return [];
  // 中文字符或标点每个独立，英文/数字按单词切分
  const tokens = [];
  const regex = /[\u4e00-\u9fa5]|[a-zA-Z0-9_-]+|[^\s\u4e00-\u9fa5a-zA-Z0-9_-]|\s+/g;
  let match;
  while ((match = regex.exec(text)) !== null) {
    tokens.push(match[0]);
  }
  return tokens;
}

export function computeWordDiff(oldText, newText) {
  if (!oldText && !newText) return [];
  if (!oldText) return [{ type: 'add', text: newText }];
  if (!newText) return [{ type: 'del', text: oldText }];
  if (oldText === newText) return [{ type: 'same', text: newText }];

  const a = tokenize(oldText);
  const b = tokenize(newText);
  const n = a.length;
  const m = b.length;

  // 限制复杂度：若特别长则直接回退
  if (n * m > 250000) {
    return [{ type: 'same', text: newText }];
  }

  // 动态规划 LCS
  const dp = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < m; j++) {
      if (a[i] === b[j]) {
        dp[i + 1][j + 1] = dp[i][j] + 1;
      } else {
        dp[i + 1][j + 1] = Math.max(dp[i + 1][j], dp[i][j + 1]);
      }
    }
  }

  // 回溯生成 diff
  let i = n;
  let j = m;
  const rawDiff = [];
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && a[i - 1] === b[j - 1]) {
      rawDiff.push({ type: 'same', text: a[i - 1] });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      rawDiff.push({ type: 'add', text: b[j - 1] });
      j--;
    } else if (i > 0 && (j === 0 || dp[i][j - 1] < dp[i - 1][j])) {
      rawDiff.push({ type: 'del', text: a[i - 1] });
      i--;
    }
  }

  rawDiff.reverse();

  // 合并相同类型的相邻片段
  const merged = [];
  for (const part of rawDiff) {
    if (merged.length > 0 && merged[merged.length - 1].type === part.type) {
      merged[merged.length - 1].text += part.text;
    } else {
      merged.push({ ...part });
    }
  }
  return merged;
}
