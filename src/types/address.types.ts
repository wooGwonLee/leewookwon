import { Address } from "@prisma/client";

export type { Address };

export interface CreateAddressInput {
  label?: string;
  recipientName: string;
  phone: string;
  postalCode: string;
  address1: string;
  address2?: string;
  isDefault?: boolean;
}

export interface UpdateAddressInput {
  label?: string | null;
  recipientName?: string;
  phone?: string;
  postalCode?: string;
  address1?: string;
  address2?: string | null;
  isDefault?: boolean;
}

export interface ShippingSnapshot {
  label: string | null;
  recipientName: string;
  phone: string;
  postalCode: string;
  address1: string;
  address2: string | null;
}
