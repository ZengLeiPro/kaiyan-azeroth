export interface AnalyticsQueryState {
  label: string;
  isError: boolean;
  isFetching: boolean;
  hasData: boolean;
  refetch: () => Promise<unknown>;
}

export function toAnalyticsQueryState(
  label: string,
  query: {
    isError: boolean;
    isFetching: boolean;
    data: unknown;
    refetch: () => Promise<unknown>;
  }
): AnalyticsQueryState {
  return {
    label,
    isError: query.isError,
    isFetching: query.isFetching,
    hasData: query.data !== undefined,
    refetch: query.refetch,
  };
}
