import { useEffect, useRef } from 'react';
import { useSettingsContext } from '@/contexts/SettingsContext';
import { getPaperSettings, PaperSize } from '@/utils/paperSettings';
import { printHtmlDocument } from '@/utils/printHtmlDocument';

export interface KOTItem {
  name: string;
  quantity: number;
  notes?: string | null;
}

export interface KOTData {
  orderNumber: string;
  station: 'kitchen' | 'bar';
  type?: 'new' | 'updated' | 'cancelled';
  tableNumber?: string | null;
  roomNumber?: string | null;
  waiterName?: string;
  items: KOTItem[];
  orderNotes?: string;
  cancelReason?: string;
  timestamp: Date;
}

interface KOTPrintProps {
  data: KOTData | null;
  onPrintComplete?: () => void;
}

// Categories that go to each station
export const KITCHEN_CATEGORIES = ['food', 'hotel'];
export const BAR_CATEGORIES = ['beverages', 'minibar'];

// Helper to determine station from category
export function getStationForCategory(category: string): 'kitchen' | 'bar' | 'other' {
  if (KITCHEN_CATEGORIES.includes(category)) return 'kitchen';
  if (BAR_CATEGORIES.includes(category)) return 'bar';
  return 'other';
}

function kotDataSignature(data: KOTData): string {
  return [
    data.station,
    data.orderNumber,
    data.type || 'new',
    data.timestamp.getTime(),
    data.items.map(i => `${i.name}|${i.quantity}|${i.notes || ''}`).join(';'),
  ].join('||');
}

