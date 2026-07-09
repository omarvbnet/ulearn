"use client";

import { Badge, Button, Card, Input, PageHeader } from "@/components/ui";
import { EmptyState, Modal, SkeletonRows, useToast } from "@/components/overlay";
import { useCallback, useEffect, useState } from "react";

type Product = {
  id: string;
  category: string;
  nameEn: string;
  nameAr: string | null;
  descriptionEn: string | null;
  price: number;
  currency: string;
  imageUrl: string;
  images: string[];
  stock: number | null;
  sortOrder: number;
  isActive: boolean;
  _count: { purchases: number };
};

type Purchase = {
  id: string;
  quantity: number;
  totalPrice: number;
  currency: string;
  status: string;
  notes: string | null;
  userPhone: string | null;
  userName: string | null;
  userLocation: string | null;
  productName: string;
  createdAt: string;
  user: {
    fullLegalName: string | null;
    phone: string;
    email: string | null;
    locationLabel: string | null;
    province: { nameEn: string; nameAr: string } | null;
    country: { nameEn: string; nameAr: string } | null;
  };
  product: {
    nameEn: string;
    category: string;
    imageUrl: string;
    price: number;
    currency: string;
  };
};

const CATEGORIES = ["PINS", "BOOKS", "BOARDS", "SUPPLIES", "STATIONERY", "OTHER"] as const;

