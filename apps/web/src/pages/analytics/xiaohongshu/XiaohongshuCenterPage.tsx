import { Navigate, Route, Routes } from 'react-router-dom';

import XiaohongshuAnalyticsPage from '../XiaohongshuAnalyticsPage';
import { XiaohongshuCenterProvider } from './xiaohongshu-center-context';
import { XiaohongshuCenterShell } from './XiaohongshuCenterShell';
import { XiaohongshuDatasetWorkspacePage } from './XiaohongshuDatasetWorkspacePage';

const DELIVERY_DATASETS = [
  'delivery.campaign',
  'report.campaign.offline',
  'delivery.unit',
  'report.unit.offline',
  'delivery.creative',
  'report.creative.offline',
  'delivery.ad-group',
  'report.ad-group.realtime',
  'report.note.offline',
];

const CONTENT_DATASETS = [
  'content.note',
  'report.note.offline',
  'content.spu',
  'report.spu.offline',
  'content.comment',
  'content.aigc-note',
  'asset.material-preference',
];

function CenterRoutes() {
  return (
    <XiaohongshuCenterShell>
      <Routes>
        <Route index element={<Navigate to="overview" replace />} />
        <Route path="overview" element={<XiaohongshuAnalyticsPage />} />
        <Route
          path="delivery"
          element={
            <XiaohongshuDatasetWorkspacePage
              title="投放结构"
              description="计划、单元、创意与笔记按对象配置和历史效果成对查看，点击记录可核对全部字段。"
              datasetIds={DELIVERY_DATASETS}
              initialDataset="delivery.campaign"
            />
          }
        />
        <Route
          path="content"
          element={
            <XiaohongshuDatasetWorkspacePage
              title="内容与笔记"
              description="自然内容信息与付费投放效果分开呈现；评论和算法物料明确显示白名单/按需读取边界。"
              datasetIds={CONTENT_DATASETS}
              initialDataset="content.note"
            />
          }
        />
        <Route
          path="search"
          element={
            <XiaohongshuDatasetWorkspacePage
              title="搜索与人群"
              description="从真实搜索词穿透到关键词、单元、定向和人群包；推荐词与已投关键词不混算。"
              groups={['search', 'audience']}
              initialDataset="report.search-word.offline"
            />
          }
        />
        <Route
          path="leads"
          element={
            <XiaohongshuDatasetWorkspacePage
              title="线索与成交"
              description="本页只把小红书可证明的平台行为列为平台事实；逐条联系人、营销合格线索（MQL）、商机、合同与回款仍以客户关系管理系统（Azeroth CRM）为准。"
              groups={['conversion']}
              initialDataset="conversion.landing-page"
            />
          }
        />
        <Route
          path="account"
          element={
            <XiaohongshuDatasetWorkspacePage
              title="账户与资金"
              description="账户预算、余额、流水、计划消耗与操作审计分开读取；代理资金能力按账户角色显式标记。"
              groups={['account', 'audit']}
              initialDataset="account.budget"
            />
          }
        />
        <Route
          path="data"
          element={
            <XiaohongshuDatasetWorkspacePage
              title="全量数据目录"
              description="所有公开读取能力都在这里出现：能查的分页展示全部中文业务字段，不能查的说明缺少授权范围（scope）、白名单、账户角色或契约探测条件。"
              initialDataset="report.account.offline"
            />
          }
        />
        <Route path="*" element={<Navigate to="overview" replace />} />
      </Routes>
    </XiaohongshuCenterShell>
  );
}

export default function XiaohongshuCenterPage() {
  return (
    <XiaohongshuCenterProvider>
      <CenterRoutes />
    </XiaohongshuCenterProvider>
  );
}
