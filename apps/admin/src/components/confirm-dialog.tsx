import { useState } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

type ConfirmDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  confirmText?: string;
  cancelText?: string;
  /** 删除等危险操作：确认钮用 destructive 红色样式。 */
  danger?: boolean;
  /**
   * 外部 pending 态（如 mutation.isPending），传入时确认钮禁用防重复提交；
   * 不传时若 onConfirm 返回 Promise 则由组件内接管。
   */
  pending?: boolean;
  /** 返回 Promise 时由组件接管 pending 态，落定后自动关闭。 */
  onConfirm: () => unknown;
};

/**
 * 统一确认弹窗，替代浏览器原生确认框。
 * AlertDialog 语义：ESC / 点遮罩不可关闭，只能通过按钮决定，防误触。
 * onConfirm 返回 Promise 时按钮显示 pending 态，落定后自动关闭
 * （reject 视为已取消执行，错误提示由调用方的 toast 负责）。
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmText = "确认",
  cancelText = "取消",
  danger = false,
  pending = false,
  onConfirm,
}: ConfirmDialogProps) {
  const [internalPending, setInternalPending] = useState(false);
  const isPending = pending || internalPending;

  const handleConfirm = async () => {
    setInternalPending(true);
    try {
      await onConfirm();
    } catch {
      // 执行失败的提示由调用方（mutation onError 等）负责
    } finally {
      setInternalPending(false);
    }
    onOpenChange(false);
  };

  return (
    <AlertDialog onOpenChange={onOpenChange} open={open}>
      <AlertDialogContent onEscapeKeyDown={(event) => event.preventDefault()}>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isPending}>
            {cancelText}
          </AlertDialogCancel>
          <AlertDialogAction
            disabled={isPending}
            onClick={(event) => {
              // 阻止默认立即关闭：等待 onConfirm 落定后再关
              event.preventDefault();
              void handleConfirm();
            }}
            variant={danger ? "destructive" : "default"}
          >
            {isPending ? "处理中…" : confirmText}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
