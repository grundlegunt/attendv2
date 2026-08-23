import { z } from "zod";

export const openSeatLinkedTabsRequestSchema = z.object({
  ticketOrderId: z.string().uuid(),
  mode: z.enum(["SHARED", "SEPARATE"]),
});

export type OpenSeatLinkedTabsRequest = z.infer<
  typeof openSeatLinkedTabsRequestSchema
>;

export const openWalkInTabRequestSchema = z.object({
  requestId: z.string().uuid().optional(),
  label: z.string().trim().min(1).max(80),
});

export const createRestaurantOrderRequestSchema = z.object({
  requestId: z.string().uuid().optional(),
  showtimeSeatId: z.string().uuid().optional(),
});

export const addRestaurantOrderItemRequestSchema = z.object({
  requestId: z.string().uuid().optional(),
  menuItemId: z.string().uuid(),
  quantity: z.number().int().min(1).max(99),
  modifierIds: z.array(z.string().uuid()).default([]),
  allergyNotes: z.string().trim().max(500).optional(),
  course: z.string().trim().max(40).optional(),
});

export const removeRestaurantOrderItemRequestSchema = z
  .object({ requestId: z.string().uuid().optional() })
  .default({});

export const sendRestaurantOrderRequestSchema = z.object({
  requestId: z.string().uuid().optional(),
});

export const createKitchenStationRequestSchema = z.object({
  name: z.string().trim().min(1).max(80),
  displayType: z.string().trim().min(1).max(40),
});

