import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@/integrations/supabase/client";
import { HotelStaffAttendance } from "@/types/hotel";
import { toast } from "sonner";

type AttendanceUpdatePayload = {
  id: string;
  check_out_time?: string | null;
  status?: string;
  notes?: string | null;
  is_active?: boolean;
  worked_hours?: number | null;
};

function getWorkedHours(start?: string | null, end?: string | null) {
  if (!start || !end) return null;
  const startMs = new Date(start).getTime();
  const endMs = new Date(end).getTime();
  if (Number.isNaN(startMs) || Number.isNaN(endMs) || endMs <= startMs) return 0;
  return Number((((endMs - startMs) / 1000 / 60 / 60) as number).toFixed(2));
}

function getBusinessDate(date = new Date()) {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

async function getAttendanceByShiftId(shiftId?: string | null) {
  if (!shiftId) return null;

  const { data, error } = await apiClient
    .from("hotel_staff_attendance")
    .select("*")
    .eq("shift_id", shiftId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return (data || null) as HotelStaffAttendance | null;
}

// Safely resolve shift from RPC response — handles UUID string or full object
async function resolveShiftFromRpcData(data: any) {
  if (!data) return null;

  // RPC returned a plain UUID string
  if (typeof data === 'string') {
    const { data: shiftData, error } = await apiClient
      .from("hotel_staff_shifts")
      .select("*")
      .eq("id", data)
      .single();
    if (error) throw error;
    return shiftData;
  }

  // RPC returned a full shift object
  if (typeof data === 'object' && data !== null && typeof data.id === 'string') {
    return data;
  }

  return null;
}

export function useHotelAttendance(date?: string) {
  return useQuery({
    queryKey: ["hotel-attendance", date || "all"],
    queryFn: async () => {
      let query = apiClient
        .from("hotel_staff_attendance")
        .select("*, staff:hotel_staff(*)")
        .order("date", { ascending: false })
        .order("created_at", { ascending: false });

      if (date) {
        query = query.eq("date", date);
      }

      const { data, error } = await query;
      if (error) throw error;
      return (data || []) as HotelStaffAttendance[];
    },
  });
}

export function useTodayHotelAttendance() {
  const today = new Date().toISOString().split("T")[0];
  return useHotelAttendance(today);
}

export function useConfirmAttendanceAvailability() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (params: {
      staffId: string;
      staffRole: string;
      shiftLabel: string;
      notes?: string | null;
    }) => {
      const now = new Date();
      const nowIso = now.toISOString();
      const today = getBusinessDate(now);
      const normalizedRole = params.staffRole.toLowerCase() as any;

      // 1. Check for existing open shift first
      const { data: existingShift, error: existingShiftError } = await apiClient
        .from("hotel_staff_shifts")
        .select("*")
        .eq("staff_id", params.staffId)
        .is("closed_at", null)
        .order("opened_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (existingShiftError) throw existingShiftError;

      let shift = existingShift as any;

      // 2. If no open shift, create one via RPC
      if (!shift) {
        const rpcPayload = {
          p_staff_id: params.staffId,
          p_staff_role: normalizedRole,
          p_shift_label: params.shiftLabel,
          p_opening_notes: params.notes || "Attendance confirmed from attendance management",
        };

        const { data: rpcResult, error: createShiftError } = await apiClient.rpc(
          'open_hotel_staff_shift' as any,
          rpcPayload
        );

        if (createShiftError) {
          // Shift already exists — fetch it as fallback
          if (createShiftError.code === "23505" || createShiftError.message?.includes("open shift")) {
            const { data: fallbackShift, error: fallbackShiftError } = await apiClient
              .from("hotel_staff_shifts")
              .select("*")
              .eq("staff_id", params.staffId)
              .is("closed_at", null)
              .order("opened_at", { ascending: false })
              .limit(1)
              .maybeSingle();

            if (fallbackShiftError) throw fallbackShiftError;
            shift = fallbackShift as any;
          } else {
            throw createShiftError;
          }
        } else if (rpcResult) {
          // RPC may return UUID string or full object — handle both
          shift = await resolveShiftFromRpcData(rpcResult);
        }
      }

      // 3. Check if attendance already exists for this shift
      const shiftAttendance = await getAttendanceByShiftId(shift?.id);

      if (shiftAttendance) {
        const { data: updatedAttendance, error: updateAttendanceError } = await apiClient
          .from("hotel_staff_attendance")
          .update({
            status: "active",
            is_active: true,
            source: shiftAttendance.source || "attendance-management",
            notes: params.notes ?? shiftAttendance.notes,
          })
          .eq("id", shiftAttendance.id)
          .select()
          .single();

        if (updateAttendanceError) throw updateAttendanceError;
        return { shift, attendance: updatedAttendance as HotelStaffAttendance };
      }

      // 4. Check for any active attendance today
      const { data: activeAttendance, error: activeAttendanceError } = await apiClient
        .from("hotel_staff_attendance")
        .select("*")
        .eq("staff_id", params.staffId)
        .eq("date", today)
        .eq("is_active", true)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (activeAttendanceError) throw activeAttendanceError;

      if (activeAttendance) {
        if (shift?.id && activeAttendance.shift_id !== shift.id) {
          const { data: updatedAttendance, error: updateAttendanceError } = await apiClient
            .from("hotel_staff_attendance")
            .update({
              shift_id: shift.id,
              status: "active",
              is_active: true,
              notes: params.notes ?? activeAttendance.notes,
            })
            .eq("id", activeAttendance.id)
            .select()
            .single();

          if (updateAttendanceError) throw updateAttendanceError;
          return { shift, attendance: updatedAttendance as HotelStaffAttendance };
        }

        return { shift, attendance: activeAttendance as HotelStaffAttendance };
      }

      // 5. Create new attendance record
      const { data: attendanceRecord, error: createAttendanceError } = await apiClient
        .from("hotel_staff_attendance")
        .insert([
          {
            staff_id: params.staffId,
            shift_id: shift?.id || null,
            date: today,
            check_in_time: nowIso,
            status: "active",
            is_active: true,
            source: "attendance-management",
            notes: params.notes || "Confirmed available from attendance management",
          },
        ])
        .select()
        .single();

      if (createAttendanceError) {
        if (createAttendanceError.code === "23505" && shift?.id) {
          const existingAttendance = await getAttendanceByShiftId(shift.id);
          if (existingAttendance) {
            return { shift, attendance: existingAttendance };
          }
        }
        throw createAttendanceError;
      }

      return { shift, attendance: attendanceRecord as HotelStaffAttendance };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["hotel-attendance"] });
      queryClient.invalidateQueries({ queryKey: ["hotel-shifts"] });
      toast.success("Attendance confirmed and shift opened");
    },
    onError: (error: Error) => toast.error(error.message),
  });
}

