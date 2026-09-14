import type { IProjectResponse, IProjectSelectionOption } from '@ky-azeroth/shared/types/project';
import { useQuery } from '@tanstack/react-query';
import { Check, ChevronDown, Clock, X } from 'lucide-react';
import * as React from 'react';

import { Button } from '@/components/ui/button';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useDebouncedValue } from '@/hooks/use-debounced-value';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';

const RECENT_STORAGE_KEY = 'ky-azeroth:recent-projects';
const MAX_RECENT = 10;

export type ProjectQuickPickerOption = Pick<
  IProjectSelectionOption,
  'id' | 'name' | 'status' | 'customerName'
>;

type ProjectOption = ProjectQuickPickerOption;

export interface ProjectQuickPickerProps {
  value: string;
  onChange: (value: string, project?: ProjectQuickPickerOption | null) => void;
  showCustomerInLabel?: boolean;
}

function getRecentIds(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.slice(0, MAX_RECENT) : [];
  } catch {
    return [];
  }
}

function addRecentId(id: string) {
  const ids = getRecentIds().filter((i) => i !== id);
  ids.unshift(id);
  localStorage.setItem(RECENT_STORAGE_KEY, JSON.stringify(ids.slice(0, MAX_RECENT)));
}

const normalizeProjects = (data: unknown): ProjectOption[] => {
  if (Array.isArray(data)) return data as ProjectOption[];
  return [];
};

const getProjectLabel = (
  project: { name: string; customerName?: string | null },
  showCustomerInLabel: boolean
): string => {
  if (!showCustomerInLabel || !project.customerName) {
    return project.name;
  }
  return `${project.customerName}-${project.name}`;
};

