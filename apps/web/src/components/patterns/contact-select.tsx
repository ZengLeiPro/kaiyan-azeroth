import type { ContactForSelection } from '@ky-azeroth/shared/types';
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

export interface ContactSelectProps {
  value?: string;
  onChange: (value: string) => void;
  customerId?: string;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  clearable?: boolean;
}

const normalizeContacts = (data: unknown): ContactForSelection[] => {
  if (Array.isArray(data)) {
    return data as ContactForSelection[];
  }
  return [];
};

const formatContactLabel = (contact: ContactForSelection): string => {
  if (contact.position) {
    return `${contact.contactName} - ${contact.position}`;
  }
  return contact.contactName;
};

export function ContactSelect({
  value,
  onChange,
  customerId,
  placeholder = '搜索并选择联系人',
  disabled = false,
  className,
  clearable = true,
}: ContactSelectProps) {
  const [open, setOpen] = React.useState(false);
  const [keyword, setKeyword] = React.useState('');
  const debouncedKeyword = useDebouncedValue(keyword.trim(), 300);

  // 标记：正在 handleSelect 中，跳过 customerId 变化清空逻辑
  const isSelectingRef = React.useRef(false);

  // 当 customerId 变化时，清空当前选中值（但排除 handleSelect 触发的联动）
  const prevCustomerIdRef = React.useRef(customerId);
  React.useEffect(() => {
    if (prevCustomerIdRef.current !== customerId) {
      prevCustomerIdRef.current = customerId;
      if (value && !isSelectingRef.current) {
        onChange('');
      }
    }
  }, [customerId, value, onChange]);

  const { data: contacts = [], isLoading } = useQuery({
    queryKey: ['contact-select', debouncedKeyword, customerId],
    queryFn: async () => {
      const response = await api.get('/contacts/all', {
        params: {
          ...(debouncedKeyword ? { keyword: debouncedKeyword } : {}),
          ...(customerId ? { customerId } : {}),
        },
      });
      return normalizeContacts(response.data);
    },
    staleTime: 60 * 1000,
  });

  // 查询已选中项的详情，确保选中项始终能显示
  const { data: selectedContact } = useQuery({
    queryKey: ['contact-select', 'selected', value],
    enabled: Boolean(value),
    queryFn: async () => {
      if (!value) return null;
      const response = await api.get<ContactForSelection>(`/contacts/${value}`);
      return response.data;
    },
    staleTime: 5 * 60 * 1000,
  });

  const mergedContacts = React.useMemo(() => {
    const map = new Map<string, ContactForSelection>();
    contacts.forEach((contact) => map.set(contact.id, contact));
    if (selectedContact) {
      map.set(selectedContact.id, {
        id: selectedContact.id,
        contactName: selectedContact.contactName,
        position: selectedContact.position,
        phone: selectedContact.phone,
      });
    }
    return Array.from(map.values());
  }, [contacts, selectedContact]);

  const selectedLabel = React.useMemo(() => {
    if (!value) return '';
    if (selectedContact) return formatContactLabel(selectedContact);
    const found = contacts.find((c) => c.id === value);
    return found ? formatContactLabel(found) : '';
  }, [selectedContact, value, contacts]);

  const handleSelect = (contactId: string) => {
    isSelectingRef.current = true;
    onChange(contactId);
    setOpen(false);
    setKeyword('');
    // 在下一个微任务中重置标记，确保 useEffect 已完成
    setTimeout(() => {
      isSelectingRef.current = false;
    }, 0);
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
      <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput placeholder="搜索联系人..." value={keyword} onValueChange={setKeyword} />
          <CommandList>
            {isLoading && <CommandEmpty>加载中...</CommandEmpty>}
            {!isLoading && mergedContacts.length === 0 && (
              <CommandEmpty>未找到匹配联系人</CommandEmpty>
            )}
            <CommandGroup>
              {mergedContacts.map((contact) => (
                <CommandItem
                  key={contact.id}
                  value={`${contact.contactName} ${contact.position ?? ''} ${contact.phone ?? ''}`}
                  onSelect={() => handleSelect(contact.id)}
                >
                  <Check
                    className={cn(
                      'mr-2 h-4 w-4',
                      value === contact.id ? 'opacity-100' : 'opacity-0'
                    )}
                  />
                  <span>{formatContactLabel(contact)}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
