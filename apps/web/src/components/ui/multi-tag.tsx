import { Check, ChevronDown, X } from 'lucide-react';
import * as React from 'react';

import { Badge } from '@/components/ui/badge';
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
import { cn } from '@/lib/utils';

export interface Tag {
  id: string;
  label: string;
}

export interface MultiTagProps {
  tags: Tag[];
  onRemove?: (id: string) => void;
  className?: string;
  readOnly?: boolean;
}

export function MultiTag({ tags, onRemove, className, readOnly = false }: MultiTagProps) {
  return (
    <div className={cn('flex flex-wrap gap-2', className)} data-testid="multi-tag-container">
      {tags.map((tag) => (
        <Badge
          key={tag.id}
          variant="secondary"
          className="gap-1.5 bg-primary/10 px-3 py-1 text-primary hover:bg-primary/20"
          data-testid={`tag-${tag.id}`}
        >
          {tag.label}
          {!readOnly && onRemove && (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => onRemove(tag.id)}
              className="ml-0.5 h-4 w-4 rounded-full p-0 hover:bg-primary/20 focus:ring-2 focus:ring-primary focus:ring-offset-1"
              aria-label={`删除 ${tag.label}`}
              data-testid={`tag-remove-${tag.id}`}
            >
              <X className="h-3 w-3" />
            </Button>
          )}
        </Badge>
      ))}
    </div>
  );
}

export interface MultiTagInputProps {
  value: Tag[];
  onChange: (tags: Tag[]) => void;
  suggestions?: Tag[];
  placeholder?: string;
  className?: string;
}

export function MultiTagInput({
  value,
  onChange,
  suggestions = [],
  placeholder = '选择标签...',
  className,
}: MultiTagInputProps) {
  const [open, setOpen] = React.useState(false);
  const [inputValue, setInputValue] = React.useState('');

  const handleSelect = (tag: Tag) => {
    if (value.some((t) => t.id === tag.id)) {
      onChange(value.filter((t) => t.id !== tag.id));
    } else {
      onChange([...value, tag]);
    }
    setOpen(false);
    setInputValue('');
  };

  // Allow custom tags if input doesn't match any suggestion
  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && inputValue.trim()) {
      e.preventDefault();
      // Check if it already exists in suggestions to avoid duplicates
      const existing = suggestions.find(
        (s) => s.label.toLowerCase() === inputValue.trim().toLowerCase()
      );
      if (existing) {
        handleSelect(existing);
      } else {
        const newTag: Tag = {
          id: `custom-${Date.now()}`,
          label: inputValue.trim(),
        };
        handleSelect(newTag);
      }
    }
  };

  const selectedTagIds = React.useMemo(() => new Set(value.map((t) => t.id)), [value]);

  return (
    <div className={cn('flex flex-col gap-2', className)}>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            role="combobox"
            aria-expanded={open}
            className="h-auto min-h-10 w-full justify-between px-3 py-2 text-left font-normal"
            data-testid="multi-tag-input-trigger"
          >
            <div className="flex flex-wrap items-center gap-1">
              {value.length > 0 ? (
                value.map((tag) => (
                  <Badge variant="secondary" key={tag.id} className="mr-1">
                    {tag.label}
                    <Button
                      variant="ghost"
                      size="icon"
                      className="ml-1 h-4 w-4 p-0 text-muted-foreground hover:bg-transparent hover:text-foreground"
                      onClick={(e) => {
                        e.stopPropagation();
                        onChange(value.filter((t) => t.id !== tag.id));
                      }}
                    >
                      <X className="h-3 w-3" />
                    </Button>
                  </Badge>
                ))
              ) : (
                <span className="text-muted-foreground">{placeholder}</span>
              )}
            </div>
            <ChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
          <Command>
            <CommandInput
              placeholder="搜索或创建标签..."
              value={inputValue}
              onValueChange={setInputValue}
              onKeyDown={handleKeyDown}
            />
            <CommandList>
              <CommandEmpty>按回车创建 "{inputValue}"</CommandEmpty>
              <CommandGroup>
                {suggestions.map((tag) => (
                  <CommandItem key={tag.id} value={tag.label} onSelect={() => handleSelect(tag)}>
                    <div
                      className={cn(
                        'mr-2 flex h-4 w-4 items-center justify-center rounded-sm border border-primary',
                        selectedTagIds.has(tag.id)
                          ? 'bg-primary text-primary-foreground'
                          : 'opacity-50 [&_svg]:invisible'
                      )}
                    >
                      <Check className={cn('h-4 w-4')} />
                    </div>
                    {tag.label}
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  );
}
