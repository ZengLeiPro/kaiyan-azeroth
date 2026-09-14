import type { IProjectResponse, IProjectSelectionOption } from '@ky-azeroth/shared/types/project';
import { useQuery } from '@tanstack/react-query';
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

type ProjectOption = Pick<IProjectSelectionOption, 'id' | 'name' | 'status' | 'customerName'>;

export interface ProjectSelectProps {
  value?: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  contentClassName?: string;
  clearable?: boolean;
  showCustomerInLabel?: boolean;
}

const normalizeProjects = (data: unknown): ProjectOption[] => {
  if (Array.isArray(data)) {
    return data as ProjectOption[];
  }
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

export function ProjectSelect({
  value,
  onChange,
  placeholder = '搜索并选择项目',
  disabled = false,
  className,
  contentClassName,
  clearable = true,
  showCustomerInLabel = false,
}: ProjectSelectProps) {
  const [open, setOpen] = React.useState(false);
  const [keyword, setKeyword] = React.useState('');
  const debouncedKeyword = useDebouncedValue(keyword.trim(), 300);

  const { data: projects = [], isLoading } = useQuery({
    queryKey: ['project-select', debouncedKeyword],
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

  const { data: selectedProject } = useQuery({
    queryKey: ['project-select', 'selected', value],
    enabled: Boolean(value),
    queryFn: async () => {
      if (!value) return null;
      const response = await api.get<IProjectResponse>(`/projects/${value}`);
      return response.data;
    },
    staleTime: 5 * 60 * 1000,
  });

  const mergedProjects = React.useMemo(() => {
    const map = new Map<string, ProjectOption>();
    projects.forEach((project) => map.set(project.id, project));
    if (selectedProject) {
      map.set(selectedProject.id, {
        id: selectedProject.id,
        name: selectedProject.name,
        status: selectedProject.status,
        customerName: selectedProject.customerName ?? null,
      });
    }
    return Array.from(map.values());
  }, [projects, selectedProject]);

  const selectedLabel = React.useMemo(() => {
    if (!value) return '';
    return selectedProject ? getProjectLabel(selectedProject, showCustomerInLabel) : '';
  }, [selectedProject, showCustomerInLabel, value]);

  const handleSelect = (projectId: string) => {
    onChange(projectId);
    setOpen(false);
    setKeyword('');
  };

  const handleClear = () => {
    onChange('');
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
          <span className={cn('truncate', !selectedLabel && 'text-muted-foreground')}>
            {selectedLabel || placeholder}
          </span>
          <div className="ml-2 flex items-center gap-1">
            {clearable && value ? (
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
      <PopoverContent
        className={cn('w-[--radix-popover-trigger-width] p-0', contentClassName)}
        align="start"
      >
        <Command shouldFilter={false}>
          <CommandInput
            placeholder="搜索项目名称/客户名称..."
            value={keyword}
            onValueChange={setKeyword}
          />
          <CommandList>
            {isLoading && <CommandEmpty>加载中...</CommandEmpty>}
            {!isLoading && mergedProjects.length === 0 && (
              <CommandEmpty>未找到匹配项目</CommandEmpty>
            )}
            <CommandGroup>
              {mergedProjects.map((project) => (
                <CommandItem
                  key={project.id}
                  value={getProjectLabel(project, showCustomerInLabel)}
                  onSelect={() => handleSelect(project.id)}
                >
                  <Check
                    className={cn(
                      'mr-2 h-4 w-4',
                      value === project.id ? 'opacity-100' : 'opacity-0'
                    )}
                  />
                  <span>{getProjectLabel(project, showCustomerInLabel)}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
