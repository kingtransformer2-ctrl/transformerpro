import { useEffect } from "react";
import { useStaffSession } from "@/contexts/StaffSessionContext";
import { useNavigate } from "react-router-dom";

export function ShiftStartScreen() {
  const { activeStaff, logoutStaff } = useStaffSession();
  const navigate = useNavigate();

  // If this screen ever gets shown, just redirect back immediately
  useEffect(() => {
    if (activeStaff) {
      // Redirect to staff's home page
      navigate(-1); // Go back to previous page
    }
  }, [activeStaff, navigate]);

  return null; // Don't show anything
}
