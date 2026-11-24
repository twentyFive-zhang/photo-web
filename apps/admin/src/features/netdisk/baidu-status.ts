import type { BaiduConnectionStatus } from "@photo/shared";
import { apiFetch } from "@/lib/api";

/**
 * 百度连接状态查询（原从 baidu-import-dialog 导出；该弹窗随 ADR 0007
 * 退役，查询对象迁到网盘 feature 下供网盘页与专辑「添加照片」共用。
 * 与外部共用 key，连接跳回后状态即时可见）。
 */
export const baiduStatusQuery = {
  queryKey: ["baidu-status"],
  queryFn: () => apiFetch<BaiduConnectionStatus>("/admin/baidu/status"),
};