export function ProjectQuickPicker({
  value,
  onChange,
  showCustomerInLabel = false,
}: ProjectQuickPickerProps) {
  const [open, setOpen] = React.useState(false);
  const [keyword, setKeyword] = React.useState('');
  const debouncedKeyword = useDebouncedValue(keyword.trim(), 300);

  const isSearchMode = debouncedKeyword.length > 0;

  // Recent projects
  const recentIds = React.useMemo(() => getRecentIds(), [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const { data: recentItems = [] } = useQuery({
    queryKey: ['project-quick-picker', 'recent', recentIds],
    enabled: open && recentIds.length > 0 && !isSearchMode,
    queryFn: async () => {
      if (recentIds.length === 0) return [];
      // Fetch all projects and filter by recent IDs
      const response = await api.get('/projects/all');
      const all = normalizeProjects(response.data);
      const map = new Map(all.map((p) => [p.id, p]));
      return recentIds.map((id) => map.get(id)).filter((p): p is ProjectOption => p !== undefined);
    },
    staleTime: 5 * 60 * 1000,
  });

  // All projects (non-search mode fallback)
  const { data: allProjects = [] } = useQuery({
    queryKey: ['project-quick-picker', 'all'],
    enabled: open && !isSearchMode,
    queryFn: async () => {
      const response = await api.get('/projects/all');
      return normalizeProjects(response.data);
    },
    staleTime: 60 * 1000,
  });

  // Search mode
  const { data: searchResults = [], isLoading: isSearching } = useQuery({
    queryKey: ['project-quick-picker', 'search', debouncedKeyword],
    enabled: open && isSearchMode,
    queryFn: async () => {
      const response = await api.get('/projects/all', {
        params: { keyword: debouncedKeyword },
      });
      return normalizeProjects(response.data);
    },
    staleTime: 30 * 1000,
  });

  // Selected project detail
  const { data: selectedProject } = useQuery({
    queryKey: ['project-quick-picker', 'selected', value],
    enabled: Boolean(value),
    queryFn: async () => {
      if (!value) return null;
      const response = await api.get<IProjectResponse>(`/projects/${value}`);
      const item = response.data;
      return {
        id: item.id,
        name: item.name,
        status: item.status,
        customerName: item.customerName ?? null,
      } as ProjectOption;
    },
    staleTime: 5 * 60 * 1000,
  });

  const selectedLabel = React.useMemo(() => {
    if (!value) return '';
    if (selectedProject) return getProjectLabel(selectedProject, showCustomerInLabel);
    return '';
  }, [selectedProject, showCustomerInLabel, value]);

  const projectById = React.useMemo(() => {
    const map = new Map<string, ProjectQuickPickerOption>();
    for (const item of [...recentItems, ...allProjects, ...searchResults]) {
      map.set(item.id, item);
    }
    if (selectedProject) map.set(selectedProject.id, selectedProject);
    return map;
  }, [allProjects, recentItems, searchResults, selectedProject]);

  const handleSelect = (projectId: string) => {
    onChange(projectId, projectById.get(projectId) ?? null);
    addRecentId(projectId);
    setOpen(false);
    setKeyword('');
  };

  const handleClear = () => {
    onChange('', null);
    setOpen(false);
    setKeyword('');
  };

  // Deduplicate: filter out recent items from "all" list
  const recentIdSet = new Set(recentIds);
  const filteredAllProjects = allProjects.filter((item) => !recentIdSet.has(item.id));

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="h-9 w-full justify-between px-3 py-2 text-left font-normal"
        >
          <span className={cn('truncate', !selectedLabel && 'text-muted-foreground')}>
            {selectedLabel || '搜索并选择项目'}
          </span>
          <div className="ml-2 flex items-center gap-1">
            {value ? (
              <span
                role="button"
                className="rounded-sm p-0.5 hover:bg-accent"
                onClick={(event) => {
                  event.stopPropagation();
                  handleClear();
                }}
              >
                <X className="h-3.5 w-3.5" />
              </span>
            ) : null}
            <ChevronDown className="h-4 w-4 opacity-50" />
          </div>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput
            placeholder="搜索项目名称/客户名称..."
            value={keyword}
            onValueChange={setKeyword}
          />
          <CommandList>
            {isSearchMode ? (
              <>
                {isSearching && <CommandEmpty>搜索中...</CommandEmpty>}
                {!isSearching && searchResults.length === 0 && (
                  <CommandEmpty>未找到匹配项目</CommandEmpty>
                )}
                <CommandGroup heading="搜索结果">
                  {searchResults.map((item) => (
                    <CommandItem
                      key={item.id}
                      value={getProjectLabel(item, showCustomerInLabel)}
                      onSelect={() => handleSelect(item.id)}
                    >
                      <Check
                        className={cn(
                          'mr-2 h-4 w-4',
                          value === item.id ? 'opacity-100' : 'opacity-0'
                        )}
                      />
                      <span>{getProjectLabel(item, showCustomerInLabel)}</span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              </>
            ) : (
              <>
                {recentItems.length === 0 && filteredAllProjects.length === 0 && (
                  <CommandEmpty>输入关键词搜索项目</CommandEmpty>
                )}

                {recentItems.length > 0 && (
                  <CommandGroup heading="最近使用">
                    {recentItems.map((item) => (
                      <CommandItem
                        key={`recent-${item.id}`}
                        value={`recent-${item.id}`}
                        onSelect={() => handleSelect(item.id)}
                      >
                        <Check
                          className={cn(
                            'mr-2 h-4 w-4',
                            value === item.id ? 'opacity-100' : 'opacity-0'
                          )}
                        />
                        <Clock className="mr-1.5 h-3.5 w-3.5 text-muted-foreground" />
                        <span>{getProjectLabel(item, showCustomerInLabel)}</span>
                      </CommandItem>
                    ))}
                  </CommandGroup>
                )}

                {recentItems.length > 0 && filteredAllProjects.length > 0 && <CommandSeparator />}

                {filteredAllProjects.length > 0 && (
                  <CommandGroup heading="所有项目">
                    {filteredAllProjects.map((item) => (
                      <CommandItem
                        key={`all-${item.id}`}
                        value={`all-${item.id}`}
                        onSelect={() => handleSelect(item.id)}
                      >
                        <Check
                          className={cn(
                            'mr-2 h-4 w-4',
                            value === item.id ? 'opacity-100' : 'opacity-0'
                          )}
                        />
                        <span>{getProjectLabel(item, showCustomerInLabel)}</span>
                      </CommandItem>
                    ))}
                  </CommandGroup>
                )}
              </>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