export function KOTPrint({ data, onPrintComplete }: KOTPrintProps) {
  const { receiptSettings } = useSettingsContext();
  const printedSignatureRef = useRef<string | null>(null);
  const onCompleteRef = useRef(onPrintComplete);
  onCompleteRef.current = onPrintComplete;

  useEffect(() => {
    if (!data || !data.items.length) return;

    const signature = kotDataSignature(data);
    if (printedSignatureRef.current === signature) return;
    printedSignatureRef.current = signature;

    const printKOT = async () => {
      const stationLabel = data.station === 'kitchen' ? '🍳 KITCHEN' : '🍺 BAR';
      const time = data.timestamp.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
      const date = data.timestamp.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });

      const isCancelled = data.type === 'cancelled';
      const isUpdated = data.type === 'updated';

      const paperSettings = getPaperSettings(receiptSettings?.paper_size as PaperSize);

      const html = `
        <!DOCTYPE html>
        <html>
        <head>
          <style>
            @page { margin: 2mm; size: ${paperSettings.size}; }
            * { margin: 0; padding: 0; box-sizing: border-box; }
            body {
              font-family: 'Courier New', monospace;
              font-size: ${paperSettings.fontSize || '12px'};
              width: ${paperSettings.width};
              padding: 1mm;
              ${isCancelled ? 'background-color: #fff;' : ''}
              color: #000;
            }
            .header {
              text-align: center;
              border-bottom: 2px solid #000;
              padding-bottom: 6px;
              margin-bottom: 6px;
            }
            .status-banner {
              font-size: 24px;
              font-weight: 900;
              text-align: center;
              padding: 6px;
              margin-bottom: 6px;
              text-transform: uppercase;
              border: 4px solid #000;
            }
            .status-cancelled {
              background: #000;
              color: #fff;
              border-color: #000;
            }
            .status-updated {
              background: #eee;
              color: #000;
              border-style: double;
            }
            .station {
              font-size: 24px;
              font-weight: 900;
              letter-spacing: 2px;
              text-decoration: underline;
              margin-bottom: 4px;
            }
            .order-num {
              font-size: 22px;
              font-weight: 900;
              margin: 4px 0;
              border: 2px solid #000;
              display: inline-block;
              padding: 2px 12px;
            }
            .waiter-name {
              font-size: 22px;
              font-weight: 950;
              text-transform: uppercase;
              margin: 4px 0;
              background: #000;
              color: #fff;
              padding: 4px 0;
              width: 100%;
              letter-spacing: 1px;
            }
            .info-row {
              display: flex;
              justify-content: space-between;
              font-size: 14px;
              font-weight: bold;
              margin-top: 4px;
            }
            .target-location {
              font-size: 26px;
              font-weight: 950;
              margin: 6px 0;
              text-align: center;
              border: 1px solid #000;
              padding: 2px;
            }
            .items {
              border-top: 2px dashed #000;
              border-bottom: 2px dashed #000;
              padding: 6px 0;
              margin: 6px 0;
            }
            .item {
              margin: 10px 0;
              ${isCancelled ? 'text-decoration: line-through;' : ''}
            }
            .item-name {
              font-size: 18px;
              font-weight: 900;
              display: flex;
              gap: 10px;
              line-height: 1.2;
            }
            .item-qty {
              font-size: 22px;
              font-weight: 950;
              min-width: 45px;
              text-decoration: underline;
            }
            .item-notes {
              font-size: 14px;
              font-weight: bold;
              font-style: italic;
              margin-left: 55px;
              margin-top: 4px;
              color: #000;
              border-left: 3px solid #000;
              padding-left: 6px;
            }
            .order-notes {
              background: #eee;
              padding: 8px;
              margin: 8px 0;
              font-size: 16px;
              font-weight: bold;
              border: 2px solid #000;
            }
            .cancel-reason {
              border: 3px solid #000;
              padding: 8px;
              margin: 8px 0;
              font-size: 16px;
              font-weight: 900;
              text-align: center;
              background: #eee;
            }
            .footer {
              text-align: center;
              font-size: 12px;
              font-weight: bold;
              margin-top: 8px;
              border-top: 1px dashed #000;
              padding-top: 6px;
            }
          </style>
        </head>
        <body>
          ${isCancelled ? '<div class="status-banner status-cancelled">!!! CANCELLED !!!</div>' : ''}
          ${isUpdated ? '<div class="status-banner status-updated">*** UPDATED ORDER ***</div>' : ''}
          
          <div class="header">
             <div class="station">${stationLabel}</div>
             ${data.waiterName ? `<div class="waiter-name">WAITER: ${data.waiterName}</div>` : ''}
             <div class="order-num">ORDER: ${data.orderNumber}</div>
             
             <div class="target-location">
               ${data.roomNumber ? 'ROOM: ' + data.roomNumber : data.tableNumber ? 'TABLE: ' + data.tableNumber : 'WALK-IN'}
             </div>

             <div class="info-row">
               <span>${date}</span>
               <span>${time}</span>
             </div>
           </div>
          
          ${isCancelled ? '<div style="text-align:center; font-weight:900; font-size: 16px; margin-bottom:10px;">PLEASE STOP PREPARING THESE ITEMS</div>' : ''}
          ${isUpdated ? '<div style="text-align:center; font-weight:900; font-size: 16px; margin-bottom:10px;">NEW ITEMS ADDED TO EXISTING ORDER</div>' : ''}

          ${data.cancelReason ? `<div class="cancel-reason">REASON: ${data.cancelReason}</div>` : ''}

          <div class="items">
            ${data.items.map(item => `
              <div class="item">
                <div class="item-name">
                  <span class="item-qty">${item.quantity}×</span>
                  <span>${item.name}</span>
                </div>
                ${item.notes ? `<div class="item-notes">*** ${item.notes} ***</div>` : ''}
              </div>
            `).join('')}
          </div>

          ${data.orderNotes ? `<div class="order-notes">KITCHEN NOTE: ${data.orderNotes}</div>` : ''}
          
          <div class="footer">
            --- ${isCancelled ? 'VOID TICKET' : 'KOT TICKET'} ---
          </div>
        </body>
        </html>
      `;

      try {
        await printHtmlDocument({
          html,
          title: `${data.station.toUpperCase()}-${data.orderNumber}`,
        });
      } catch (e) {
        console.error('KOT print failed:', e);
      } finally {
        onCompleteRef.current?.();
      }
    };

    void printKOT();
  }, [data]);

  if (!data) return null;

  return null;
}
