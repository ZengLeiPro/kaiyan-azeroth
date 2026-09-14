import { useSearchParams } from 'react-router-dom';

export type OpportunityView = 'list' | 'board';

const URL_PARAM = 'view';

/**
 * 从 URL 读取商机页面当前视图，并提供切换函数。
 *
 * 默认 board；URL 出现 `?view=list` 时返回 list。
 * 切换 board 时清掉 URL 参数（保持默认 URL 干净）。
 */
export function useOpportunityView(): {
  view: OpportunityView;
  setView: (next: OpportunityView) => void;
} {
  const [searchParams, setSearchParams] = useSearchParams();
  const view: OpportunityView = searchParams.get(URL_PARAM) === 'list' ? 'list' : 'board';

  const setView = (next: OpportunityView) => {
    const nextParams = new URLSearchParams(searchParams);
    if (next === 'board') {
      nextParams.delete(URL_PARAM);
    } else {
      nextParams.set(URL_PARAM, next);
    }
    setSearchParams(nextParams, { replace: true });
  };

  return { view, setView };
}
