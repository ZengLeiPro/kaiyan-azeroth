import { RefreshCw, RotateCcw, Zap } from 'lucide-react';
import { useCallback, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';
import { logger } from '@/lib/logger';

interface RequestResult {
  id: number;
  success: boolean;
  status: number;
  message: string;
  timestamp: string;
}

export function RateLimitTestPage() {
  const [results, setResults] = useState<RequestResult[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const requestCountRef = useRef(0);

  // 单次请求
  const sendSingleRequest = useCallback(async () => {
    requestCountRef.current += 1;
    const id = requestCountRef.current;

    try {
      const response = await api.get('/rate-limit-test');
      setResults((prev) => [
        ...prev,
        {
          id,
          success: true,
          status: 200,
          message: response.data.message,
          timestamp: new Date().toISOString(),
        },
      ]);
    } catch (error: unknown) {
      const axiosError = error as { response?: { status: number; data?: { message?: string } } };
      setResults((prev) => [
        ...prev,
        {
          id,
          success: false,
          status: axiosError.response?.status || 0,
          message: axiosError.response?.data?.message || '请求失败',
          timestamp: new Date().toISOString(),
        },
      ]);
    }
  }, []);

  // 快速连续请求
  const sendBurstRequests = async () => {
    setIsLoading(true);
    const burstCount = 10; // 发送 10 个请求

    for (let i = 0; i < burstCount; i++) {
      await sendSingleRequest();
      // 短暂延迟，让请求依次发送
      await new Promise((resolve) => setTimeout(resolve, 50));
    }

    setIsLoading(false);
  };

  // 重置速率限制
  const resetRateLimit = async () => {
    try {
      await api.post('/rate-limit-reset');
      setResults([]);
      requestCountRef.current = 0;
    } catch (error) {
      logger.error('RateLimitTestPage', '重置失败:', error);
    }
  };

  // 清空结果
  const clearResults = () => {
    setResults([]);
    requestCountRef.current = 0;
  };

  return (
    <div className="space-y-6 p-6 md:h-full md:overflow-auto" data-testid="rate-limit-test-page">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">API 速率限制测试</h1>
        <p className="mt-1 text-gray-500">测试 API 速率限制功能。该端点限制为每分钟 5 次请求。</p>
      </div>

      {/* 操作按钮 */}
      <div className="flex flex-wrap gap-3">
        <Button onClick={sendSingleRequest} disabled={isLoading} data-testid="send-single-request">
          <Zap className="mr-2 h-4 w-4" />
          发送单次请求
        </Button>

        <Button
          onClick={sendBurstRequests}
          disabled={isLoading}
          variant="destructive"
          data-testid="send-burst-requests"
        >
          {isLoading ? (
            <>
              <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
              发送中...
            </>
          ) : (
            <>
              <Zap className="mr-2 h-4 w-4" />
              快速连续请求 (10次)
            </>
          )}
        </Button>

        <Button onClick={resetRateLimit} variant="outline" data-testid="reset-rate-limit">
          <RotateCcw className="mr-2 h-4 w-4" />
          重置限制
        </Button>

        <Button onClick={clearResults} variant="ghost" data-testid="clear-results">
          清空结果
        </Button>
      </div>

      {/* 统计信息 */}
      <div className="grid grid-cols-3 gap-4">
        <div className="rounded-lg border bg-white p-4">
          <p className="text-sm text-gray-500">总请求数</p>
          <p className="text-2xl font-bold" data-testid="total-requests">
            {results.length}
          </p>
        </div>
        <div className="rounded-lg border bg-white p-4">
          <p className="text-sm text-gray-500">成功请求</p>
          <p className="text-2xl font-bold text-green-600" data-testid="success-requests">
            {results.filter((r) => r.success).length}
          </p>
        </div>
        <div className="rounded-lg border bg-white p-4">
          <p className="text-sm text-gray-500">被限制请求 (429)</p>
          <p className="text-2xl font-bold text-red-600" data-testid="limited-requests">
            {results.filter((r) => r.status === 429).length}
          </p>
        </div>
      </div>

      {/* 请求结果列表 */}
      <div className="rounded-lg border bg-white">
        <div className="border-b px-4 py-3">
          <h2 className="font-medium">请求结果</h2>
        </div>
        <div className="max-h-96 overflow-auto">
          {results.length === 0 ? (
            <div className="p-8 text-center text-gray-500">暂无请求记录，点击上方按钮开始测试</div>
          ) : (
            <table className="w-full">
              <thead className="bg-gray-50 text-xs uppercase text-gray-500">
                <tr>
                  <th className="px-4 py-2 text-left">#</th>
                  <th className="px-4 py-2 text-left">状态</th>
                  <th className="px-4 py-2 text-left">HTTP 状态码</th>
                  <th className="px-4 py-2 text-left">消息</th>
                  <th className="px-4 py-2 text-left">时间</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {results.map((result) => (
                  <tr
                    key={result.id}
                    className={result.success ? 'bg-green-50' : 'bg-red-50'}
                    data-testid={`request-result-${result.id}`}
                  >
                    <td className="px-4 py-2">{result.id}</td>
                    <td className="px-4 py-2">
                      <span
                        className={`inline-flex rounded-full px-2 py-1 text-xs font-medium ${
                          result.success ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
                        }`}
                        data-testid={`request-status-${result.id}`}
                      >
                        {result.success ? '成功' : '失败'}
                      </span>
                    </td>
                    <td className="px-4 py-2">
                      <span
                        className={`font-mono ${
                          result.status === 200
                            ? 'text-green-600'
                            : result.status === 429
                              ? 'text-red-600'
                              : 'text-gray-600'
                        }`}
                        data-testid={`request-http-status-${result.id}`}
                      >
                        {result.status}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-sm text-gray-600">{result.message}</td>
                    <td className="px-4 py-2 text-xs text-gray-400">
                      {new Date(result.timestamp).toLocaleTimeString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