export const updateKitchenStationRequestSchema = z
  .object({
    name: z.string().trim().min(1).max(80).optional(),
    displayType: z.string().trim().min(1).max(40).optional(),
    active: z.boolean().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, "At least one change is required.");

export const createMenuCategoryRequestSchema = z.object({
  name: z.string().trim().min(1).max(80),
  sortOrder: z.number().int().min(0).default(0),
});

export const updateMenuCategoryRequestSchema = z
  .object({
    name: z.string().trim().min(1).max(80).optional(),
    sortOrder: z.number().int().min(0).optional(),
    active: z.boolean().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, "At least one change is required.");

export const createMenuItemRequestSchema = z.object({
  menuCategoryId: z.string().uuid(),
  kitchenStationId: z.string().uuid(),
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).optional(),
  imageUrl: z.string().trim().url("Image URL must be a valid URL.").nullable().optional(),
  priceCents: z.number().int().min(0),
  chargeCategory: z.enum(["FOOD", "ALCOHOL", "NA_BEVERAGE"]).default("FOOD"),
  isVegan: z.boolean().default(false),
  isGlutenFree: z.boolean().default(false),
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

export const updateModifierGroupRequestSchema = z
  .object({
    name: z.string().trim().min(1).max(80).optional(),
    selectionType: z.enum(["SINGLE", "MULTIPLE"]).optional(),
    required: z.boolean().optional(),
    minSelections: z.number().int().min(0).optional(),
    maxSelections: z.number().int().min(1).nullable().optional(),
    active: z.boolean().optional(),
    sortOrder: z.number().int().min(0).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, "At least one change is required.")
  .refine(
    (value) =>
      value.minSelections === undefined ||
      value.maxSelections === undefined ||
      value.maxSelections === null ||
      value.maxSelections >= value.minSelections,
    { message: "Maximum selections must be at least the minimum.", path: ["maxSelections"] },
  );

export const createModifierRequestSchema = z.object({
  name: z.string().trim().min(1).max(80),
  priceDeltaCents: z.number().int(),
  sortOrder: z.number().int().min(0).default(0),
});

export const updateModifierRequestSchema = z
  .object({
    name: z.string().trim().min(1).max(80).optional(),
    priceDeltaCents: z.number().int().optional(),
    active: z.boolean().optional(),
    sortOrder: z.number().int().min(0).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, "At least one change is required.");

export const updateMenuItemRequestSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    description: z.string().trim().max(500).nullable().optional(),
    imageUrl: z.string().trim().url("Image URL must be a valid URL.").nullable().optional(),
    priceCents: z.number().int().min(0).optional(),
    chargeCategory: z.enum(["FOOD", "ALCOHOL", "NA_BEVERAGE"]).optional(),
    isVegan: z.boolean().optional(),
    isGlutenFree: z.boolean().optional(),
    active: z.boolean().optional(),
    is86d: z.boolean().optional(),
    sortOrder: z.number().int().min(0).optional(),
    menuCategoryId: z.string().uuid().optional(),
    kitchenStationId: z.string().uuid().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, "At least one change is required.");

export interface PublicMenuItem {
  id: string;
  name: string;
  description: string | null;
  imageUrl: string | null;
  priceCents: number;
  isVegan: boolean;
  isGlutenFree: boolean;
  modifierGroups: Array<{
    id: string;
    name: string;
    selectionType: "SINGLE" | "MULTIPLE";
    required: boolean;
    minSelections: number;
    maxSelections: number | null;
    modifiers: Array<{ id: string; name: string; priceDeltaCents: number }>;
  }>;
}

export interface PublicMenuCategory {
  id: string;
  name: string;
  items: PublicMenuItem[];
}

export interface PublicMovieSpecial {
  movieId: string;
  movieTitle: string;
  posterUrl: string | null;
  artworkUrl: string | null;
  headline: string | null;
  items: PublicMenuItem[];
}

export interface PublicDiningMenuResponse {
  location: { id: string; name: string; address: string | null };
  menuPresentation: {
    assetUrl: string;
    assetType: "IMAGE" | "PDF";
  } | null;
  categories: PublicMenuCategory[];
  movieSpecials: PublicMovieSpecial[];
}

export const splitRestaurantTabRequestSchema = z.object({
  requestId: z.string().uuid().optional(),
  showtimeSeatId: z.string().uuid(),
});

export const transferRestaurantOrderRequestSchema = z.object({
  requestId: z.string().uuid().optional(),
  targetTabId: z.string().uuid(),
});

export const combineRestaurantTabsRequestSchema = z.object({
  requestId: z.string().uuid().optional(),
  sourceTabId: z.string().uuid(),
});

export const fulfillmentTicketTransitionRequestSchema = z.object({
  action: z.enum(["ACCEPT", "START", "READY", "DELIVER", "CANCEL", "VOID", "REFIRE"]),
  requestId: z.string().uuid().optional(),
});

export const refireFulfillmentTicketRequestSchema = z.object({
  requestId: z.string().uuid().optional(),
});

export const restaurantTipRequestSchema = z.object({
  requestId: z.string().uuid().optional(),
  tipCents: z.number().int().min(0).max(1_000_000),
});

export const restaurantSettlementTenderSchema = z
  .object({
    type: z.enum(["SAVED_METHOD", "CARD_PRESENT"]),
    amountCents: z.number().int().positive().max(10_000_000),
    paymentMethodReferenceId: z.string().uuid().optional(),
    readerId: z.string().min(1).max(200).optional(),
  })
  .superRefine((value, context) => {
    if (value.type === "SAVED_METHOD" && !value.paymentMethodReferenceId) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["paymentMethodReferenceId"],
        message: "A saved payment method is required.",
      });
    }
    if (value.type === "CARD_PRESENT" && !value.readerId) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["readerId"],
        message: "A Terminal reader is required.",
      });
    }
  });

export const finalizeRestaurantTabRequestSchema = z.object({
  requestId: z.string().uuid(),
  tipCents: z.number().int().min(0).max(1_000_000),
  tenders: z.array(restaurantSettlementTenderSchema).min(1).max(10),
});

export const customerPayRestaurantTabRequestSchema = z.object({
  requestId: z.string().uuid(),
  tipCents: z.number().int().min(0).max(1_000_000),
  paymentMethodReferenceId: z.string().uuid(),
});

export type OpenWalkInTabRequest = z.infer<typeof openWalkInTabRequestSchema>;
export type CreateRestaurantOrderRequest = z.infer<
  typeof createRestaurantOrderRequestSchema
>;
export type AddRestaurantOrderItemRequest = z.infer<
  typeof addRestaurantOrderItemRequestSchema
>;
