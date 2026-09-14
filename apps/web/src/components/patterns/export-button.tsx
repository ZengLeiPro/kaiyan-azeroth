import { Download, FileSpreadsheet, FileText } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

export type ExportFormat = 'excel' | 'csv';

interface ExportButtonProps {
  onExport: (format: ExportFormat) => void | Promise<void>;
  disabled?: boolean;
  loading?: boolean;
  className?: string;
}

export function ExportButton({
  onExport,
  disabled = false,
  loading = false,
  className = '',
}: ExportButtonProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          disabled={disabled || loading}
          className={className}
          data-testid="export-btn"
        >
          <Download className="mr-2 h-4 w-4" />
          {loading ? '导出中...' : '导出'}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48" data-testid="export-menu">
        <DropdownMenuLabel>选择导出格式</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onClick={() => onExport('excel')}
          data-testid="export-excel-btn"
          className="cursor-pointer gap-2"
        >
          <FileSpreadsheet className="h-4 w-4 text-primary" />
          <span>Excel (.xlsx)</span>
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => onExport('csv')}
          data-testid="export-csv-btn"
          className="cursor-pointer gap-2"
        >
          <FileText className="h-4 w-4 text-info" />
          <span>CSV (.csv)</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