export function ProductsClient() {
  const { toast } = useToast();
  const [tab, setTab] = useState<"products" | "orders">("products");
  const [products, setProducts] = useState<Product[] | null>(null);
  const [purchases, setPurchases] = useState<Purchase[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [orderFilter, setOrderFilter] = useState("PENDING");

  const [category, setCategory] = useState<(typeof CATEGORIES)[number]>("PINS");
  const [nameEn, setNameEn] = useState("");
  const [nameAr, setNameAr] = useState("");
  const [descriptionEn, setDescriptionEn] = useState("");
  const [price, setPrice] = useState("");
  const [stock, setStock] = useState("");
  const [sortOrder, setSortOrder] = useState("0");
  const [file, setFile] = useState<File | null>(null);

  const loadProducts = useCallback(() => {
    setProducts(null);
    fetch("/api/admin/products")
      .then((r) => (r.ok ? r.json() : { products: [] }))
      .then((d) => setProducts(d.products || []));
  }, []);

  const loadOrders = useCallback(() => {
    setPurchases(null);
    fetch(`/api/admin/product-purchases?status=${orderFilter}`)
      .then((r) => (r.ok ? r.json() : { purchases: [] }))
      .then((d) => setPurchases(d.purchases || []));
  }, [orderFilter]);

  useEffect(() => {
    if (tab === "products") loadProducts();
    else loadOrders();
  }, [tab, loadProducts, loadOrders]);

  async function uploadImage(file: File) {
    const presign = await fetch("/api/admin/uploads", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        filename: file.name,
        contentType: file.type,
        size: file.size,
        category: "image",
        folder: "products",
      }),
    });
    if (!presign.ok) throw new Error((await presign.json()).error);
    const { uploadUrl, key, publicUrl } = await presign.json();
    const put = await fetch(uploadUrl, {
      method: "PUT",
      headers: { "Content-Type": file.type },
      body: file,
    });
    if (!put.ok) throw new Error("Upload failed");
    return { key, publicUrl: publicUrl as string };
  }

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (!file) {
      toast("Please choose a product image", "error");
      return;
    }
    const priceNum = Number(price);
    if (!priceNum || priceNum <= 0) {
      toast("Enter a valid price", "error");
      return;
    }
    setBusy(true);
    try {
      const { key, publicUrl } = await uploadImage(file);
      const res = await fetch("/api/admin/products", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          category,
          nameEn,
          nameAr: nameAr || undefined,
          descriptionEn: descriptionEn || undefined,
          price: priceNum,
          stock: stock === "" ? null : Number(stock),
          sortOrder: Number(sortOrder) || 0,
          imageKey: key,
          imageUrl: publicUrl,
        }),
      });
      if (!res.ok) throw new Error("Save failed");
      toast("Product created");
      setCreating(false);
      setNameEn("");
      setNameAr("");
      setDescriptionEn("");
      setPrice("");
      setStock("");
      setSortOrder("0");
      setFile(null);
      loadProducts();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Failed to create product", "error");
    } finally {
      setBusy(false);
    }
  }

  async function toggle(product: Product) {
    const res = await fetch(`/api/admin/products/${product.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isActive: !product.isActive }),
    });
    if (res.ok) {
      toast(product.isActive ? "Product hidden" : "Product is live");
      loadProducts();
    } else {
      toast("Failed", "error");
    }
  }

  async function remove(product: Product) {
    if (!confirm("Delete this product?")) return;
    const res = await fetch(`/api/admin/products/${product.id}`, { method: "DELETE" });
    if (res.ok) {
      toast("Product deleted");
      loadProducts();
    } else {
      toast("Failed", "error");
    }
  }

  async function orderAction(purchaseId: string, action: "approve" | "reject") {
    const res = await fetch("/api/admin/product-purchases", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ purchaseId, action }),
    });
    if (res.ok) {
      toast(action === "approve" ? "Order confirmed" : "Order rejected");
      loadOrders();
    } else {
      const data = await res.json().catch(() => ({}));
      toast(data.error ?? "Failed", "error");
    }
  }

  return (
    <div>
      <PageHeader
        title="Store Products"
        description="Physical products (pins, books, boards) — students request orders; you confirm payment"
        actions={
          tab === "products" ? (
            <Button onClick={() => setCreating(true)}>New Product</Button>
          ) : undefined
        }
      />

      <div className="mt-4 flex flex-wrap gap-2">
        <Button variant={tab === "products" ? "primary" : "outline"} onClick={() => setTab("products")}>
          Products
        </Button>
        <Button variant={tab === "orders" ? "primary" : "outline"} onClick={() => setTab("orders")}>
          Order Requests
        </Button>
      </div>

      {tab === "products" && (
        <div className="mt-6">
          {products === null ? (
            <SkeletonRows rows={3} />
          ) : products.length === 0 ? (
            <EmptyState title="No products yet" hint="Add pins, books, boards, and more for students to order." />
          ) : (
            <div className="stagger grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {products.map((p) => (
                <Card key={p.id} className="overflow-hidden p-0">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={p.imageUrl} alt={p.nameEn} className="h-40 w-full object-cover" />
                  <div className="space-y-2 p-4">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="font-semibold">{p.nameEn}</p>
                        <p className="text-xs text-muted">{p.category}</p>
                      </div>
                      <Badge status={p.isActive ? "APPROVED" : "SUSPENDED"}>
                        {p.isActive ? "Live" : "Hidden"}
                      </Badge>
                    </div>
                    <p className="text-sm">
                      {p.price.toLocaleString()} {p.currency}
                      {p.stock != null ? ` · ${p.stock} in stock` : ""}
                    </p>
                    <p className="text-xs text-muted">{p._count.purchases} orders · sort {p.sortOrder}</p>
                    <div className="flex gap-2">
                      <Button variant="outline" onClick={() => toggle(p)}>
                        {p.isActive ? "Hide" : "Publish"}
                      </Button>
                      <Button variant="danger" onClick={() => remove(p)}>
                        Delete
                      </Button>
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === "orders" && (
        <div className="mt-6 space-y-4">
          <div className="flex flex-wrap gap-2">
            {["PENDING", "PAID", "REJECTED", "ALL"].map((s) => (
              <Button
                key={s}
                variant={orderFilter === s ? "primary" : "outline"}
                onClick={() => setOrderFilter(s)}
              >
                {s}
              </Button>
            ))}
          </div>
          {purchases === null ? (
            <SkeletonRows rows={4} />
          ) : purchases.length === 0 ? (
            <EmptyState title="No orders" />
          ) : (
            <div className="stagger space-y-3">
              {purchases.map((o) => (
                <Card key={o.id} className="p-4">
                  <div className="flex flex-wrap gap-4">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={o.product.imageUrl}
                      alt=""
                      className="h-20 w-20 rounded-lg object-cover"
                    />
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-semibold">{o.productName}</p>
                        <Badge
                          status={
                            o.status === "PAID"
                              ? "APPROVED"
                              : o.status === "PENDING"
                                ? "PENDING"
                                : "REJECTED"
                          }
                        >
                          {o.status}
                        </Badge>
                      </div>
                      <p className="text-sm">
                        Qty {o.quantity} · {o.totalPrice.toLocaleString()} {o.currency}
                      </p>
                      <p className="text-sm text-muted">
                        {o.userName ?? o.user.fullLegalName ?? "—"} · {o.userPhone ?? o.user.phone}
                        {o.user.email ? ` · ${o.user.email}` : ""}
                      </p>
                      <p className="text-xs text-muted">
                        {o.userLocation ??
                          o.user.locationLabel ??
                          [o.user.province?.nameEn, o.user.country?.nameEn].filter(Boolean).join(", ")}
                      </p>
                      {o.notes && <p className="text-sm">Note: {o.notes}</p>}
                      <p className="text-xs text-muted">{new Date(o.createdAt).toLocaleString()}</p>
                      {o.status === "PENDING" && (
                        <div className="flex gap-2 pt-2">
                          <Button onClick={() => orderAction(o.id, "approve")}>Confirm payment</Button>
                          <Button variant="danger" onClick={() => orderAction(o.id, "reject")}>
                            Reject
                          </Button>
                        </div>
                      )}
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </div>
      )}

      {creating && (
        <Modal open onClose={() => setCreating(false)} title="New Product">
          <form onSubmit={create} className="space-y-4">
            <div>
              <label className="mb-1 block text-sm text-muted">Product image</label>
              <input
                type="file"
                accept="image/*"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                className="block w-full text-sm"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm text-muted">Category</label>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value as (typeof CATEGORIES)[number])}
                className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm"
              >
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
            <Input label="Name (English)" value={nameEn} onChange={(e) => setNameEn(e.target.value)} required />
            <Input label="Name (Arabic)" value={nameAr} onChange={(e) => setNameAr(e.target.value)} />
            <div>
              <label className="mb-1 block text-sm text-muted">Description (English)</label>
              <textarea
                value={descriptionEn}
                onChange={(e) => setDescriptionEn(e.target.value)}
                rows={3}
                className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm"
              />
            </div>
            <Input label="Price (IQD)" type="number" value={price} onChange={(e) => setPrice(e.target.value)} required />
            <Input
              label="Stock (leave empty for unlimited)"
              type="number"
              value={stock}
              onChange={(e) => setStock(e.target.value)}
            />
            <Input label="Sort order" type="number" value={sortOrder} onChange={(e) => setSortOrder(e.target.value)} />
            <Button type="submit" disabled={busy}>
              {busy ? "Saving…" : "Create Product"}
            </Button>
          </form>
        </Modal>
      )}
    </div>
  );
}
