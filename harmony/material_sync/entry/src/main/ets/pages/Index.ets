import { common } from '@kit.AbilityKit';
import { promptAction } from '@kit.ArkUI';
import { MaterialApi, setBaseUrl, BASE_URL } from '../services/Api';
import { pickOriginals, PickedPhoto } from '../services/GalleryPicker';
import { requestGalleryAcl, registerChange } from '../services/GalleryWatch';

interface UploadItem {
  name: string;
  status: string;
  pct: number;
}

@Entry
@Component
struct Index {
  @State baseUrl: string = BASE_URL;
  @State username: string = 'admin';
  @State password: string = '';
  @State loggedIn: boolean = false;
  @State busy: boolean = false;
  @State hint: string = '一期：从相册选择原图，直传素材库，不经夸克。';
  @State items: UploadItem[] = [];
  @State autoWatch: boolean = false;
  private api: MaterialApi = new MaterialApi();

  build() {
    Column() {
      Text('素材库同步')
        .fontSize(22)
        .fontWeight(FontWeight.Bold)
        .fontColor('#E8ECF4')
        .margin({ bottom: 4 })
      Text(this.hint)
        .fontSize(12)
        .fontColor('#9AA3B5')
        .margin({ bottom: 16 })

      TextInput({ placeholder: '素材库地址，如 http://192.168.1.12:8787', text: this.baseUrl })
        .onChange((v: string) => { this.baseUrl = v; })
        .backgroundColor('#181C22')
        .fontColor('#E8ECF4')
        .margin({ bottom: 8 })
      TextInput({ placeholder: '用户名', text: this.username })
        .onChange((v: string) => { this.username = v; })
        .backgroundColor('#181C22')
        .fontColor('#E8ECF4')
        .margin({ bottom: 8 })
      TextInput({ placeholder: '密码', text: this.password })
        .type(InputType.Password)
        .onChange((v: string) => { this.password = v; })
        .backgroundColor('#181C22')
        .fontColor('#E8ECF4')
        .margin({ bottom: 12 })

      if (!this.loggedIn) {
        Button('登录素材库')
          .width('100%')
          .backgroundColor('#4D8EFF')
          .enabled(!this.busy)
          .onClick(() => { this.doLogin(); })
      } else {
        Button('从相册选择原图并上传')
          .width('100%')
          .backgroundColor('#4D8EFF')
          .enabled(!this.busy)
          .onClick(() => { this.doPickAndUpload(); })
        Row() {
          Toggle({ type: ToggleType.Switch, isOn: this.autoWatch })
            .onChange((v: boolean) => { this.toggleWatch(v); })
          Text('二期：自动发现新照片（需图库 ACL）')
            .fontSize(12)
            .fontColor('#9AA3B5')
            .margin({ left: 8 })
        }
        .margin({ top: 12 })
      }

      ForEach(this.items, (it: UploadItem) => {
        Row() {
          Text(it.name).fontSize(12).fontColor('#E8ECF4').layoutWeight(1)
          Text(`${it.status} ${it.pct}%`).fontSize(11).fontColor('#4D8EFF')
        }
        .width('100%')
        .padding(8)
        .margin({ top: 6 })
        .backgroundColor('#181C22')
        .borderRadius(8)
      }, (it: UploadItem) => it.name)
    }
    .width('100%')
    .height('100%')
    .padding(20)
    .backgroundColor('#10141A')
    .justifyContent(FlexAlign.Start)
    .alignItems(HorizontalAlign.Start)
  }

  async doLogin(): Promise<void> {
    this.busy = true;
    try {
      setBaseUrl(this.baseUrl);
      await this.api.login(this.username, this.password);
      this.loggedIn = true;
      this.hint = '已登录。点按钮从相册选原图，成功后服务端可备份到网盘/NAS。';
    } catch (e) {
      promptAction.showToast({ message: `登录失败: ${JSON.stringify(e)}` });
    } finally {
      this.busy = false;
    }
  }

  async doPickAndUpload(): Promise<void> {
    const ctx = getContext(this) as common.UIAbilityContext;
    this.busy = true;
    try {
      const photos: PickedPhoto[] = await pickOriginals(ctx, 50);
      this.items = photos.map((p: PickedPhoto): UploadItem => {
        return { name: p.fileName, status: '排队', pct: 0 };
      });
      for (let i = 0; i < photos.length; i++) {
        const p = photos[i];
        this.items[i].status = '上传中';
        try {
          await this.api.ingestFile(p.sandboxPath, p.fileName, p.uri, (pct: number) => {
            this.items[i].pct = pct;
          });
          this.items[i].status = '已入库';
          this.items[i].pct = 100;
        } catch (e) {
          this.items[i].status = '失败';
          promptAction.showToast({ message: `${p.fileName} 失败` });
        }
      }
      this.hint = '本批完成。失败的可再选一次（相同相册 URI 会幂等跳过）。';
    } catch (e) {
      promptAction.showToast({ message: '选择相册失败' });
    } finally {
      this.busy = false;
    }
  }

  async toggleWatch(on: boolean): Promise<void> {
    this.autoWatch = on;
    if (!on) {
      return;
    }
    const ctx = getContext(this) as common.UIAbilityContext;
    const ok = await requestGalleryAcl(ctx);
    if (!ok) {
      this.autoWatch = false;
      promptAction.showToast({ message: '未获得图库 ACL。上架需华为审核；侧载可在 DevEco 调试签名里授权。' });
      return;
    }
    registerChange(() => {
      promptAction.showToast({ message: '检测到相册变更，请点选择上传（自动上传可在二期接上）。' });
    });
  }
}
