import { photoAccessHelper } from '@kit.MediaLibraryKit';
import { fileIo, fileUri } from '@kit.CoreFileKit';
import { common } from '@kit.AbilityKit';

export interface PickedPhoto {
  uri: string;
  fileName: string;
  sandboxPath: string;
}

/**
 * 一期：系统相册选择器。不需要 READ_IMAGEVIDEO ACL，可上架。
 * 用户点选后拿到 URI，拷进应用沙箱再上传原文件。
 */
export async function pickOriginals(context: common.UIAbilityContext, maxCount: number = 50): Promise<PickedPhoto[]> {
  const picker = new photoAccessHelper.PhotoViewPicker();
  const result = await picker.select({
    MIMEType: photoAccessHelper.PhotoViewMIMETypes.IMAGE_TYPE,
    maxSelectNumber: maxCount
  });
  const uris = result.photoUris ?? [];
  const out: PickedPhoto[] = [];
  const destDir = `${context.cacheDir}/picked`;
  try {
    fileIo.mkdirSync(destDir);
  } catch (_e) {
    // already exists
  }
  for (let i = 0; i < uris.length; i++) {
    const uri = uris[i];
    const name = `photo_${Date.now()}_${i}.jpg`;
    const dest = `${destDir}/${name}`;
    await copyUriToSandbox(uri, dest);
    out.push({ uri, fileName: name, sandboxPath: dest });
  }
  return out;
}

async function copyUriToSandbox(uri: string, dest: string): Promise<void> {
  const srcFile = fileIo.openSync(uri, fileIo.OpenMode.READ_ONLY);
  try {
    const destFile = fileIo.openSync(dest, fileIo.OpenMode.READ_WRITE | fileIo.OpenMode.CREATE | fileIo.OpenMode.TRUNC);
    try {
      const stat = fileIo.statSync(srcFile.fd);
      const buf = new ArrayBuffer(Math.min(stat.size, 4 * 1024 * 1024) || 1024 * 1024);
      let remaining = stat.size;
      while (remaining > 0) {
        const n = fileIo.readSync(srcFile.fd, buf);
        if (n <= 0) {
          break;
        }
        fileIo.writeSync(destFile.fd, buf.slice(0, n));
        remaining -= n;
      }
    } finally {
      fileIo.closeSync(destFile);
    }
  } finally {
    fileIo.closeSync(srcFile);
  }
}
