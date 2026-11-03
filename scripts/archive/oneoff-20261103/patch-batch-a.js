const fs = require('fs');
const path = require('path');

// 1. patch app-uniapp/src/service/ViewerApi.js
const viewerApiFile = path.resolve(__dirname, '../app-uniapp/src/service/ViewerApi.js');
if (fs.existsSync(viewerApiFile)) {
  let content = fs.readFileSync(viewerApiFile, 'utf8');
  const targetRegex = /(\/\/\s*远程 URL 先下载为临时文件[\r\n\s]+return new Promise\(\(resolve, reject\) => \{[\r\n\s]+uni\.downloadFile\(\{[\r\n\s]+url,[\r\n\s]+success: async \(res\) => \{[\r\n\s]+if \(res\.statusCode === 200 && res\.tempFilePath\) \{[\r\n\s]+try \{[\r\n\s]+const r = await saveLocalFile\(res\.tempFilePath\))/;

  if (targetRegex.test(content)) {
    const replacement = `// 改造下载 URL，在 URL 路径末尾带上标准 saveName，防止客户端截取为 image.jpg / image(x).jpg
  let downloadUrl = url;
  try {
    if (url.startsWith('http://') || url.startsWith('https://')) {
      const u = new URL(url);
      if (u.pathname.endsWith('/image') || u.pathname.endsWith('/file')) {
        u.pathname = \`\${u.pathname}/\${encodeURIComponent(saveName)}\`;
        u.searchParams.set('download', '1');
        downloadUrl = u.toString();
      }
    }
  } catch (_) {}

  // 远程 URL 先下载为临时文件
  return new Promise((resolve, reject) => {
    uni.downloadFile({
      url: downloadUrl,
      success: async (res) => {
        if (res.statusCode === 200 && res.tempFilePath) {
          try {
            let targetPath = res.tempFilePath;
            if (typeof plus !== 'undefined' && plus.io && plus.io.resolveLocalFileSystemURL) {
              try {
                targetPath = await new Promise((resMove) => {
                  plus.io.resolveLocalFileSystemURL(res.tempFilePath, (entry) => {
                    plus.io.requestFileSystem(plus.io.PRIVATE_DOC, (fsSys) => {
                      fsSys.root.getDirectory('exports', { create: true }, (dir) => {
                        entry.moveTo(dir, saveName, (newEntry) => {
                          resMove(newEntry.toLocalURL ? newEntry.toLocalURL() : newEntry.fullPath);
                        }, () => resMove(res.tempFilePath));
                      }, () => resMove(res.tempFilePath));
                    }, () => resMove(res.tempFilePath));
                  }, () => resMove(res.tempFilePath));
                });
              } catch (_) {}
            }
            const r = await saveLocalFile(targetPath)`;

    content = content.replace(targetRegex, replacement);
    fs.writeFileSync(viewerApiFile, content, 'utf8');
    console.log('[PASS] ViewerApi.js updated');
  } else {
    console.log('[INFO] ViewerApi.js target pattern not matched or already updated');
  }
}

// 2. patch app-uniapp/src/common/prior-runtime.js
const priorRuntimeFile = path.resolve(__dirname, '../app-uniapp/src/common/prior-runtime.js');
if (fs.existsSync(priorRuntimeFile)) {
  let content = fs.readFileSync(priorRuntimeFile, 'utf8');
  const targetRegex = /(if \(!url\.startsWith\("http:\/\/"\) && !url\.startsWith\("https:\/\/"\)\) \{[\r\n\s]+return saveLocalFile\(url\);[\r\n\s]+\}[\r\n\s]+return new Promise\(\(resolve, reject\) => \{[\r\n\s]+uni\.downloadFile\(\{[\r\n\s]+url,[\r\n\s]+success: async \(res\) => \{[\r\n\s]+if \(res\.statusCode === 200 && res\.tempFilePath\) \{[\r\n\s]+try \{[\r\n\s]+const r = await saveLocalFile\(res\.tempFilePath\);)/;

  if (targetRegex.test(content)) {
    const replacement = `if (!url.startsWith("http://") && !url.startsWith("https://")) {
    return saveLocalFile(url);
  }
  // 改造下载 URL，在 URL 路径末尾带上标准 saveName
  let downloadUrl = url;
  try {
    if (url.startsWith("http://") || url.startsWith("https://")) {
      const u = new URL(url);
      if (u.pathname.endsWith("/image") || u.pathname.endsWith("/file")) {
        u.pathname = \`\${u.pathname}/\${encodeURIComponent(saveName)}\`;
        u.searchParams.set("download", "1");
        downloadUrl = u.toString();
      }
    }
  } catch (_) {}

  return new Promise((resolve, reject) => {
    uni.downloadFile({
      url: downloadUrl,
      success: async (res) => {
        if (res.statusCode === 200 && res.tempFilePath) {
          try {
            let targetPath = res.tempFilePath;
            if (typeof plus !== "undefined" && plus.io && plus.io.resolveLocalFileSystemURL) {
              try {
                targetPath = await new Promise((resMove) => {
                  plus.io.resolveLocalFileSystemURL(res.tempFilePath, (entry) => {
                    plus.io.requestFileSystem(plus.io.PRIVATE_DOC, (fsSys) => {
                      fsSys.root.getDirectory("exports", { create: true }, (dir) => {
                        entry.moveTo(dir, saveName, (newEntry) => {
                          resMove(newEntry.toLocalURL ? newEntry.toLocalURL() : newEntry.fullPath);
                        }, () => resMove(res.tempFilePath));
                      }, () => resMove(res.tempFilePath));
                    }, () => resMove(res.tempFilePath));
                  }, () => resMove(res.tempFilePath));
                });
              } catch (_) {}
            }
            const r = await saveLocalFile(targetPath);`;

    content = content.replace(targetRegex, replacement);
    fs.writeFileSync(priorRuntimeFile, content, 'utf8');
    console.log('[PASS] prior-runtime.js updated');
  } else {
    console.log('[INFO] prior-runtime.js target pattern not matched or already updated');
  }
}
