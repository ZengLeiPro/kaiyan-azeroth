import type { IProjectResponse } from '@ky-azeroth/shared/types/project';
import { useQueries, useQuery } from '@tanstack/react-query';
import { Check, ChevronDown, X } from 'lucide-react';
import * as React from 'react';

import { Button } from '@/components/ui/button';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useDebouncedValue } from '@/hooks/use-debounced-value';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';

interface ProjectOption {
  id: string;
  name: string;
  status: string;
}

export interface ProjectMultiSelectProps {
  value: string[];
  onChange: (ids: string[]) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  contentClassName?: string;
}

const normalizeProjects = (data: unknown): ProjectOption[] => {
  if (Array.isArray(data)) {
    return data as ProjectOption[];
  }
  return [];
};

export function ProjectMultiSelect({
  value,
  onChange,
  placeholder = '搜索并选择项目',
  disabled = false,
  className,
  contentClassName,
}: ProjectMultiSelectProps) {
  const [open, setOpen] = React.useState(false);
  const [keyword, setKeyword] = React.useState('');
  const debouncedKeyword = useDebouncedValue(keyword.trim(), 300);

  const { data: projects = [], isLoading } = useQuery({
    queryKey: ['project-multi-select', debouncedKeyword],
    queryFn: async () => {
      const response = await api.get('/projects/all', {
        params: {
          ...(debouncedKeyword ? { keyword: debouncedKeyword } : {}),
        },
      });
      return normalizeProjects(response.data);
    },
    staleTime: 60 * 1000,
  });

  // 使用 useQueries 对 value 中每个 id 并发拉取详情，回填已选项 label
  const selectedQueries = useQueries({
    queries: value.map((id) => ({
      queryKey: ['project-multi-select', 'selected', id],
      queryFn: async () => {
        const response = await api.get<IProjectResponse>(`/projects/${id}`);
        return response.data;
      },
      staleTime: 5 * 60 * 1000,
      enabled: Boolean(id),
    })),
  });

  // 已选项 id → label 映射
  const selectedLabels = React.useMemo(() => {
    const map = new Map<string, string>();
    projects.forEach((p) => {
      if (value.includes(p.id)) {
        map.set(p.id, p.name);
      }
    });
    selectedQueries.forEach((q, idx) => {
      const id = value[idx];
      if (q.data && id) {
        map.set(id, q.data.name);
      }
    });
    return map;
  }, [projects, selectedQueries, value]);

  const displayText = React.useMemo(() => {
    if (value.length === 0) return '';
    return value.map((id) => selectedLabels.get(id) || '...').join(', ');
  }, [value, selectedLabels]);

  const handleToggle = (projectId: string) => {
    if (value.includes(projectId)) {
      onChange(value.filter((id) => id !== projectId));
    } else {
      onChange([...value, projectId]);
    }
  };

  const handleRemove = (projectId: string) => {
    onChange(value.filter((id) => id !== projectId));
  };

  const handleClearAll = () => {
    onChange([]);
    setOpen(false);
    setKeyword('');
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className={cn('h-9 w-full justify-between px-3 py-2 text-left font-normal', className)}
        >
          <span className={cn('truncate', !displayText && 'text-muted-foreground')}>
            {displayText || placeholder}
          </span>
          <div className="ml-2 flex items-center gap-1">
            {value.length > 0 ? (
              <span
                role="button"
                className="rounded-sm p-0.5 hover:bg-accent"
                onClick={(event) => {
                  event.stopPropagation();
                  handleClearAll();
                }}
              >
                <X className="h-3.5 w-3.5" />
              </span>
            ) : null}
            <ChevronDown className="h-4 w-4 opacity-50" />
          </div>
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className={cn('w-[--radix-popover-trigger-width] p-0', contentClassName)}
        align="start"
      >
        <Command shouldFilter={false}>
          <CommandInput placeholder="搜索项目名称..." value={keyword} onValueChange={setKeyword} />
          <CommandList>
            {isLoading && <CommandEmpty>加载中...</CommandEmpty>}
            {!isLoading && projects.length === 0 && <CommandEmpty>未找到匹配项目</CommandEmpty>}
            <CommandGroup>
              {projects.map((project) => (
                <CommandItem
                  key={project.id}
                  value={project.name}
                  onSelect={() => handleToggle(project.id)}
                >
                  <Check
                    className={cn(
                      'mr-2 h-4 w-4',
                      value.includes(project.id) ? 'opacity-100' : 'opacity-0'
                    )}
                  />
                  <span>{project.name}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
        {value.length > 0 && (
          <div className="border-t p-2">
            <div className="flex flex-wrap gap-1">
              {value.map((id) => (
                <span
                  key={id}
                  className="inline-flex items-center gap-1 rounded-md bg-accent px-2 py-0.5 text-xs"
                >
                  {selectedLabels.get(id) || '...'}
                  <button
                    type="button"
                    className="rounded-sm hover:bg-accent-foreground/20"
                    onClick={() => handleRemove(id)}
                  >
                    <X className="h-3 w-3" />
                  </button>
                </span>
              ))}
            </div>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
