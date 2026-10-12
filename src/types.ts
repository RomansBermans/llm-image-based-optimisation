export type VariantStatus = "pending" | "approved" | "rejected";

export interface Store { id: string; domain: string; submittedUrl: string | null; publicToken: string; createdAt: string; }
export interface Product {
  id: string; storeId: string; externalId: string; title: string; canonicalUrl: string;
  originalImageUrl: string; localImagePath: string | null; createdAt: string;
}
export interface Variant {
  id: string; productId: string; prompt: string; generatedImagePath: string;
  status: VariantStatus; createdAt: string;
}
export interface ProductWithVariants extends Product { variants: Variant[]; }