export function useCloseAttendanceEntry() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, notes }: { id: string; notes?: string | null }) => {
      const { data: existing, error: existingError } = await apiClient
        .from("hotel_staff_attendance")
        .select("*")
        .eq("id", id)
        .single();

      if (existingError) throw existingError;

      const now = new Date().toISOString();
      const workedHours = getWorkedHours(existing.check_in_time, now);

      const { data, error } = await apiClient
        .from("hotel_staff_attendance")
        .update({
          check_out_time: now,
          status: "completed",
          is_active: false,
          notes: notes ?? existing.notes,
          worked_hours: workedHours,
        })
        .eq("id", id)
        .select()
        .single();

      if (error) throw error;
      return data as HotelStaffAttendance;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["hotel-attendance"] });
      toast.success("Attendance closed");
    },
    onError: (error: Error) => toast.error(error.message),
  });
}

export function useUpdateAttendanceEntry() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (payload: AttendanceUpdatePayload) => {
      const { id, ...rest } = payload;
      const { data, error } = await apiClient
        .from("hotel_staff_attendance")
        .update(rest)
        .eq("id", id)
        .select()
        .single();

      if (error) throw error;
      return data as HotelStaffAttendance;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["hotel-attendance"] });
      toast.success("Attendance updated");
    },
    onError: (error: Error) => toast.error(error.message),
  });
}
