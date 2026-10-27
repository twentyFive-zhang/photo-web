import type { PublicSiteSetting } from "@photo/shared";
import { fetchApi } from "./fetch-api";

/** 页头/页脚/关于/联系共用：站点设置（失败时回退默认值）。 */
export async function loadSettings(): Promise<PublicSiteSetting> {
  try {
    return await fetchApi<PublicSiteSetting>("/settings");
  } catch {
    return {
      siteName: "江流儿摄影",
      siteDescription: "",
      about: "",
      contactEmail: null,
      wechatQrUrl: null,
      socialLinks: [],
    };
  }
}
