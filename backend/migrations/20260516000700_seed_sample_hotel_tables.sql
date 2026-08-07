-- Seed a practical starter set of restaurant/service tables.
-- Safe to run multiple times because table_number is unique.

INSERT INTO public.hotel_tables (
  table_number,
  name,
  area,
  capacity,
  status,
  notes,
  is_active
)
VALUES
  ('T-01', 'Window Two-Seater', 'Main Dining', 2, 'free', 'Best for couples and quick service.', true),
  ('T-02', 'Family Booth', 'Main Dining', 6, 'occupied', 'Currently used by a family group.', true),
  ('T-03', 'Corner Four-Seater', 'Main Dining', 4, 'free', 'Quiet corner table near the wall.', true),
  ('T-04', 'Service Table Near POS', 'Main Dining', 4, 'cleaning', 'Recently cleared and waiting for reset.', true),
  ('T-05', 'Garden View Table', 'Terrace', 4, 'occupied', 'Popular outdoor table during evenings.', true),
  ('T-06', 'Terrace Couple Table', 'Terrace', 2, 'free', 'Ideal for light meals and drinks.', true),
  ('T-07', 'VIP Round Table', 'VIP Lounge', 8, 'reserved', 'Reserved for premium guests and private meetings.', true),
  ('T-08', 'Executive Corner', 'VIP Lounge', 4, 'cleaning', 'Deep cleaning in progress after checkout dining.', true),
  ('T-09', 'Poolside High Table', 'Poolside', 4, 'free', 'Good for drinks and snacks.', true),
  ('T-10', 'Poolside Family Table', 'Poolside', 6, 'reserved', 'Reserved for group dining later today.', true)
ON CONFLICT (table_number) DO UPDATE
SET
  name = EXCLUDED.name,
  area = EXCLUDED.area,
  capacity = EXCLUDED.capacity,
  status = EXCLUDED.status,
  notes = EXCLUDED.notes,
  is_active = EXCLUDED.is_active,
  updated_at = now();
