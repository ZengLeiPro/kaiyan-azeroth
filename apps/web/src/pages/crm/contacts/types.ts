import { createContactSchema } from '@ky-azeroth/shared/schemas/contact';
import type { IContactResponse, ICreateContact } from '@ky-azeroth/shared/types/contact';

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface ContactProfile extends IContactResponse {}

export interface ContactFormData extends ICreateContact {
  version?: number;
}

export const contactFormSchema = createContactSchema;

export function toContactProfile(data: IContactResponse): ContactProfile {
  return { ...data };
}

export function toContactFormData(entity: ContactProfile): ContactFormData {
  return {
    contactName: entity.contactName,
    customerId: entity.customerId,
    sex: entity.sex ?? null,
    mobile: entity.mobile ?? null,
    phone: entity.phone ?? null,
    email: entity.email ?? null,
    wechat: entity.wechat ?? null,
    position: entity.position ?? null,
    department: entity.department ?? null,
    remark: entity.remark ?? null,
    version: entity.version,
  };
}

export function toContactPayload(form: ContactFormData) {
  return {
    contactName: form.contactName.trim(),
    customerId: form.customerId,
    sex: form.sex || null,
    mobile: form.mobile?.trim() || null,
    phone: form.phone?.trim() || null,
    email: form.email?.trim() || null,
    wechat: form.wechat?.trim() || null,
    position: form.position?.trim() || null,
    department: form.department?.trim() || null,
    remark: form.remark?.trim() || null,
    version: form.version,
  };
}
