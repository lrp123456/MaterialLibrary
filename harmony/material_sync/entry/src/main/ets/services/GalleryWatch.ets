import { photoAccessHelper } from '@kit.MediaLibraryKit';
import { abilityAccessCtrl, common, Permissions } from '@kit.AbilityKit';
import { hilog } from '@kit.PerformanceAnalysisKit';

/**
 * 二期：静默扫相册。需要 ohos.permission.READ_IMAGEVIDEO ACL。
 * 申请理由：相册备份/同步到素材库，与百度网盘、夸克网盘同类。
 * 上架前走 AppGallery ACL；侧载/调试签名可在 DevEco 里先自动授权打通。
 */
const PERM: Permissions = 'ohos.permission.READ_IMAGEVIDEO';

export async function requestGalleryAcl(context: common.UIAbilityContext): Promise<boolean> {
  const atManager = abilityAccessCtrl.createAtManager();
  const status = await atManager.checkAccessToken(context.applicationInfo.accessTokenId, PERM);
  if (status === abilityAccessCtrl.GrantStatus.PERMISSION_GRANTED) {
    return true;
  }
  const result = await atManager.requestPermissionsFromUser(context, [PERM]);
  return result.authResults[0] === abilityAccessCtrl.GrantStatus.PERMISSION_GRANTED;
}

export async function listRecentImages(limit: number = 40): Promise<Array<photoAccessHelper.PhotoAsset>> {
  const helper = photoAccessHelper.getPhotoAccessHelper(getContext(this) as common.UIAbilityContext);
  const predicates = new photoAccessHelper.MediaFetchOptions();
  // 仅图片，按添加时间倒序
  const fetchOptions: photoAccessHelper.FetchOptions = {
    fetchColumns: [
      photoAccessHelper.PhotoKeys.URI,
      photoAccessHelper.PhotoKeys.DISPLAY_NAME,
      photoAccessHelper.PhotoKeys.DATE_ADDED,
      photoAccessHelper.PhotoKeys.SIZE
    ],
    predicates: new photoAccessHelper.MediaFetchOptions() as Object
  };
  hilog.info(0x0000, 'MaterialSync', 'phase2 listRecentImages limit=%{public}d', limit);
  return [];
}

export function registerChange(callback: () => void): void {
  try {
    const helper = photoAccessHelper.getPhotoAccessHelper(getContext() as common.UIAbilityContext);
    helper.registerChange(photoAccessHelper.DefaultChangeUri.DEFAULT_PHOTO_URI, true, () => {
      callback();
    });
  } catch (e) {
    hilog.error(0x0000, 'MaterialSync', 'registerChange 需要 READ_IMAGEVIDEO ACL: %{public}s', JSON.stringify(e));
  }
}
