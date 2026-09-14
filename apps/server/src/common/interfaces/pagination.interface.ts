/**
 * 分页响应接口
 * 标准化的分页返回数据结构
 *
 * @template T 数据项的类型
 */
export interface PaginatedResponse<T> {
  /**
   * 当前页的数据列表
   */
  items: T[];

  /**
   * 总记录数
   */
  total: number;

  /**
   * 当前页码
   */
  page: number;

  /**
   * 每页数据量
   */
  pageSize: number;

  /**
   * 总页数
   */
  totalPages: number;
}
