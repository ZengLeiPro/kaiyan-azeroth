import { createContext, useContext } from 'react';

/**
 * 为嵌套在 Sheet/Dialog 内的 Portal 组件（Popover、Tooltip 等）提供 portal 容器。
 *
 * 问题：Radix Sheet（modal Dialog）会创建焦点陷阱，而 Popover 默认 portal 到 document.body（Dialog DOM 外），
 * 导致 Dialog 拦截 Popover 内的交互（点击无效 / 焦点被抢回）。
 *
 * 解决：SheetContent 提供一个 DOM 节点作为 portal 容器，Popover 消费后 portal 到该节点内，
 * 使 Popover 内容留在 Dialog 的焦点作用域内。
 */
const PortalContainerContext = createContext<HTMLElement | undefined>(undefined);

export function usePortalContainer() {
  return useContext(PortalContainerContext);
}

export { PortalContainerContext };
