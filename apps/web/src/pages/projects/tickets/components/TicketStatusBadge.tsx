import { StatusBadge } from '@/components/patterns/status-badge';
import { ticketPriorityMap, ticketStatusMap, ticketTypeMap } from '@/lib/status-maps';

export interface TicketStatusBadgeProps {
  status: string;
  className?: string;
}

export function TicketStatusBadge({ status, className }: TicketStatusBadgeProps) {
  return <StatusBadge status={status} statusMap={ticketStatusMap} className={className} />;
}

export interface TicketPriorityBadgeProps {
  priority: string;
  className?: string;
}

export function TicketPriorityBadge({ priority, className }: TicketPriorityBadgeProps) {
  return <StatusBadge status={priority} statusMap={ticketPriorityMap} className={className} />;
}

export interface TicketTypeBadgeProps {
  type: string;
  className?: string;
}

export function TicketTypeBadge({ type, className }: TicketTypeBadgeProps) {
  return <StatusBadge status={type} statusMap={ticketTypeMap} className={className} />;
}
