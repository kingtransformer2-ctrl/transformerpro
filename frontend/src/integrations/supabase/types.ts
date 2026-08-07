export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "12.2.12 (cd3cf9e)"
  }
  public: {
    Tables: {
      company_profile: {
        Row: {
          address: string | null
          business_hours: Json | null
          company_name: string
          created_at: string
          email: string | null
          id: string
          logo_url: string | null
          phone: string | null
          tax_number: string | null
          tax_rates: Json | null
          tin_number: string | null
          updated_at: string
        }
        Insert: {
          address?: string | null
          business_hours?: Json | null
          company_name: string
          created_at?: string
          email?: string | null
          id?: string
          logo_url?: string | null
          phone?: string | null
          tax_number?: string | null
          tax_rates?: Json | null
          tin_number?: string | null
          updated_at?: string
        }
        Update: {
          address?: string | null
          business_hours?: Json | null
          company_name?: string
          created_at?: string
          email?: string | null
          id?: string
          logo_url?: string | null
          phone?: string | null
          tax_number?: string | null
          tax_rates?: Json | null
          tin_number?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      customer_loans: {
        Row: {
          created_at: string
          customer_id: string
          due_date: string | null
          id: string
          interest_rate: number | null
          loan_number: string
          notes: string | null
          paid_amount: number
          remaining_amount: number
          status: string
          total_amount: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          customer_id: string
          due_date?: string | null
          id?: string
          interest_rate?: number | null
          loan_number: string
          notes?: string | null
          paid_amount?: number
          remaining_amount?: number
          status?: string
          total_amount?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          customer_id?: string
          due_date?: string | null
          id?: string
          interest_rate?: number | null
          loan_number?: string
          notes?: string | null
          paid_amount?: number
          remaining_amount?: number
          status?: string
          total_amount?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "customer_loans_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
        ]
      }
      customers: {
        Row: {
          address: string | null
          created_at: string
          email: string | null
          id: string
          name: string
          phone: string | null
          updated_at: string
        }
        Insert: {
          address?: string | null
          created_at?: string
          email?: string | null
          id?: string
          name: string
          phone?: string | null
          updated_at?: string
        }
        Update: {
          address?: string | null
          created_at?: string
          email?: string | null
          id?: string
          name?: string
          phone?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      hotel_bookings: {
        Row: {
          adults: number
          booking_reference: string
          check_in_date: string
          check_out_date: string
          children: number | null
          created_at: string | null
          created_by: string | null
          deposit_amount: number | null
          guest_id: string | null
          id: string
          paid_amount: number | null
          payment_status: string | null
          room_id: string | null
          special_requests: string | null
          status: Database["public"]["Enums"]["booking_status"]
          total_amount: number | null
          updated_at: string | null
        }
        Insert: {
          adults?: number
          booking_reference: string
          check_in_date: string
          check_out_date: string
          children?: number | null
          created_at?: string | null
          created_by?: string | null
          deposit_amount?: number | null
          guest_id?: string | null
          id?: string
          paid_amount?: number | null
          payment_status?: string | null
          room_id?: string | null
          special_requests?: string | null
          status?: Database["public"]["Enums"]["booking_status"]
          total_amount?: number | null
          updated_at?: string | null
        }
        Update: {
          adults?: number
          booking_reference?: string
          check_in_date?: string
          check_out_date?: string
          children?: number | null
          created_at?: string | null
          created_by?: string | null
          deposit_amount?: number | null
          guest_id?: string | null
          id?: string
          paid_amount?: number | null
          payment_status?: string | null
          room_id?: string | null
          special_requests?: string | null
          status?: Database["public"]["Enums"]["booking_status"]
          total_amount?: number | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "hotel_bookings_guest_id_fkey"
            columns: ["guest_id"]
            isOneToOne: false
            referencedRelation: "hotel_guests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hotel_bookings_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "hotel_rooms"
            referencedColumns: ["id"]
          },
        ]
      }
      hotel_guest_feedback: {
        Row: {
          amenities_rating: number | null
          booking_id: string | null
          cleanliness_rating: number | null
          comments: string | null
          created_at: string | null
          guest_id: string | null
          id: string
          rating: number | null
          service_rating: number | null
        }
        Insert: {
          amenities_rating?: number | null
          booking_id?: string | null
          cleanliness_rating?: number | null
          comments?: string | null
          created_at?: string | null
          guest_id?: string | null
          id?: string
          rating?: number | null
          service_rating?: number | null
        }
        Update: {
          amenities_rating?: number | null
          booking_id?: string | null
          cleanliness_rating?: number | null
          comments?: string | null
          created_at?: string | null
          guest_id?: string | null
          id?: string
          rating?: number | null
          service_rating?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "hotel_guest_feedback_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "hotel_bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hotel_guest_feedback_guest_id_fkey"
            columns: ["guest_id"]
            isOneToOne: false
            referencedRelation: "hotel_guests"
            referencedColumns: ["id"]
          },
        ]
      }
      hotel_guests: {
        Row: {
          address: string | null
          created_at: string | null
          email: string | null
          first_name: string
          id: string
          id_proof_number: string | null
          id_proof_type: string | null
          id_proof_url: string | null
          last_name: string
          loyalty_points: number | null
          nationality: string | null
          phone: string
          preferences: Json | null
          updated_at: string | null
        }
        Insert: {
          address?: string | null
          created_at?: string | null
          email?: string | null
          first_name: string
          id?: string
          id_proof_number?: string | null
          id_proof_type?: string | null
          id_proof_url?: string | null
          last_name: string
          loyalty_points?: number | null
          nationality?: string | null
          phone: string
          preferences?: Json | null
          updated_at?: string | null
        }
        Update: {
          address?: string | null
          created_at?: string | null
          email?: string | null
          first_name?: string
          id?: string
          id_proof_number?: string | null
          id_proof_type?: string | null
          id_proof_url?: string | null
          last_name?: string
          loyalty_points?: number | null
          nationality?: string | null
          phone?: string
          preferences?: Json | null
          updated_at?: string | null
        }
        Relationships: []
      }
      hotel_housekeeping: {
        Row: {
          assigned_to: string | null
          completed_at: string | null
          created_at: string | null
          id: string
          notes: string | null
          priority: string | null
          room_id: string | null
          scheduled_date: string | null
          status: Database["public"]["Enums"]["housekeeping_status"]
          task_type: string
          updated_at: string | null
        }
        Insert: {
          assigned_to?: string | null
          completed_at?: string | null
          created_at?: string | null
          id?: string
          notes?: string | null
          priority?: string | null
          room_id?: string | null
          scheduled_date?: string | null
          status?: Database["public"]["Enums"]["housekeeping_status"]
          task_type?: string
          updated_at?: string | null
        }
        Update: {
          assigned_to?: string | null
          completed_at?: string | null
          created_at?: string | null
          id?: string
          notes?: string | null
          priority?: string | null
          room_id?: string | null
          scheduled_date?: string | null
          status?: Database["public"]["Enums"]["housekeeping_status"]
          task_type?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "hotel_housekeeping_assigned_to_fkey"
            columns: ["assigned_to"]
            isOneToOne: false
            referencedRelation: "hotel_staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hotel_housekeeping_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "hotel_rooms"
            referencedColumns: ["id"]
          },
        ]
      }
      hotel_info: {
        Row: {
          address: string | null
          cancellation_policy: string | null
          created_at: string | null
          email: string | null
          id: string
          logo_url: string | null
          name: string
          phone: string | null
          tax_rate: number | null
          tin_number: string | null
          updated_at: string | null
        }
        Insert: {
          address?: string | null
          cancellation_policy?: string | null
          created_at?: string | null
          email?: string | null
          id?: string
          logo_url?: string | null
          name?: string
          phone?: string | null
          tax_rate?: number | null
          tin_number?: string | null
          updated_at?: string | null
        }
        Update: {
          address?: string | null
          cancellation_policy?: string | null
          created_at?: string | null
          email?: string | null
          id?: string
          logo_url?: string | null
          name?: string
          phone?: string | null
          tax_rate?: number | null
          tin_number?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      hotel_invoice_items: {
        Row: {
          created_at: string | null
          description: string
          id: string
          invoice_id: string | null
          item_type: string | null
          quantity: number | null
          total_price: number
          unit_price: number
        }
        Insert: {
          created_at?: string | null
          description: string
          id?: string
          invoice_id?: string | null
          item_type?: string | null
          quantity?: number | null
          total_price: number
          unit_price: number
        }
        Update: {
          created_at?: string | null
          description?: string
          id?: string
          invoice_id?: string | null
          item_type?: string | null
          quantity?: number | null
          total_price?: number
          unit_price?: number
        }
        Relationships: [
          {
            foreignKeyName: "hotel_invoice_items_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "hotel_invoices"
            referencedColumns: ["id"]
          },
        ]
      }
      hotel_invoices: {
        Row: {
          booking_id: string | null
          created_at: string | null
          discount_amount: number | null
          guest_id: string | null
          id: string
          invoice_number: string
          notes: string | null
          payment_method:
            | Database["public"]["Enums"]["hotel_payment_method"]
            | null
          payment_status: string | null
          subtotal: number
          tax_amount: number | null
          total_amount: number
          updated_at: string | null
        }
        Insert: {
          booking_id?: string | null
          created_at?: string | null
          discount_amount?: number | null
          guest_id?: string | null
          id?: string
          invoice_number: string
          notes?: string | null
          payment_method?:
            | Database["public"]["Enums"]["hotel_payment_method"]
            | null
          payment_status?: string | null
          subtotal?: number
          tax_amount?: number | null
          total_amount?: number
          updated_at?: string | null
        }
        Update: {
          booking_id?: string | null
          created_at?: string | null
          discount_amount?: number | null
          guest_id?: string | null
          id?: string
          invoice_number?: string
          notes?: string | null
          payment_method?:
            | Database["public"]["Enums"]["hotel_payment_method"]
            | null
          payment_status?: string | null
          subtotal?: number
          tax_amount?: number | null
          total_amount?: number
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "hotel_invoices_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "hotel_bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hotel_invoices_guest_id_fkey"
            columns: ["guest_id"]
            isOneToOne: false
            referencedRelation: "hotel_guests"
            referencedColumns: ["id"]
          },
        ]
      }
      hotel_order_items: {
        Row: {
          created_at: string | null
          id: string
          item_type: string | null
          name: string
          notes: string | null
          order_id: string
          quantity: number
          service_item_id: string | null
          status: string
          total_price: number
          unit_price: number
        }
        Insert: {
          created_at?: string | null
          id?: string
          item_type?: string | null
          name: string
          notes?: string | null
          order_id: string
          quantity?: number
          service_item_id?: string | null
          status?: string
          total_price?: number
          unit_price?: number
        }
        Update: {
          created_at?: string | null
          id?: string
          item_type?: string | null
          name?: string
          notes?: string | null
          order_id?: string
          quantity?: number
          service_item_id?: string | null
          status?: string
          total_price?: number
          unit_price?: number
        }
        Relationships: [
          {
            foreignKeyName: "hotel_order_items_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "hotel_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hotel_order_items_service_item_id_fkey"
            columns: ["service_item_id"]
            isOneToOne: false
            referencedRelation: "hotel_service_menu"
            referencedColumns: ["id"]
          },
        ]
      }
      hotel_order_template_items: {
        Row: {
          created_at: string | null
          id: string
          quantity: number
          service_item_id: string
          template_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          quantity?: number
          service_item_id: string
          template_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          quantity?: number
          service_item_id?: string
          template_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "hotel_order_template_items_service_item_id_fkey"
            columns: ["service_item_id"]
            isOneToOne: false
            referencedRelation: "hotel_service_menu"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hotel_order_template_items_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "hotel_order_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      hotel_order_templates: {
        Row: {
          category: string | null
          created_at: string | null
          description: string | null
          icon: string | null
          id: string
          is_active: boolean | null
          name: string
          sort_order: number | null
          updated_at: string | null
        }
        Insert: {
          category?: string | null
          created_at?: string | null
          description?: string | null
          icon?: string | null
          id?: string
          is_active?: boolean | null
          name: string
          sort_order?: number | null
          updated_at?: string | null
        }
        Update: {
          category?: string | null
          created_at?: string | null
          description?: string | null
          icon?: string | null
          id?: string
          is_active?: boolean | null
          name?: string
          sort_order?: number | null
          updated_at?: string | null
        }
        Relationships: []
      }
      hotel_tables: {
        Row: {
          area: string | null
          capacity: number
          created_at: string
          id: string
          is_active: boolean
          name: string | null
          notes: string | null
          status: Database["public"]["Enums"]["hotel_table_status"]
          table_number: string
          updated_at: string
        }
        Insert: {
          area?: string | null
          capacity?: number
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string | null
          notes?: string | null
          status?: Database["public"]["Enums"]["hotel_table_status"]
          table_number: string
          updated_at?: string
        }
        Update: {
          area?: string | null
          capacity?: number
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string | null
          notes?: string | null
          status?: Database["public"]["Enums"]["hotel_table_status"]
          table_number?: string
          updated_at?: string
        }
        Relationships: []
      }
      hotel_orders: {
        Row: {
          assigned_waiter_id: string | null
          booking_id: string | null
          checked_in_at: string | null
          created_at: string | null
          deposit_amount: number | null
          deposit_paid_at: string | null
          discount_amount: number
          id: string
          invoice_id: string | null
          is_billed: boolean
          notes: string | null
          order_number: string
          room_id: string | null
          status: string
          subtotal: number
          table_id: string | null
          table_number: string | null
          tax_amount: number
          total_amount: number
          transfer_context: string | null
          transferred_at: string | null
          transferred_from_staff_id: string | null
          updated_at: string | null
          waiter_id: string | null
        }
        Insert: {
          assigned_waiter_id?: string | null
          booking_id?: string | null
          checked_in_at?: string | null
          created_at?: string | null
          deposit_amount?: number | null
          deposit_paid_at?: string | null
          discount_amount?: number
          id?: string
          invoice_id?: string | null
          is_billed?: boolean
          notes?: string | null
          order_number?: string
          room_id?: string | null
          status?: string
          subtotal?: number
          table_id?: string | null
          table_number?: string | null
          tax_amount?: number
          total_amount?: number
          transfer_context?: string | null
          transferred_at?: string | null
          transferred_from_staff_id?: string | null
          updated_at?: string | null
          waiter_id?: string | null
        }
        Update: {
          assigned_waiter_id?: string | null
          booking_id?: string | null
          checked_in_at?: string | null
          created_at?: string | null
          deposit_amount?: number | null
          deposit_paid_at?: string | null
          discount_amount?: number
          id?: string
          invoice_id?: string | null
          is_billed?: boolean
          notes?: string | null
          order_number?: string
          room_id?: string | null
          status?: string
          subtotal?: number
          table_id?: string | null
          table_number?: string | null
          tax_amount?: number
          total_amount?: number
          transfer_context?: string | null
          transferred_at?: string | null
          transferred_from_staff_id?: string | null
          updated_at?: string | null
          waiter_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "hotel_orders_assigned_waiter_id_fkey"
            columns: ["assigned_waiter_id"]
            isOneToOne: false
            referencedRelation: "hotel_staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hotel_orders_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "hotel_bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hotel_orders_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "hotel_invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hotel_orders_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "hotel_rooms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hotel_orders_table_id_fkey"
            columns: ["table_id"]
            isOneToOne: false
            referencedRelation: "hotel_tables"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hotel_orders_transferred_from_staff_id_fkey"
            columns: ["transferred_from_staff_id"]
            isOneToOne: false
            referencedRelation: "hotel_staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hotel_orders_waiter_id_fkey"
            columns: ["waiter_id"]
            isOneToOne: false
            referencedRelation: "hotel_staff"
            referencedColumns: ["id"]
          },
        ]
      }
      hotel_pricing_rules: {
        Row: {
          created_at: string | null
          end_date: string | null
          id: string
          is_active: boolean | null
          name: string
          price_modifier: number | null
          room_type: Database["public"]["Enums"]["room_type"] | null
          start_date: string | null
        }
        Insert: {
          created_at?: string | null
          end_date?: string | null
          id?: string
          is_active?: boolean | null
          name: string
          price_modifier?: number | null
          room_type?: Database["public"]["Enums"]["room_type"] | null
          start_date?: string | null
        }
        Update: {
          created_at?: string | null
          end_date?: string | null
          id?: string
          is_active?: boolean | null
          name?: string
          price_modifier?: number | null
          room_type?: Database["public"]["Enums"]["room_type"] | null
          start_date?: string | null
        }
        Relationships: []
      }
      hotel_rooms: {
        Row: {
          amenities: Json | null
          capacity: number
          created_at: string | null
          description: string | null
          floor: number
          id: string
          image_url: string | null
          price_per_night: number
          room_number: string
          room_type: Database["public"]["Enums"]["room_type"]
          status: Database["public"]["Enums"]["room_status"]
          updated_at: string | null
        }
        Insert: {
          amenities?: Json | null
          capacity?: number
          created_at?: string | null
          description?: string | null
          floor?: number
          id?: string
          image_url?: string | null
          price_per_night?: number
          room_number: string
          room_type?: Database["public"]["Enums"]["room_type"]
          status?: Database["public"]["Enums"]["room_status"]
          updated_at?: string | null
        }
        Update: {
          amenities?: Json | null
          capacity?: number
          created_at?: string | null
          description?: string | null
          floor?: number
          id?: string
          image_url?: string | null
          price_per_night?: number
          room_number?: string
          room_type?: Database["public"]["Enums"]["room_type"]
          status?: Database["public"]["Enums"]["room_status"]
          updated_at?: string | null
        }
        Relationships: []
      }
      hotel_service_categories: {
        Row: {
          created_at: string | null
          icon: string | null
          id: string
          image_url: string | null
          is_active: boolean | null
          is_system: boolean | null
          label: string
          name: string
          sort_order: number | null
          station: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          icon?: string | null
          id?: string
          image_url?: string | null
          is_active?: boolean | null
          is_system?: boolean | null
          label: string
          name: string
          sort_order?: number | null
          station?: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          icon?: string | null
          id?: string
          image_url?: string | null
          is_active?: boolean | null
          is_system?: boolean | null
          label?: string
          name?: string
          sort_order?: number | null
          station?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      hotel_service_menu: {
        Row: {
          category: string
          created_at: string | null
          description: string | null
          id: string
          is_available: boolean | null
          min_stock_threshold: number | null
          name: string
          price: number
          product_id: string | null
          sort_order: number | null
          stock_quantity: number | null
          track_stock: boolean | null
          updated_at: string | null
        }
        Insert: {
          category?: string
          created_at?: string | null
          description?: string | null
          id?: string
          is_available?: boolean | null
          min_stock_threshold?: number | null
          name: string
          price?: number
          product_id?: string | null
          sort_order?: number | null
          stock_quantity?: number | null
          track_stock?: boolean | null
          updated_at?: string | null
        }
        Update: {
          category?: string
          created_at?: string | null
          description?: string | null
          id?: string
          is_available?: boolean | null
          min_stock_threshold?: number | null
          name?: string
          price?: number
          product_id?: string | null
          sort_order?: number | null
          stock_quantity?: number | null
          track_stock?: boolean | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "hotel_service_menu_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hotel_service_menu_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products_with_calculated_stock"
            referencedColumns: ["id"]
          },
        ]
      }
      hotel_staff: {
        Row: {
          allowed_hotel_routes: string[] | null
          created_at: string | null
          email: string | null
          first_name: string
          hire_date: string | null
          id: string
          is_active: boolean | null
          last_name: string
          phone: string | null
          pin: string | null
          role: Database["public"]["Enums"]["staff_role"]
          salary: number | null
          shift: string | null
          updated_at: string | null
          user_id: string | null
        }
        Insert: {
          allowed_hotel_routes?: string[] | null
          created_at?: string | null
          email?: string | null
          first_name: string
          hire_date?: string | null
          id?: string
          is_active?: boolean | null
          last_name: string
          phone?: string | null
          pin?: string | null
          role?: Database["public"]["Enums"]["staff_role"]
          salary?: number | null
          shift?: string | null
          updated_at?: string | null
          user_id?: string | null
        }
        Update: {
          allowed_hotel_routes?: string[] | null
          created_at?: string | null
          email?: string | null
          first_name?: string
          hire_date?: string | null
          id?: string
          is_active?: boolean | null
          last_name?: string
          phone?: string | null
          pin?: string | null
          role?: Database["public"]["Enums"]["staff_role"]
          salary?: number | null
          shift?: string | null
          updated_at?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      hotel_staff_attendance: {
        Row: {
          check_in_time: string | null
          check_out_time: string | null
          created_at: string | null
          date: string
          id: string
          is_active: boolean | null
          notes: string | null
          shift_id: string | null
          source: string | null
          staff_id: string | null
          status: string | null
          worked_hours: number | null
        }
        Insert: {
          check_in_time?: string | null
          check_out_time?: string | null
          created_at?: string | null
          date?: string
          id?: string
          is_active?: boolean | null
          notes?: string | null
          shift_id?: string | null
          source?: string | null
          staff_id?: string | null
          status?: string | null
          worked_hours?: number | null
        }
        Update: {
          check_in_time?: string | null
          check_out_time?: string | null
          created_at?: string | null
          date?: string
          id?: string
          is_active?: boolean | null
          notes?: string | null
          shift_id?: string | null
          source?: string | null
          staff_id?: string | null
          status?: string | null
          worked_hours?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "hotel_staff_attendance_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "hotel_staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hotel_staff_attendance_shift_id_fkey"
            columns: ["shift_id"]
            isOneToOne: false
            referencedRelation: "hotel_staff_shifts"
            referencedColumns: ["id"]
          },
        ]
      }
      hotel_staff_shifts: {
        Row: {
          billed_sales: number | null
          closed_at: string | null
          closing_notes: string | null
          closing_report: string | null
          created_at: string
          id: string
          opened_at: string
          opening_notes: string | null
          pending_orders: Json | null
          shift_label: string
          staff_id: string
          staff_role: Database["public"]["Enums"]["staff_role"]
          status: string
          summary: Json | null
          total_items: number | null
          total_orders: number | null
          total_sales: number | null
        }
        Insert: {
          billed_sales?: number | null
          closed_at?: string | null
          closing_notes?: string | null
          closing_report?: string | null
          created_at?: string
          id?: string
          opened_at?: string
          opening_notes?: string | null
          pending_orders?: Json | null
          shift_label: string
          staff_id: string
          staff_role: Database["public"]["Enums"]["staff_role"]
          status?: string
          summary?: Json | null
          total_items?: number | null
          total_orders?: number | null
          total_sales?: number | null
        }
        Update: {
          billed_sales?: number | null
          closed_at?: string | null
          closing_notes?: string | null
          closing_report?: string | null
          created_at?: string
          id?: string
          opened_at?: string
          opening_notes?: string | null
          pending_orders?: Json | null
          shift_label?: string
          staff_id?: string
          staff_role?: Database["public"]["Enums"]["staff_role"]
          status?: string
          summary?: Json | null
          total_items?: number | null
          total_orders?: number | null
          total_sales?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "hotel_staff_shifts_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "hotel_staff"
            referencedColumns: ["id"]
          },
        ]
      }
      hotel_stock_movements: {
        Row: {
          created_at: string | null
          created_by: string | null
          id: string
          movement_type: string
          notes: string | null
          quantity: number
          reason: string
          reference_id: string | null
          service_item_id: string | null
        }
        Insert: {
          created_at?: string | null
          created_by?: string | null
          id?: string
          movement_type: string
          notes?: string | null
          quantity: number
          reason: string
          reference_id?: string | null
          service_item_id?: string | null
        }
        Update: {
          created_at?: string | null
          created_by?: string | null
          id?: string
          movement_type?: string
          notes?: string | null
          quantity?: number
          reason?: string
          reference_id?: string | null
          service_item_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "hotel_stock_movements_service_item_id_fkey"
            columns: ["service_item_id"]
            isOneToOne: false
            referencedRelation: "hotel_service_menu"
            referencedColumns: ["id"]
          },
        ]
      }
      listings: {
        Row: {
          asking_price: number
          color: string | null
          condition: string
          created_at: string
          description: string | null
          fuel_type: string | null
          id: string
          image_urls: string[] | null
          location: string
          make: string
          mileage: string
          model: string
          payment_status: string | null
          seller_email: string
          seller_name: string
          seller_phone: string | null
          status: string | null
          stripe_session_id: string | null
          transmission: string | null
          updated_at: string
          user_id: string | null
          vehicle_type: string
          year: number
        }
        Insert: {
          asking_price: number
          color?: string | null
          condition: string
          created_at?: string
          description?: string | null
          fuel_type?: string | null
          id?: string
          image_urls?: string[] | null
          location: string
          make: string
          mileage: string
          model: string
          payment_status?: string | null
          seller_email: string
          seller_name: string
          seller_phone?: string | null
          status?: string | null
          stripe_session_id?: string | null
          transmission?: string | null
          updated_at?: string
          user_id?: string | null
          vehicle_type: string
          year: number
        }
        Update: {
          asking_price?: number
          color?: string | null
          condition?: string
          created_at?: string
          description?: string | null
          fuel_type?: string | null
          id?: string
          image_urls?: string[] | null
          location?: string
          make?: string
          mileage?: string
          model?: string
          payment_status?: string | null
          seller_email?: string
          seller_name?: string
          seller_phone?: string | null
          status?: string | null
          stripe_session_id?: string | null
          transmission?: string | null
          updated_at?: string
          user_id?: string | null
          vehicle_type?: string
          year?: number
        }
        Relationships: []
      }
      loan_items: {
        Row: {
          batch_id: string | null
          created_at: string
          id: string
          loan_id: string
          product_id: string
          quantity: number
          total_price: number
          unit_price: number
        }
        Insert: {
          batch_id?: string | null
          created_at?: string
          id?: string
          loan_id: string
          product_id: string
          quantity: number
          total_price: number
          unit_price: number
        }
        Update: {
          batch_id?: string | null
          created_at?: string
          id?: string
          loan_id?: string
          product_id?: string
          quantity?: number
          total_price?: number
          unit_price?: number
        }
        Relationships: []
      }
      loan_payments: {
        Row: {
          amount: number
          created_at: string
          id: string
          loan_id: string
          notes: string | null
          payment_date: string
          payment_method: string
          reference_number: string | null
        }
        Insert: {
          amount: number
          created_at?: string
          id?: string
          loan_id: string
          notes?: string | null
          payment_date?: string
          payment_method?: string
          reference_number?: string | null
        }
        Update: {
          amount?: number
          created_at?: string
          id?: string
          loan_id?: string
          notes?: string | null
          payment_date?: string
          payment_method?: string
          reference_number?: string | null
        }
        Relationships: []
      }
      payments: {
        Row: {
          amount: number
          created_at: string
          currency: string | null
          id: string
          listing_id: string | null
          status: string | null
          stripe_session_id: string | null
          updated_at: string
          user_id: string | null
        }
        Insert: {
          amount: number
          created_at?: string
          currency?: string | null
          id?: string
          listing_id?: string | null
          status?: string | null
          stripe_session_id?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          amount?: number
          created_at?: string
          currency?: string | null
          id?: string
          listing_id?: string | null
          status?: string | null
          stripe_session_id?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "payments_listing_id_fkey"
            columns: ["listing_id"]
            isOneToOne: false
            referencedRelation: "listings"
            referencedColumns: ["id"]
          },
        ]
      }
      product_batches: {
        Row: {
          batch_number: string
          created_at: string
          expiry_date: string | null
          id: string
          notes: string | null
          product_id: string
          purchase_price: number
          quantity: number
          received_date: string
          selling_price: number
          supplier: string | null
          updated_at: string
        }
        Insert: {
          batch_number: string
          created_at?: string
          expiry_date?: string | null
          id?: string
          notes?: string | null
          product_id: string
          purchase_price?: number
          quantity?: number
          received_date?: string
          selling_price?: number
          supplier?: string | null
          updated_at?: string
        }
        Update: {
          batch_number?: string
          created_at?: string
          expiry_date?: string | null
          id?: string
          notes?: string | null
          product_id?: string
          purchase_price?: number
          quantity?: number
          received_date?: string
          selling_price?: number
          supplier?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_batches_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_batches_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products_with_calculated_stock"
            referencedColumns: ["id"]
          },
        ]
      }
      products: {
        Row: {
          barcode: string | null
          category: string | null
          created_at: string
          description: string | null
          expiry_date: string | null
          id: string
          image_url: string | null
          min_stock_threshold: number | null
          name: string
          purchase_price: number
          selling_price: number
          stock_quantity: number
          updated_at: string
        }
        Insert: {
          barcode?: string | null
          category?: string | null
          created_at?: string
          description?: string | null
          expiry_date?: string | null
          id?: string
          image_url?: string | null
          min_stock_threshold?: number | null
          name: string
          purchase_price?: number
          selling_price?: number
          stock_quantity?: number
          updated_at?: string
        }
        Update: {
          barcode?: string | null
          category?: string | null
          created_at?: string
          description?: string | null
          expiry_date?: string | null
          id?: string
          image_url?: string | null
          min_stock_threshold?: number | null
          name?: string
          purchase_price?: number
          selling_price?: number
          stock_quantity?: number
          updated_at?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          created_at: string
          email: string | null
          first_name: string | null
          id: string
          last_name: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          email?: string | null
          first_name?: string | null
          id?: string
          last_name?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          email?: string | null
          first_name?: string | null
          id?: string
          last_name?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      role_permissions: {
        Row: {
          color: string | null
          created_at: string
          description: string | null
          hotel_routes: string[]
          icon: string | null
          id: string
          is_system: boolean | null
          landing_page: string | null
          pos_routes: string[]
          role: string
          updated_at: string
        }
        Insert: {
          color?: string | null
          created_at?: string
          description?: string | null
          hotel_routes?: string[]
          icon?: string | null
          id?: string
          is_system?: boolean | null
          landing_page?: string | null
          pos_routes?: string[]
          role: string
          updated_at?: string
        }
        Update: {
          color?: string | null
          created_at?: string
          description?: string | null
          hotel_routes?: string[]
          icon?: string | null
          id?: string
          is_system?: boolean | null
          landing_page?: string | null
          pos_routes?: string[]
          role?: string
          updated_at?: string
        }
        Relationships: []
      }
      sale_items: {
        Row: {
          batch_id: string | null
          created_at: string
          id: string
          product_id: string
          quantity: number
          sale_id: string
          total_price: number
          unit_price: number
        }
        Insert: {
          batch_id?: string | null
          created_at?: string
          id?: string
          product_id: string
          quantity: number
          sale_id: string
          total_price: number
          unit_price: number
        }
        Update: {
          batch_id?: string | null
          created_at?: string
          id?: string
          product_id?: string
          quantity?: number
          sale_id?: string
          total_price?: number
          unit_price?: number
        }
        Relationships: [
          {
            foreignKeyName: "sale_items_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "product_batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sale_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sale_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products_with_calculated_stock"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sale_items_sale_id_fkey"
            columns: ["sale_id"]
            isOneToOne: false
            referencedRelation: "sales"
            referencedColumns: ["id"]
          },
        ]
      }
      sales: {
        Row: {
          created_at: string
          customer_id: string | null
          customer_name: string | null
          customer_phone: string | null
          discount: number | null
          final_amount: number
          id: string
          notes: string | null
          payment_method: string | null
          sale_date: string
          sale_number: string
          tax_amount: number | null
          total_amount: number
        }
        Insert: {
          created_at?: string
          customer_id?: string | null
          customer_name?: string | null
          customer_phone?: string | null
          discount?: number | null
          final_amount?: number
          id?: string
          notes?: string | null
          payment_method?: string | null
          sale_date?: string
          sale_number: string
          tax_amount?: number | null
          total_amount?: number
        }
        Update: {
          created_at?: string
          customer_id?: string | null
          customer_name?: string | null
          customer_phone?: string | null
          discount?: number | null
          final_amount?: number
          id?: string
          notes?: string | null
          payment_method?: string | null
          sale_date?: string
          sale_number?: string
          tax_amount?: number | null
          total_amount?: number
        }
        Relationships: [
          {
            foreignKeyName: "sales_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
        ]
      }
      security_audit_log: {
        Row: {
          created_at: string
          details: Json | null
          event_type: string
          id: string
          user_id: string | null
        }
        Insert: {
          created_at?: string
          details?: Json | null
          event_type: string
          id?: string
          user_id?: string | null
        }
        Update: {
          created_at?: string
          details?: Json | null
          event_type?: string
          id?: string
          user_id?: string | null
        }
        Relationships: []
      }
      settings: {
        Row: {
          category: string
          created_at: string
          description: string | null
          id: string
          key: string
          updated_at: string
          value: Json
        }
        Insert: {
          category: string
          created_at?: string
          description?: string | null
          id?: string
          key: string
          updated_at?: string
          value: Json
        }
        Update: {
          category?: string
          created_at?: string
          description?: string | null
          id?: string
          key?: string
          updated_at?: string
          value?: Json
        }
        Relationships: []
      }
      stock_movements: {
        Row: {
          batch_id: string | null
          created_at: string
          id: string
          movement_type: string
          notes: string | null
          product_id: string
          quantity: number
          reason: string
          reference_id: string | null
        }
        Insert: {
          batch_id?: string | null
          created_at?: string
          id?: string
          movement_type: string
          notes?: string | null
          product_id: string
          quantity: number
          reason: string
          reference_id?: string | null
        }
        Update: {
          batch_id?: string | null
          created_at?: string
          id?: string
          movement_type?: string
          notes?: string | null
          product_id?: string
          quantity?: number
          reason?: string
          reference_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "stock_movements_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "product_batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_movements_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_movements_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products_with_calculated_stock"
            referencedColumns: ["id"]
          },
        ]
      }
      user_role_audit: {
        Row: {
          changed_by: string | null
          created_at: string | null
          id: string
          ip_address: string | null
          new_role: string | null
          old_role: string | null
          reason: string | null
          target_user_id: string | null
          user_agent: string | null
        }
        Insert: {
          changed_by?: string | null
          created_at?: string | null
          id?: string
          ip_address?: string | null
          new_role?: string | null
          old_role?: string | null
          reason?: string | null
          target_user_id?: string | null
          user_agent?: string | null
        }
        Update: {
          changed_by?: string | null
          created_at?: string | null
          id?: string
          ip_address?: string | null
          new_role?: string | null
          old_role?: string | null
          reason?: string | null
          target_user_id?: string | null
          user_agent?: string | null
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_roles_role_fkey"
            columns: ["role"]
            isOneToOne: false
            referencedRelation: "role_permissions"
            referencedColumns: ["role"]
          },
        ]
      }
      vehicles: {
        Row: {
          category: string | null
          condition: string
          created_at: string
          description: string | null
          fuel_type: string
          id: string
          image_url: string | null
          is_featured: boolean | null
          location: string
          make: string
          mileage: string
          model: string
          price: number
          seller_email: string | null
          status: string | null
          title: string
          updated_at: string
          vehicle_type: string
          year: number
        }
        Insert: {
          category?: string | null
          condition: string
          created_at?: string
          description?: string | null
          fuel_type: string
          id?: string
          image_url?: string | null
          is_featured?: boolean | null
          location: string
          make: string
          mileage: string
          model: string
          price: number
          seller_email?: string | null
          status?: string | null
          title: string
          updated_at?: string
          vehicle_type?: string
          year: number
        }
        Update: {
          category?: string | null
          condition?: string
          created_at?: string
          description?: string | null
          fuel_type?: string
          id?: string
          image_url?: string | null
          is_featured?: boolean | null
          location?: string
          make?: string
          mileage?: string
          model?: string
          price?: number
          seller_email?: string | null
          status?: string | null
          title?: string
          updated_at?: string
          vehicle_type?: string
          year?: number
        }
        Relationships: []
      }
    }
    Views: {
      products_with_calculated_stock: {
        Row: {
          barcode: string | null
          calculated_stock: number | null
          category: string | null
          created_at: string | null
          current_selling_price: number | null
          description: string | null
          expiry_date: string | null
          id: string | null
          image_url: string | null
          min_stock_threshold: number | null
          name: string | null
          next_expiry_date: string | null
          purchase_price: number | null
          selling_price: number | null
          stock_quantity: number | null
          updated_at: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      calculate_product_stock: {
        Args: { product_uuid: string }
        Returns: number
      }
      create_custom_role: {
        Args: {
          hotel_routes_arr?: string[]
          pos_routes_arr?: string[]
          role_color?: string
          role_description?: string
          role_icon?: string
          role_name: string
        }
        Returns: string
      }
      delete_custom_role: { Args: { role_name: string }; Returns: boolean }
      generate_booking_reference: { Args: never; Returns: string }
      generate_hotel_invoice_number: { Args: never; Returns: string }
      generate_hotel_order_number: { Args: never; Returns: string }
      generate_loan_number: { Args: never; Returns: string }
      generate_sale_number: { Args: never; Returns: string }
      get_current_user_role: { Args: never; Returns: string }
      get_user_by_email: {
        Args: { user_email: string }
        Returns: {
          created_at: string
          email: string
          user_id: string
        }[]
      }
      get_user_count: { Args: never; Returns: number }
      is_admin: { Args: never; Returns: boolean }
      log_security_event: {
        Args: { details?: Json; event_type: string; user_id_param?: string }
        Returns: undefined
      }
      reset_admin_password: { Args: never; Returns: string }
      safe_update_user_role: {
        Args: {
          ip_address?: string
          new_role: string
          reason?: string
          target_user_id: string
          user_agent?: string
        }
        Returns: boolean
      }
      verify_staff_pin: { Args: { staff_pin: string }; Returns: Json }
    }
    Enums: {
      booking_status:
        | "pending"
        | "confirmed"
        | "checked_in"
        | "checked_out"
        | "cancelled"
      hotel_payment_method: "cash" | "card" | "upi" | "bank_transfer"
      hotel_table_status: "free" | "reserved" | "occupied" | "cleaning"
      housekeeping_status: "pending" | "in_progress" | "completed" | "verified"
      room_status:
        | "available"
        | "occupied"
        | "reserved"
        | "maintenance"
        | "cleaning"
      room_type: "single" | "double" | "suite" | "deluxe" | "presidential"
      staff_role:
        | "manager"
        | "receptionist"
        | "housekeeping"
        | "security"
        | "maintenance"
        | "waiter"
        | "barman"
        | "chef"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      booking_status: [
        "pending",
        "confirmed",
        "checked_in",
        "checked_out",
        "cancelled",
      ],
      hotel_payment_method: ["cash", "card", "upi", "bank_transfer"],
      hotel_table_status: ["free", "reserved", "occupied", "cleaning"],
      housekeeping_status: ["pending", "in_progress", "completed", "verified"],
      room_status: [
        "available",
        "occupied",
        "reserved",
        "maintenance",
        "cleaning",
      ],
      room_type: ["single", "double", "suite", "deluxe", "presidential"],
      staff_role: [
        "manager",
        "receptionist",
        "housekeeping",
        "security",
        "maintenance",
        "waiter",
        "barman",
        "chef",
      ],
    },
  },
} as const
