import { Check, Eye, Keyboard, Layers, MousePointer, Palette, Pin, Table2 } from 'lucide-react';
import { useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { DatePicker } from '@/components/ui/date-picker';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { MultiTag, MultiTagInput, Tag } from '@/components/ui/multi-tag';
import { Progress } from '@/components/ui/progress';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

export function UIDemoPage() {
  const [selectedPlan, setSelectedPlan] = useState('standard');
  const [selectedLayout, setSelectedLayout] = useState('horizontal');
  const [selectedSize, setSelectedSize] = useState('medium');
  const [selectedDate, setSelectedDate] = useState<Date | undefined>(new Date());
  const [calendarDate, setCalendarDate] = useState<Date | undefined>(new Date());
  const [progress, setProgress] = useState(30);
  const [activeTab, setActiveTab] = useState('overview');
  const [dialogOpen, setDialogOpen] = useState(false);

  // 多选标签状态
  const [selectedTags, setSelectedTags] = useState<Tag[]>([
    { id: '1', label: '蛋糕' },
    { id: '2', label: '面包' },
    { id: '3', label: '甜点' },
  ]);

  const tagSuggestions: Tag[] = [
    { id: '4', label: '饼干' },
    { id: '5', label: '西点' },
    { id: '6', label: '糕点' },
    { id: '7', label: '烘焙' },
  ];

  // 模拟进度动画
  useEffect(() => {
    const timer = setInterval(() => {
      setProgress((prev) => {
        if (prev >= 100) return 0;
        return prev + 5;
      });
    }, 500);
    return () => clearInterval(timer);
  }, []);

  return (
    <div className="p-6 md:h-full md:overflow-auto">
      {/* 页面标题 */}
      <div className="mb-6 flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
          <Palette className="h-5 w-5 text-primary" />
        </div>
        <div>
          <h1 className="text-2xl font-bold">UI 组件展示</h1>
          <p className="text-sm text-muted-foreground">查看系统 UI 组件样式</p>
        </div>
      </div>

      <div className="space-y-8">
        {/* #172 多选标签组件 */}
        <div className="rounded-lg border bg-card p-6" data-testid="multi-tag-section">
          <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold">
            <span className="text-primary">#172</span> 多选标签组件
          </h2>
          <div className="space-y-6">
            {/* 只读标签展示 */}
            <div>
              <Label className="mb-2 block">已选标签 (只读)</Label>
              <MultiTag tags={selectedTags} readOnly />
            </div>

            {/* 可编辑标签 */}
            <div>
              <Label className="mb-2 block">可编辑标签</Label>
              <MultiTag
                tags={selectedTags}
                onRemove={(id) => setSelectedTags(selectedTags.filter((t) => t.id !== id))}
              />
            </div>

            {/* 标签输入框 */}
            <div>
              <Label className="mb-2 block">标签输入 (支持建议)</Label>
              <MultiTagInput
                value={selectedTags}
                onChange={setSelectedTags}
                suggestions={tagSuggestions}
                placeholder="输入或选择标签..."
              />
            </div>

            <div className="mt-4 rounded-md bg-muted/50 p-3 text-sm">
              <p className="mb-1 font-medium">样式说明:</p>
              <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
                <li>标签有主题色背景 (bg-primary/10)</li>
                <li>删除按钮 (x) 在标签右侧，悬停时高亮</li>
                <li>标签之间使用 gap-2 (8px) 间距</li>
                <li>标签使用圆角胶囊形状 (rounded-full)</li>
              </ul>
            </div>
          </div>
        </div>

        {/* #173 滚动条样式 */}
        <div className="rounded-lg border bg-card p-6" data-testid="scrollbar-section">
          <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold">
            <span className="text-primary">#173</span> 自定义滚动条样式
          </h2>
          <div className="grid grid-cols-2 gap-6">
            {/* 垂直滚动 */}
            <div>
              <Label className="mb-2 block">垂直滚动区域</Label>
              <div
                className="h-48 overflow-y-auto rounded-md border bg-muted/30 p-4"
                data-testid="scrollbar-vertical"
              >
                {Array.from({ length: 20 }).map((_, i) => (
                  <div key={i} className="mb-2 rounded bg-background p-2 text-sm">
                    列表项 {i + 1}
                  </div>
                ))}
              </div>
            </div>

            {/* 水平滚动 */}
            <div>
              <Label className="mb-2 block">水平滚动区域</Label>
              <div
                className="overflow-x-auto rounded-md border bg-muted/30 p-4"
                data-testid="scrollbar-horizontal"
              >
                <div className="flex gap-4" style={{ width: '200%' }}>
                  {Array.from({ length: 20 }).map((_, i) => (
                    <div key={i} className="shrink-0 rounded bg-background px-4 py-2 text-sm">
                      项目 {i + 1}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>

          <div className="mt-4 rounded-md bg-muted/50 p-3 text-sm">
            <p className="mb-1 font-medium">样式说明:</p>
            <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
              <li>滚动条宽度/高度为 8px</li>
              <li>滚动条圆角 (rounded-full)</li>
              <li>默认半透明，悬停时变明显</li>
              <li>轨道透明，与内容融合</li>
            </ul>
          </div>
        </div>

        {/* #174 阴影层级 */}
        <div className="rounded-lg border bg-card p-6" data-testid="shadow-section">
          <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold">
            <Layers className="h-5 w-5" />
            <span className="text-primary">#174</span> 阴影层级规范
          </h2>
          <div className="grid grid-cols-4 gap-6">
            <div className="space-y-2">
              <div
                className="flex h-24 items-center justify-center rounded-lg bg-background shadow-sm"
                data-testid="shadow-sm"
              >
                shadow-sm
              </div>
              <p className="text-center text-xs text-muted-foreground">卡片、按钮</p>
            </div>
            <div className="space-y-2">
              <div
                className="flex h-24 items-center justify-center rounded-lg bg-background shadow-md"
                data-testid="shadow-md"
              >
                shadow-md
              </div>
              <p className="text-center text-xs text-muted-foreground">下拉菜单</p>
            </div>
            <div className="space-y-2">
              <div
                className="flex h-24 items-center justify-center rounded-lg bg-background shadow-lg"
                data-testid="shadow-lg"
              >
                shadow-lg
              </div>
              <p className="text-center text-xs text-muted-foreground">弹窗、模态</p>
            </div>
            <div className="space-y-2">
              <div
                className="flex h-24 items-center justify-center rounded-lg bg-background shadow-xl"
                data-testid="shadow-xl"
              >
                shadow-xl
              </div>
              <p className="text-center text-xs text-muted-foreground">悬浮层</p>
            </div>
          </div>
        </div>

        {/* #175 动画过渡 */}
        <div className="rounded-lg border bg-card p-6" data-testid="animation-section">
          <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold">
            <MousePointer className="h-5 w-5" />
            <span className="text-primary">#175</span> 动画过渡效果
          </h2>
          <div className="space-y-4">
            <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
              <DialogTrigger asChild>
                <Button data-testid="open-dialog-btn">打开弹窗 (测试淡入淡出动画)</Button>
              </DialogTrigger>
              <DialogContent data-testid="animation-dialog">
                <DialogHeader>
                  <DialogTitle>动画演示弹窗</DialogTitle>
                  <DialogDescription>
                    此弹窗展示了 fade-in/fade-out 和 zoom 动画效果。 动画时长约 200ms，使用 ease-out
                    曲线。
                  </DialogDescription>
                </DialogHeader>
                <div className="py-4">
                  <p className="text-sm text-muted-foreground">观察弹窗的打开和关闭动画：</p>
                  <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
                    <li>遮罩层淡入淡出 (fade-in/fade-out)</li>
                    <li>内容区缩放动画 (zoom-in/zoom-out)</li>
                    <li>平滑的滑动效果 (slide-in/slide-out)</li>
                  </ul>
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setDialogOpen(false)}>
                    关闭
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>

            <div className="mt-4 rounded-md bg-muted/50 p-3 text-sm">
              <p className="mb-1 font-medium">动画说明:</p>
              <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
                <li>duration-200 (200ms 动画时长)</li>
                <li>animate-in / animate-out 进出动画</li>
                <li>fade-in-0 / fade-out-0 淡入淡出</li>
                <li>zoom-in-95 / zoom-out-95 缩放效果</li>
              </ul>
            </div>
          </div>
        </div>

        {/* #176 焦点状态 */}
        <div className="rounded-lg border bg-card p-6" data-testid="focus-section">
          <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold">
            <Keyboard className="h-5 w-5" />
            <span className="text-primary">#176</span> 焦点状态 - 键盘导航
          </h2>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              使用 Tab 键在下列元素间导航，观察焦点环样式：
            </p>
            <div className="flex flex-wrap gap-4">
              <Input placeholder="输入框 1" className="w-40" data-testid="focus-input-1" />
              <Input placeholder="输入框 2" className="w-40" data-testid="focus-input-2" />
              <Button variant="outline" data-testid="focus-btn-1">
                按钮 1
              </Button>
              <Button data-testid="focus-btn-2">按钮 2</Button>
              <Button variant="destructive" data-testid="focus-btn-3">
                按钮 3
              </Button>
            </div>

            <div className="mt-4 rounded-md bg-muted/50 p-3 text-sm">
              <p className="mb-1 font-medium">焦点样式说明:</p>
              <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
                <li>焦点环使用主品牌色 (ring-ring / ring-primary)</li>
                <li>焦点环宽度为 2px (ring-2)</li>
                <li>焦点环有 2px 偏移 (ring-offset-2)</li>
                <li>焦点顺序遵循 DOM 顺序</li>
              </ul>
            </div>
          </div>
        </div>

        {/* #178 颜色对比度 */}
        <div className="rounded-lg border bg-card p-6" data-testid="contrast-section">
          <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold">
            <Eye className="h-5 w-5" />
            <span className="text-primary">#178</span> 颜色对比度 - 可访问性
          </h2>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <p className="text-sm font-medium">正文文字</p>
                <div className="rounded-md border bg-background p-3">
                  <p className="text-foreground" data-testid="contrast-body">
                    这是正文文字，使用 text-foreground 颜色。 对比度符合 WCAG AA 标准 (≥4.5:1)。
                  </p>
                </div>
              </div>
              <div className="space-y-2">
                <p className="text-sm font-medium">辅助文字</p>
                <div className="rounded-md border bg-background p-3">
                  <p className="text-muted-foreground" data-testid="contrast-muted">
                    这是辅助文字，使用 text-muted-foreground 颜色。 对比度符合 WCAG AA 标准。
                  </p>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-4 gap-4">
              <Button data-testid="contrast-btn-primary">主按钮</Button>
              <Button variant="secondary" data-testid="contrast-btn-secondary">
                次按钮
              </Button>
              <Button variant="destructive" data-testid="contrast-btn-destructive">
                危险按钮
              </Button>
              <Button variant="outline" data-testid="contrast-btn-outline">
                边框按钮
              </Button>
            </div>

            <div className="flex gap-2">
              <span
                className="inline-flex items-center rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-medium text-green-800"
                data-testid="contrast-status-success"
              >
                成功
              </span>
              <span
                className="inline-flex items-center rounded-full bg-yellow-100 px-2.5 py-0.5 text-xs font-medium text-yellow-800"
                data-testid="contrast-status-warning"
              >
                警告
              </span>
              <span
                className="inline-flex items-center rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-medium text-red-800"
                data-testid="contrast-status-error"
              >
                错误
              </span>
              <span
                className="inline-flex items-center rounded-full bg-blue-100 px-2.5 py-0.5 text-xs font-medium text-blue-800"
                data-testid="contrast-status-info"
              >
                信息
              </span>
            </div>
          </div>
        </div>

        {/* #179 表格斑马纹 */}
        <div className="rounded-lg border bg-card p-6" data-testid="zebra-section">
          <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold">
            <Table2 className="h-5 w-5" />
            <span className="text-primary">#179</span> 表格斑马纹
          </h2>
          <div className="overflow-hidden rounded-md border">
            <table className="w-full text-sm" data-testid="zebra-table">
              <thead>
                <tr className="bg-muted/50">
                  <th className="px-4 py-3 text-left font-medium">编号</th>
                  <th className="px-4 py-3 text-left font-medium">名称</th>
                  <th className="px-4 py-3 text-left font-medium">类型</th>
                  <th className="px-4 py-3 text-left font-medium">状态</th>
                </tr>
              </thead>
              <tbody>
                {[
                  { id: 'P001', name: '巧克力蛋糕', type: '成品', status: '正常' },
                  { id: 'P002', name: '草莓慕斯', type: '成品', status: '正常' },
                  { id: 'P003', name: '法式面包', type: '成品', status: '低库存' },
                  { id: 'P004', name: '黄油', type: '原料', status: '正常' },
                  { id: 'P005', name: '面粉', type: '原料', status: '正常' },
                  { id: 'P006', name: '奶油', type: '原料', status: '临期' },
                ].map((item, index) => (
                  <tr
                    key={item.id}
                    className={index % 2 === 1 ? 'bg-muted/30' : 'bg-background'}
                    data-testid={`zebra-row-${index}`}
                  >
                    <td className="px-4 py-3">{item.id}</td>
                    <td className="px-4 py-3">{item.name}</td>
                    <td className="px-4 py-3">{item.type}</td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                          item.status === '正常'
                            ? 'bg-green-100 text-green-800'
                            : item.status === '低库存'
                              ? 'bg-yellow-100 text-yellow-800'
                              : 'bg-red-100 text-red-800'
                        }`}
                      >
                        {item.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-sm text-muted-foreground">
            奇数行使用 bg-background，偶数行使用 bg-muted/30 实现斑马纹效果
          </p>
        </div>

        {/* #180 固定列 */}
        <div className="rounded-lg border bg-card p-6" data-testid="sticky-column-section">
          <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold">
            <Pin className="h-5 w-5" />
            <span className="text-primary">#180</span> 固定列 - 操作列固定
          </h2>
          <div className="overflow-x-auto rounded-md border" data-testid="sticky-table-container">
            <table className="w-full min-w-[800px] text-sm" data-testid="sticky-table">
              <thead>
                <tr className="bg-muted/50">
                  <th className="whitespace-nowrap px-4 py-3 text-left font-medium">编号</th>
                  <th className="whitespace-nowrap px-4 py-3 text-left font-medium">产品名称</th>
                  <th className="whitespace-nowrap px-4 py-3 text-left font-medium">规格</th>
                  <th className="whitespace-nowrap px-4 py-3 text-left font-medium">单位</th>
                  <th className="whitespace-nowrap px-4 py-3 text-left font-medium">保质期</th>
                  <th className="whitespace-nowrap px-4 py-3 text-left font-medium">存储条件</th>
                  <th className="whitespace-nowrap px-4 py-3 text-left font-medium">类型</th>
                  <th className="whitespace-nowrap px-4 py-3 text-left font-medium">创建时间</th>
                  <th
                    className="sticky right-0 whitespace-nowrap bg-muted/50 px-4 py-3 text-left font-medium shadow-[-4px_0_8px_-4px_rgba(0,0,0,0.1)]"
                    data-testid="sticky-header"
                  >
                    操作
                  </th>
                </tr>
              </thead>
              <tbody>
                {[
                  {
                    id: 'P001',
                    name: '黑森林蛋糕',
                    spec: '8寸/个',
                    unit: '个',
                    shelf: '3天',
                    storage: '冷藏',
                    type: '成品',
                    date: '2024-01-01',
                  },
                  {
                    id: 'P002',
                    name: '提拉米苏',
                    spec: '6寸/盒',
                    unit: '盒',
                    shelf: '2天',
                    storage: '冷藏',
                    type: '成品',
                    date: '2024-01-02',
                  },
                  {
                    id: 'P003',
                    name: '全麦面包',
                    spec: '350g/个',
                    unit: '个',
                    shelf: '5天',
                    storage: '常温',
                    type: '成品',
                    date: '2024-01-03',
                  },
                ].map((item, index) => (
                  <tr key={item.id} className={index % 2 === 1 ? 'bg-muted/30' : 'bg-background'}>
                    <td className="whitespace-nowrap px-4 py-3">{item.id}</td>
                    <td className="whitespace-nowrap px-4 py-3">{item.name}</td>
                    <td className="whitespace-nowrap px-4 py-3">{item.spec}</td>
                    <td className="whitespace-nowrap px-4 py-3">{item.unit}</td>
                    <td className="whitespace-nowrap px-4 py-3">{item.shelf}</td>
                    <td className="whitespace-nowrap px-4 py-3">{item.storage}</td>
                    <td className="whitespace-nowrap px-4 py-3">{item.type}</td>
                    <td className="whitespace-nowrap px-4 py-3">{item.date}</td>
                    <td
                      className={`sticky right-0 whitespace-nowrap px-4 py-3 shadow-[-4px_0_8px_-4px_rgba(0,0,0,0.1)] ${
                        index % 2 === 1 ? 'bg-muted/30' : 'bg-background'
                      }`}
                      data-testid={`sticky-cell-${index}`}
                    >
                      <div className="flex gap-2">
                        <Button size="sm" variant="ghost">
                          编辑
                        </Button>
                        <Button size="sm" variant="ghost" className="text-destructive">
                          删除
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-sm text-muted-foreground">
            操作列使用 sticky right-0 固定，并添加左侧阴影分隔效果
          </p>
        </div>

        {/* Tabs 选项卡 */}
        <div className="rounded-lg border bg-card p-6" data-testid="tabs-section">
          <h2 className="mb-4 text-lg font-semibold">选项卡组件</h2>
          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <TabsList className="grid w-full grid-cols-4">
              <TabsTrigger value="overview">概览</TabsTrigger>
              <TabsTrigger value="analytics">分析</TabsTrigger>
              <TabsTrigger value="reports">报表</TabsTrigger>
              <TabsTrigger value="settings">设置</TabsTrigger>
            </TabsList>
            <TabsContent value="overview">
              <div className="mt-2 rounded-lg border p-4">
                <h3 className="mb-2 font-medium">概览内容</h3>
                <p className="text-sm text-muted-foreground">
                  这是概览选项卡的内容。包含系统的总体信息和快速入口。
                </p>
              </div>
            </TabsContent>
            <TabsContent value="analytics">
              <div className="mt-2 rounded-lg border p-4">
                <h3 className="mb-2 font-medium">分析内容</h3>
                <p className="text-sm text-muted-foreground">
                  这是分析选项卡的内容。包含数据图表和趋势分析。
                </p>
              </div>
            </TabsContent>
            <TabsContent value="reports">
              <div className="mt-2 rounded-lg border p-4">
                <h3 className="mb-2 font-medium">报表内容</h3>
                <p className="text-sm text-muted-foreground">
                  这是报表选项卡的内容。包含各类报表的生成和导出功能。
                </p>
              </div>
            </TabsContent>
            <TabsContent value="settings">
              <div className="mt-2 rounded-lg border p-4">
                <h3 className="mb-2 font-medium">设置内容</h3>
                <p className="text-sm text-muted-foreground">
                  这是设置选项卡的内容。包含系统配置和个人偏好设置。
                </p>
              </div>
            </TabsContent>
          </Tabs>
          <div className="mt-4 text-sm text-muted-foreground">
            当前选项卡: <span className="font-medium text-foreground">{activeTab}</span>
          </div>
        </div>

        {/* Progress 进度条 */}
        <div className="rounded-lg border bg-card p-6" data-testid="progress-section">
          <h2 className="mb-4 text-lg font-semibold">进度条组件</h2>
          <div className="space-y-6">
            {/* 基础进度条 */}
            <div>
              <Label className="mb-2 block">基础进度条 (动态)</Label>
              <Progress value={progress} className="h-2" data-testid="progress-basic" />
              <p className="mt-1 text-sm text-muted-foreground">当前进度: {progress}%</p>
            </div>

            {/* 带标签的进度条 */}
            <div>
              <Label className="mb-2 block">带标签的进度条</Label>
              <Progress value={75} showLabel className="h-4" data-testid="progress-with-label" />
            </div>

            {/* 不同进度值 */}
            <div>
              <Label className="mb-2 block">不同进度示例</Label>
              <div className="space-y-3">
                <div className="flex items-center gap-4">
                  <span className="w-12 text-sm">25%</span>
                  <Progress value={25} className="flex-1" data-testid="progress-25" />
                </div>
                <div className="flex items-center gap-4">
                  <span className="w-12 text-sm">50%</span>
                  <Progress value={50} className="flex-1" data-testid="progress-50" />
                </div>
                <div className="flex items-center gap-4">
                  <span className="w-12 text-sm">75%</span>
                  <Progress value={75} className="flex-1" data-testid="progress-75" />
                </div>
                <div className="flex items-center gap-4">
                  <span className="w-12 text-sm">100%</span>
                  <Progress value={100} className="flex-1" data-testid="progress-100" />
                </div>
              </div>
            </div>

            {/* 不同高度 */}
            <div>
              <Label className="mb-2 block">不同高度</Label>
              <div className="space-y-3">
                <div className="flex items-center gap-4">
                  <span className="w-16 text-sm">细 (h-1)</span>
                  <Progress value={60} className="h-1 flex-1" />
                </div>
                <div className="flex items-center gap-4">
                  <span className="w-16 text-sm">标准 (h-2)</span>
                  <Progress value={60} className="h-2 flex-1" />
                </div>
                <div className="flex items-center gap-4">
                  <span className="w-16 text-sm">粗 (h-3)</span>
                  <Progress value={60} className="h-3 flex-1" />
                </div>
                <div className="flex items-center gap-4">
                  <span className="w-16 text-sm">大 (h-4)</span>
                  <Progress value={60} className="h-4 flex-1" />
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* RadioGroup 垂直布局 */}
        <div className="rounded-lg border bg-card p-6" data-testid="radio-group-vertical-section">
          <h2 className="mb-4 text-lg font-semibold">单选组 - 垂直布局</h2>
          <RadioGroup
            value={selectedPlan}
            onValueChange={setSelectedPlan}
            className="space-y-3"
            data-testid="radio-group-vertical"
          >
            <div className="flex items-center space-x-2">
              <RadioGroupItem value="free" id="plan-free" data-testid="radio-free" />
              <Label htmlFor="plan-free" className="cursor-pointer">
                免费版 - 基础功能
              </Label>
            </div>
            <div className="flex items-center space-x-2">
              <RadioGroupItem value="standard" id="plan-standard" data-testid="radio-standard" />
              <Label htmlFor="plan-standard" className="cursor-pointer">
                标准版 - 高级功能
              </Label>
            </div>
            <div className="flex items-center space-x-2">
              <RadioGroupItem value="premium" id="plan-premium" data-testid="radio-premium" />
              <Label htmlFor="plan-premium" className="cursor-pointer">
                专业版 - 全部功能
              </Label>
            </div>
          </RadioGroup>
          <div className="mt-4 text-sm text-muted-foreground" data-testid="selected-plan">
            当前选择: <span className="font-medium text-foreground">{selectedPlan}</span>
          </div>
        </div>

        {/* RadioGroup 水平布局 */}
        <div className="rounded-lg border bg-card p-6" data-testid="radio-group-horizontal-section">
          <h2 className="mb-4 text-lg font-semibold">单选组 - 水平布局</h2>
          <RadioGroup
            value={selectedLayout}
            onValueChange={setSelectedLayout}
            className="flex space-x-6"
            data-testid="radio-group-horizontal"
          >
            <div className="flex items-center space-x-2">
              <RadioGroupItem
                value="horizontal"
                id="layout-horizontal"
                data-testid="radio-horizontal"
              />
              <Label htmlFor="layout-horizontal" className="cursor-pointer">
                水平
              </Label>
            </div>
            <div className="flex items-center space-x-2">
              <RadioGroupItem value="vertical" id="layout-vertical" data-testid="radio-vertical" />
              <Label htmlFor="layout-vertical" className="cursor-pointer">
                垂直
              </Label>
            </div>
            <div className="flex items-center space-x-2">
              <RadioGroupItem value="grid" id="layout-grid" data-testid="radio-grid" />
              <Label htmlFor="layout-grid" className="cursor-pointer">
                网格
              </Label>
            </div>
          </RadioGroup>
          <div className="mt-4 text-sm text-muted-foreground" data-testid="selected-layout">
            当前选择: <span className="font-medium text-foreground">{selectedLayout}</span>
          </div>
        </div>

        {/* RadioGroup 带卡片样式 */}
        <div className="rounded-lg border bg-card p-6" data-testid="radio-group-card-section">
          <h2 className="mb-4 text-lg font-semibold">单选组 - 卡片样式</h2>
          <RadioGroup
            value={selectedSize}
            onValueChange={setSelectedSize}
            className="grid grid-cols-3 gap-4"
            data-testid="radio-group-card"
          >
            {[
              { value: 'small', label: '小型', desc: '适合个人使用' },
              { value: 'medium', label: '中型', desc: '适合小团队' },
              { value: 'large', label: '大型', desc: '适合企业' },
            ].map((option) => (
              <label
                key={option.value}
                htmlFor={`size-${option.value}`}
                className={`relative flex cursor-pointer flex-col rounded-lg border p-4 hover:bg-muted/50 ${
                  selectedSize === option.value ? 'border-primary bg-primary/5' : 'border-border'
                }`}
                data-testid={`radio-card-${option.value}`}
              >
                <div className="flex items-center justify-between">
                  <span className="font-medium">{option.label}</span>
                  <RadioGroupItem value={option.value} id={`size-${option.value}`} />
                </div>
                <span className="mt-1 text-sm text-muted-foreground">{option.desc}</span>
                {selectedSize === option.value && (
                  <div className="absolute right-4 top-4">
                    <Check className="h-4 w-4 text-primary" />
                  </div>
                )}
              </label>
            ))}
          </RadioGroup>
          <div className="mt-4 text-sm text-muted-foreground" data-testid="selected-size">
            当前选择: <span className="font-medium text-foreground">{selectedSize}</span>
          </div>
        </div>

        {/* RadioGroup 禁用状态 */}
        <div className="rounded-lg border bg-card p-6" data-testid="radio-group-disabled-section">
          <h2 className="mb-4 text-lg font-semibold">单选组 - 禁用状态</h2>
          <RadioGroup
            defaultValue="option1"
            className="space-y-3"
            data-testid="radio-group-disabled"
          >
            <div className="flex items-center space-x-2">
              <RadioGroupItem
                value="option1"
                id="disabled-option1"
                data-testid="radio-disabled-1"
              />
              <Label htmlFor="disabled-option1" className="cursor-pointer">
                可选项 1
              </Label>
            </div>
            <div className="flex items-center space-x-2">
              <RadioGroupItem
                value="option2"
                id="disabled-option2"
                disabled
                data-testid="radio-disabled-2"
              />
              <Label htmlFor="disabled-option2" className="cursor-not-allowed opacity-50">
                禁用项 2
              </Label>
            </div>
            <div className="flex items-center space-x-2">
              <RadioGroupItem
                value="option3"
                id="disabled-option3"
                data-testid="radio-disabled-3"
              />
              <Label htmlFor="disabled-option3" className="cursor-pointer">
                可选项 3
              </Label>
            </div>
          </RadioGroup>
        </div>

        {/* DatePicker 日期选择器 */}
        <div className="rounded-lg border bg-card p-6" data-testid="date-picker-section">
          <h2 className="mb-4 text-lg font-semibold">日期选择器 - 弹出日历</h2>
          <div className="space-y-4">
            <div>
              <Label className="mb-2 block">选择日期</Label>
              <DatePicker
                date={selectedDate}
                onDateChange={setSelectedDate}
                placeholder="请选择日期"
              />
            </div>
            <div className="text-sm text-muted-foreground" data-testid="selected-date">
              当前选择:{' '}
              <span className="font-medium text-foreground">
                {selectedDate ? selectedDate.toLocaleDateString('zh-CN') : '未选择'}
              </span>
            </div>
          </div>
        </div>

        {/* Calendar 日历组件 */}
        <div className="rounded-lg border bg-card p-6" data-testid="calendar-section">
          <h2 className="mb-4 text-lg font-semibold">日历组件 - 内联展示</h2>
          <div className="flex flex-wrap gap-8">
            <div className="space-y-2">
              <h3 className="text-sm font-medium text-muted-foreground">默认（label）</h3>
              <div className="rounded-md border" data-testid="calendar-inline">
                <Calendar
                  mode="single"
                  selected={calendarDate}
                  onSelect={setCalendarDate}
                  className="rounded-md"
                />
              </div>
            </div>
            <div className="space-y-2">
              <h3 className="text-sm font-medium text-muted-foreground">月/年下拉（dropdown）</h3>
              <div className="rounded-md border" data-testid="calendar-inline-dropdown">
                <Calendar
                  mode="single"
                  selected={calendarDate}
                  onSelect={setCalendarDate}
                  captionLayout="dropdown"
                  startMonth={new Date(new Date().getFullYear() - 10, 0, 1)}
                  endMonth={new Date(new Date().getFullYear() + 10, 11, 31)}
                  className="rounded-md"
                />
              </div>
            </div>
            <div className="space-y-2">
              <h3 className="font-medium">日历样式说明</h3>
              <ul className="space-y-1 text-sm text-muted-foreground">
                <li>- 今天日期有特殊背景色标记</li>
                <li>- 选中日期为主题色高亮</li>
                <li>- 非本月日期为半透明显示</li>
                <li>- 月份切换按钮在左右两侧</li>
                <li>- captionLayout=&quot;dropdown&quot; 启用月/年下拉</li>
                <li>- 默认单元格 2.75rem（44px），整体放大友好</li>
              </ul>
              <div className="mt-4 text-sm" data-testid="calendar-selected-date">
                选中日期:{' '}
                <span className="font-medium text-foreground">
                  {calendarDate ? calendarDate.toLocaleDateString('zh-CN') : '未选择'}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
