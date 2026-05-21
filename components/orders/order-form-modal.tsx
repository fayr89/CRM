"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { mockProducts, formatCurrency, mockCurrentUser } from "@/lib/mock-data";
import type { Order, OrderItem, Product, Marketplace } from "@/lib/types";
import { Search, Package, X, Plus } from "lucide-react";
import Image from "next/image";
import { cn } from "@/lib/utils";
import { ProductPicker } from "./product-picker";
import { ScrollArea } from "@/components/ui/scroll-area";

interface OrderFormModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (order: Partial<Order>) => void;
  order?: Order;
}

const marketplaces: Marketplace[] = ['Wildberries', 'Ozon', 'Яндекс.Маркет', 'Avito', 'Другое'];

export function OrderFormModal({ open, onOpenChange, onSave, order }: OrderFormModalProps) {
  const [referenceNumber, setReferenceNumber] = useState(order?.referenceNumber || '');
  const [marketplace, setMarketplace] = useState<Marketplace>(order?.marketplace || 'Wildberries');
  const [clientClassification, setClientClassification] = useState(order?.clientClassification || '');
  const [clientName, setClientName] = useState(order?.clientName || '');
  const [currency, setCurrency] = useState(order?.currency || 'RUB');
  const [notes, setNotes] = useState(order?.notes || '');
  const [items, setItems] = useState<OrderItem[]>(order?.items || []);
  
  // Search state
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<Product[]>([]);
  const [showResults, setShowResults] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [showProductPicker, setShowProductPicker] = useState(false);
  const [editingItemIndex, setEditingItemIndex] = useState<number | null>(null);
  
  const searchRef = useRef<HTMLInputElement>(null);
  const resultsRef = useRef<HTMLDivElement>(null);

  // Get popular products
  const popularProducts = mockProducts
    .filter(p => p.active && (p.recentUsage || 0) > 0)
    .sort((a, b) => (b.recentUsage || 0) - (a.recentUsage || 0))
    .slice(0, 20);

  // Get price for current marketplace
  const getMarketplacePrice = useCallback((product: Product): number | null => {
    const priceEntry = product.prices?.find(p => p.marketplace === marketplace);
    return priceEntry?.price || null;
  }, [marketplace]);

  // Search products
  useEffect(() => {
    if (searchQuery.length >= 2) {
      const results = mockProducts
        .filter(p => p.active)
        .filter(p => 
          p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
          p.sku?.toLowerCase().includes(searchQuery.toLowerCase())
        )
        .slice(0, 8);
      setSearchResults(results);
      setShowResults(true);
      setSelectedIndex(0);
    } else {
      setSearchResults([]);
      setShowResults(false);
    }
  }, [searchQuery]);

  // Add product to items
  const addProduct = useCallback((product: Product) => {
    const price = getMarketplacePrice(product);
    const newItem: OrderItem = {
      id: Date.now(),
      sku: product.sku,
      name: product.name,
      quantity: 1,
      unitPrice: price || product.costPrice,
      lineTotal: price || product.costPrice,
      productId: product.id,
      imageUrl: product.imageUrl || undefined,
      catalogPrice: price,
    };
    setItems(prev => [...prev, newItem]);
    setSearchQuery('');
    setShowResults(false);
    searchRef.current?.focus();
  }, [getMarketplacePrice]);

  // Update item
  const updateItem = (index: number, field: keyof OrderItem, value: number | string) => {
    setItems(prev => prev.map((item, i) => {
      if (i !== index) return item;
      const updated = { ...item, [field]: value };
      if (field === 'quantity' || field === 'unitPrice') {
        updated.lineTotal = updated.quantity * updated.unitPrice;
      }
      return updated;
    }));
  };

  // Remove item
  const removeItem = (index: number) => {
    setItems(prev => prev.filter((_, i) => i !== index));
  };

  // Add empty item
  const addEmptyItem = () => {
    const newItem: OrderItem = {
      id: Date.now(),
      name: '',
      quantity: 1,
      unitPrice: 0,
      lineTotal: 0,
    };
    setItems(prev => [...prev, newItem]);
  };

  // Replace item from picker
  const replaceItem = (index: number, product: Product) => {
    const price = getMarketplacePrice(product);
    setItems(prev => prev.map((item, i) => {
      if (i !== index) return item;
      return {
        ...item,
        sku: product.sku,
        name: product.name,
        unitPrice: price || product.costPrice,
        lineTotal: item.quantity * (price || product.costPrice),
        productId: product.id,
        imageUrl: product.imageUrl || undefined,
        catalogPrice: price,
      };
    }));
    setShowProductPicker(false);
    setEditingItemIndex(null);
  };

  // Keyboard navigation for search
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!showResults) return;
    
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setSelectedIndex(prev => Math.min(prev + 1, searchResults.length - 1));
        break;
      case 'ArrowUp':
        e.preventDefault();
        setSelectedIndex(prev => Math.max(prev - 1, 0));
        break;
      case 'Enter':
        e.preventDefault();
        if (searchResults[selectedIndex]) {
          addProduct(searchResults[selectedIndex]);
        }
        break;
      case 'Escape':
        setShowResults(false);
        break;
    }
  };

  // Calculate total
  const total = items.reduce((sum, item) => sum + item.lineTotal, 0);

  // Handle save
  const handleSave = () => {
    const newOrder: Partial<Order> = {
      referenceNumber: referenceNumber || undefined,
      marketplace,
      clientClassification: clientClassification || undefined,
      clientName: clientName || undefined,
      currency,
      notes: notes || undefined,
      totalAmount: total,
      status: 'new',
      managerId: mockCurrentUser.id,
      managerName: mockCurrentUser.name,
      createdAt: new Date().toISOString(),
      items,
      itemsCount: items.length,
      previewImage: items[0]?.imageUrl || null,
    };
    onSave(newOrder);
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-[800px] max-h-[90vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle>{order ? 'Редактировать заказ' : 'Новый заказ'}</DialogTitle>
          </DialogHeader>

          <ScrollArea className="flex-1 -mx-6 px-6">
            {/* Order Details */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
              <div>
                <Label htmlFor="referenceNumber">Номер заказа (с площадки)</Label>
                <Input
                  id="referenceNumber"
                  placeholder="WB-123456"
                  value={referenceNumber}
                  onChange={e => setReferenceNumber(e.target.value)}
                />
              </div>
              <div>
                <Label htmlFor="marketplace">Площадка</Label>
                <Select value={marketplace} onValueChange={(v) => setMarketplace(v as Marketplace)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {marketplaces.map(m => (
                      <SelectItem key={m} value={m}>{m}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="clientClassification">Классификация клиента</Label>
                <Input
                  id="clientClassification"
                  placeholder="B2B / B2C / VIP / …"
                  value={clientClassification}
                  onChange={e => setClientClassification(e.target.value)}
                />
              </div>
              <div>
                <Label htmlFor="clientName">Клиент</Label>
                <Input
                  id="clientName"
                  value={clientName}
                  onChange={e => setClientName(e.target.value)}
                />
              </div>
              <div className="w-20">
                <Label htmlFor="currency">Валюта</Label>
                <Input
                  id="currency"
                  value={currency}
                  onChange={e => setCurrency(e.target.value)}
                  maxLength={3}
                />
              </div>
              <div className="md:col-span-2">
                <Label htmlFor="notes">Заметки</Label>
                <Textarea
                  id="notes"
                  value={notes}
                  onChange={e => setNotes(e.target.value)}
                  rows={2}
                />
              </div>
            </div>

            {/* Order Items Section */}
            <div className="space-y-4">
              <h3 className="text-sm font-semibold text-[#1f2328]">Позиции заказа</h3>

              {/* Quick Add Box */}
              <div className="bg-[#f9fafb] rounded-lg p-3 space-y-3">
                {/* Search Input */}
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#6b7280]" />
                    <Input
                      ref={searchRef}
                      placeholder="Начните вводить название или артикул…"
                      value={searchQuery}
                      onChange={e => setSearchQuery(e.target.value)}
                      onKeyDown={handleKeyDown}
                      onBlur={() => setTimeout(() => setShowResults(false), 150)}
                      onFocus={() => searchQuery.length >= 2 && setShowResults(true)}
                      className="pl-9"
                    />
                    
                    {/* Search Results Dropdown */}
                    {showResults && searchResults.length > 0 && (
                      <div 
                        ref={resultsRef}
                        className="absolute top-full left-0 right-0 mt-1 bg-white border border-[#e3e6eb] rounded-lg shadow-lg z-50 overflow-hidden"
                      >
                        {searchResults.map((product, index) => {
                          const price = getMarketplacePrice(product);
                          return (
                            <button
                              key={product.id}
                              onClick={() => addProduct(product)}
                              className={cn(
                                "w-full flex items-center gap-3 px-3 py-2 text-left transition-colors",
                                index === selectedIndex ? "bg-[#eff6ff]" : "hover:bg-[#f9fafb]"
                              )}
                            >
                              {product.imageUrl ? (
                                <Image
                                  src={product.imageUrl}
                                  alt=""
                                  width={36}
                                  height={36}
                                  className="w-9 h-9 rounded object-cover"
                                />
                              ) : (
                                <div className="w-9 h-9 rounded bg-[#f3f4f6] flex items-center justify-center">
                                  <Package className="w-4 h-4 text-[#9ca3af]" />
                                </div>
                              )}
                              <div className="flex-1 min-w-0">
                                <p className="text-sm font-medium text-[#1f2328] truncate">{product.name}</p>
                                <p className="text-xs text-[#6b7280]">Арт: {product.sku || '—'}</p>
                              </div>
                              {price ? (
                                <span className="text-sm font-semibold text-[#2563eb]">{formatCurrency(price)}</span>
                              ) : (
                                <span className="text-xs text-[#d97706]">нет в прайсе</span>
                              )}
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                  <Button 
                    variant="outline" 
                    onClick={() => { setEditingItemIndex(null); setShowProductPicker(true); }}
                  >
                    <Package className="w-4 h-4 mr-2" />
                    Каталог
                  </Button>
                </div>

                {/* Popular Products */}
                {popularProducts.length > 0 && (
                  <div>
                    <div className="flex items-center justify-between text-xs text-[#6b7280] mb-2">
                      <span className="font-semibold uppercase tracking-wide">Популярные за 30 дней</span>
                      <span>клик — добавить</span>
                    </div>
                    <div className="flex gap-2 overflow-x-auto pb-2 -mx-1 px-1">
                      {popularProducts.map(product => {
                        const price = getMarketplacePrice(product);
                        return (
                          <button
                            key={product.id}
                            onClick={() => addProduct(product)}
                            className="flex-shrink-0 w-[120px] bg-white border border-[#e3e6eb] rounded-lg p-2 hover:border-[#2563eb] hover:shadow-sm hover:-translate-y-0.5 transition-all text-left relative"
                          >
                            {product.recentUsage && product.recentUsage > 0 && (
                              <span className="absolute -top-1 -right-1 px-1.5 py-0.5 bg-[#2563eb] text-white text-[10px] font-bold rounded-full">
                                x{product.recentUsage}
                              </span>
                            )}
                            {product.imageUrl ? (
                              <Image
                                src={product.imageUrl}
                                alt=""
                                width={56}
                                height={56}
                                className="w-14 h-14 rounded object-cover mx-auto mb-2"
                              />
                            ) : (
                              <div className="w-14 h-14 rounded bg-[#f3f4f6] flex items-center justify-center mx-auto mb-2">
                                <Package className="w-6 h-6 text-[#9ca3af]" />
                              </div>
                            )}
                            <p className="text-[11px] text-[#1f2328] line-clamp-2 mb-1">{product.name}</p>
                            {price ? (
                              <p className="text-xs font-semibold text-[#2563eb]">{formatCurrency(price)}</p>
                            ) : (
                              <p className="text-[10px] text-[#d97706]">нет в прайсе</p>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                {popularProducts.length === 0 && items.length === 0 && (
                  <p className="text-sm text-[#6b7280] text-center py-4">
                    В каталоге пока нет товаров. Добавьте на странице «Каталог».
                  </p>
                )}
              </div>

              {/* Items Table */}
              {items.length > 0 && (
                <div className="border border-[#e3e6eb] rounded-lg overflow-hidden">
                  <table className="w-full">
                    <thead>
                      <tr className="bg-[#f9fafb] border-b border-[#e3e6eb]">
                        <th className="w-12 px-2 py-2"></th>
                        <th className="px-2 py-2 text-left text-xs font-semibold text-[#6b7280]">SKU</th>
                        <th className="px-2 py-2 text-left text-xs font-semibold text-[#6b7280]">Название</th>
                        <th className="w-20 px-2 py-2 text-left text-xs font-semibold text-[#6b7280]">Кол-во</th>
                        <th className="w-28 px-2 py-2 text-left text-xs font-semibold text-[#6b7280]">Цена</th>
                        <th className="w-10 px-2 py-2"></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#e3e6eb]">
                      {items.map((item, index) => (
                        <tr key={item.id}>
                          <td className="px-2 py-2">
                            {item.imageUrl ? (
                              <Image
                                src={item.imageUrl}
                                alt=""
                                width={40}
                                height={40}
                                className="w-10 h-10 rounded object-cover"
                              />
                            ) : (
                              <div className="w-10 h-10 rounded bg-[#f3f4f6] flex items-center justify-center text-[#9ca3af]">
                                —
                              </div>
                            )}
                          </td>
                          <td className="px-2 py-2">
                            <div className="flex items-center gap-1">
                              <span className="text-xs text-[#6b7280] font-mono">{item.sku || '—'}</span>
                              <button
                                onClick={() => { setEditingItemIndex(index); setShowProductPicker(true); }}
                                className="p-1 text-[#6b7280] hover:text-[#2563eb]"
                                title="Выбрать из каталога"
                              >
                                <Package className="w-3 h-3" />
                              </button>
                            </div>
                          </td>
                          <td className="px-2 py-2">
                            <Input
                              value={item.name}
                              onChange={e => updateItem(index, 'name', e.target.value)}
                              className="h-8 text-sm"
                            />
                          </td>
                          <td className="px-2 py-2">
                            <Input
                              type="number"
                              min={1}
                              value={item.quantity}
                              onChange={e => updateItem(index, 'quantity', parseInt(e.target.value) || 1)}
                              className="h-8 text-sm w-16"
                            />
                          </td>
                          <td className="px-2 py-2">
                            <Input
                              type="number"
                              value={item.unitPrice}
                              onChange={e => updateItem(index, 'unitPrice', parseFloat(e.target.value) || 0)}
                              className="h-8 text-sm w-24"
                            />
                            {item.catalogPrice !== null && item.catalogPrice !== undefined && (
                              <p className={cn(
                                "text-[10px] leading-tight mt-0.5",
                                item.unitPrice === item.catalogPrice 
                                  ? "text-[#16a34a]" 
                                  : "text-[#d97706] font-semibold"
                              )}>
                                {item.unitPrice !== item.catalogPrice && '📝 изменено · '}
                                прайс: {formatCurrency(item.catalogPrice)}
                              </p>
                            )}
                          </td>
                          <td className="px-2 py-2">
                            <button
                              onClick={() => removeItem(index)}
                              className="p-1 text-[#dc2626] hover:bg-[#fee2e2] rounded"
                            >
                              <X className="w-4 h-4" />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Total and Add Empty */}
              <div className="flex items-center justify-between">
                <Button variant="outline" size="sm" onClick={addEmptyItem}>
                  <Plus className="w-4 h-4 mr-1" />
                  Добавить пустую позицию
                </Button>
                <p className="text-sm font-semibold text-[#1f2328]">
                  Итого: {formatCurrency(total)}
                </p>
              </div>
            </div>
          </ScrollArea>

          <DialogFooter className="mt-4">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Отмена
            </Button>
            <Button onClick={handleSave}>
              {order ? 'Сохранить' : 'Создать'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Product Picker Modal */}
      <ProductPicker
        open={showProductPicker}
        onOpenChange={setShowProductPicker}
        marketplace={marketplace}
        onSelect={(product) => {
          if (editingItemIndex !== null) {
            replaceItem(editingItemIndex, product);
          } else {
            addProduct(product);
            setShowProductPicker(false);
          }
        }}
      />
    </>
  );
}
