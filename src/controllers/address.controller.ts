import { Request, Response } from "express";
import * as addressService from "../services/address.service";
import { parsePagination } from "../utils/pagination";
import { CreateAddressInput, UpdateAddressInput } from "../types/address.types";

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

const CREATE_ERROR =
  "recipientName, phone, postalCode, and address1 (all non-empty strings) are required; " +
  "label and address2 must be strings if present; isDefault must be a boolean if present";
const UPDATE_ERROR =
  "recipientName, phone, postalCode, and address1 must be non-empty strings if present; " +
  "label and address2 must be strings or null if present; isDefault must be a boolean if present";

function parseCreateInput(body: unknown): CreateAddressInput | undefined {
  if (typeof body !== "object" || body === null) {
    return undefined;
  }
  const { label, recipientName, phone, postalCode, address1, address2, isDefault } =
    body as Record<string, unknown>;
  if (
    !isNonEmptyString(recipientName) ||
    !isNonEmptyString(phone) ||
    !isNonEmptyString(postalCode) ||
    !isNonEmptyString(address1)
  ) {
    return undefined;
  }
  if (label !== undefined && typeof label !== "string") {
    return undefined;
  }
  if (address2 !== undefined && typeof address2 !== "string") {
    return undefined;
  }
  if (isDefault !== undefined && typeof isDefault !== "boolean") {
    return undefined;
  }
  return {
    label: label as string | undefined,
    recipientName,
    phone,
    postalCode,
    address1,
    address2: address2 as string | undefined,
    isDefault: isDefault as boolean | undefined,
  };
}

function parseUpdateInput(body: unknown): UpdateAddressInput | undefined {
  if (typeof body !== "object" || body === null) {
    return undefined;
  }
  const { label, recipientName, phone, postalCode, address1, address2, isDefault } =
    body as Record<string, unknown>;
  if (recipientName !== undefined && !isNonEmptyString(recipientName)) {
    return undefined;
  }
  if (phone !== undefined && !isNonEmptyString(phone)) {
    return undefined;
  }
  if (postalCode !== undefined && !isNonEmptyString(postalCode)) {
    return undefined;
  }
  if (address1 !== undefined && !isNonEmptyString(address1)) {
    return undefined;
  }
  if (label !== undefined && label !== null && typeof label !== "string") {
    return undefined;
  }
  if (address2 !== undefined && address2 !== null && typeof address2 !== "string") {
    return undefined;
  }
  if (isDefault !== undefined && typeof isDefault !== "boolean") {
    return undefined;
  }
  return {
    label: label as string | null | undefined,
    recipientName: recipientName as string | undefined,
    phone: phone as string | undefined,
    postalCode: postalCode as string | undefined,
    address1: address1 as string | undefined,
    address2: address2 as string | null | undefined,
    isDefault: isDefault as boolean | undefined,
  };
}

export async function create(req: Request, res: Response): Promise<void> {
  const parsed = parseCreateInput(req.body);
  if (!parsed) {
    res.status(400).json({ error: CREATE_ERROR });
    return;
  }
  const address = await addressService.createAddress(req.user!.sub, parsed);
  res.status(201).json(address);
}

export async function list(req: Request, res: Response): Promise<void> {
  const pagination = parsePagination(req.query as Record<string, unknown>);
  if (!pagination) {
    res.status(400).json({ error: "page and limit must be positive integers" });
    return;
  }
  res.json(await addressService.listAddresses(req.user!.sub, pagination.page, pagination.limit));
}

export async function get(req: Request, res: Response): Promise<void> {
  try {
    res.json(await addressService.getAddress(req.user!.sub, req.params.id));
  } catch (err) {
    if (err instanceof addressService.AddressNotFoundError) {
      res.status(404).json({ error: err.message });
      return;
    }
    if (err instanceof addressService.ForbiddenAddressActionError) {
      res.status(403).json({ error: err.message });
      return;
    }
    throw err;
  }
}

export async function update(req: Request, res: Response): Promise<void> {
  const parsed = parseUpdateInput(req.body);
  if (!parsed) {
    res.status(400).json({ error: UPDATE_ERROR });
    return;
  }
  try {
    res.json(await addressService.updateAddress(req.user!.sub, req.params.id, parsed));
  } catch (err) {
    if (err instanceof addressService.AddressNotFoundError) {
      res.status(404).json({ error: err.message });
      return;
    }
    if (err instanceof addressService.ForbiddenAddressActionError) {
      res.status(403).json({ error: err.message });
      return;
    }
    throw err;
  }
}

export async function remove(req: Request, res: Response): Promise<void> {
  try {
    await addressService.deleteAddress(req.user!.sub, req.params.id);
    res.status(204).send();
  } catch (err) {
    if (err instanceof addressService.AddressNotFoundError) {
      res.status(404).json({ error: err.message });
      return;
    }
    if (err instanceof addressService.ForbiddenAddressActionError) {
      res.status(403).json({ error: err.message });
      return;
    }
    throw err;
  }
}
