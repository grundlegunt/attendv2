import { z } from "zod";

export const openSeatLinkedTabsRequestSchema = z.object({
  ticketOrderId: z.string().uuid(),
  mode: z.enum(["SHARED", "SEPARATE"]),
});

export type OpenSeatLinkedTabsRequest = z.infer<
  typeof openSeatLinkedTabsRequestSchema
>;

export const openWalkInTabRequestSchema = z.object({
  label: z.string().trim().min(1).max(80),
});

export const createRestaurantOrderRequestSchema = z.object({
  showtimeSeatId: z.string().uuid().optional(),
});

export const addRestaurantOrderItemRequestSchema = z.object({
  menuItemId: z.string().uuid(),
  quantity: z.number().int().min(1).max(99),
  modifierIds: z.array(z.string().uuid()).default([]),
  allergyNotes: z.string().trim().max(500).optional(),
  course: z.string().trim().max(40).optional(),
});

export const createKitchenStationRequestSchema = z.object({
  name: z.string().trim().min(1).max(80),
  displayType: z.string().trim().min(1).max(40),
});

export const createMenuCategoryRequestSchema = z.object({
  name: z.string().trim().min(1).max(80),
  sortOrder: z.number().int().min(0).default(0),
});

export const createMenuItemRequestSchema = z.object({
  menuCategoryId: z.string().uuid(),
  kitchenStationId: z.string().uuid(),
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).optional(),
  priceCents: z.number().int().min(0),
  sortOrder: z.number().int().min(0).default(0),
});

export const createModifierGroupRequestSchema = z.object({
  name: z.string().trim().min(1).max(80),
  selectionType: z.enum(["SINGLE", "MULTIPLE"]),
  required: z.boolean().default(false),
  minSelections: z.number().int().min(0).default(0),
  maxSelections: z.number().int().min(1).nullable().default(null),
  sortOrder: z.number().int().min(0).default(0),
}).refine(
  (value) => value.maxSelections === null || value.maxSelections >= value.minSelections,
  { message: "Maximum selections must be at least the minimum.", path: ["maxSelections"] },
);

export const createModifierRequestSchema = z.object({
  name: z.string().trim().min(1).max(80),
  priceDeltaCents: z.number().int(),
  sortOrder: z.number().int().min(0).default(0),
});

export const updateMenuItemRequestSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    description: z.string().trim().max(500).nullable().optional(),
    priceCents: z.number().int().min(0).optional(),
    active: z.boolean().optional(),
    is86d: z.boolean().optional(),
    sortOrder: z.number().int().min(0).optional(),
    kitchenStationId: z.string().uuid().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, "At least one change is required.");

export const splitRestaurantTabRequestSchema = z.object({
  showtimeSeatId: z.string().uuid(),
});

export const transferRestaurantOrderRequestSchema = z.object({
  targetTabId: z.string().uuid(),
});

export const combineRestaurantTabsRequestSchema = z.object({
  sourceTabId: z.string().uuid(),
});

export const fulfillmentTicketTransitionRequestSchema = z.object({
  action: z.enum(["ACCEPT", "START", "READY", "DELIVER", "CANCEL", "VOID", "REFIRE"]),
});

export type OpenWalkInTabRequest = z.infer<typeof openWalkInTabRequestSchema>;
export type CreateRestaurantOrderRequest = z.infer<
  typeof createRestaurantOrderRequestSchema
>;
export type AddRestaurantOrderItemRequest = z.infer<
  typeof addRestaurantOrderItemRequestSchema
>;
