import { ReactNode, useState } from "react";
import { Sidebar } from "./Sidebar";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { LogOut, Menu } from "lucide-react";
import { useRealtimePermissions } from "@/hooks/useRealtimePermissions";
import { useStaffSession } from "@/contexts/StaffSessionContext";
import { Sheet, SheetContent, SheetTrigger, SheetTitle } from "@/components/ui/sheet";
import { ScrollArea } from "@/components/ui/scroll-area";

interface LayoutProps {
  children: ReactNode;
  disableScroll?: boolean;
}

export function Layout({ children, disableScroll = false }: LayoutProps) {
  const { user, signOut } = useAuth();
  const { activeStaff, isStaffLoggedIn, logoutStaff } = useStaffSession();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  useRealtimePermissions();

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-background">
      <div className="hidden md:block fixed left-0 top-0 w-4 h-full z-40 group">
        <div className="fixed left-0 top-0 h-full z-50 -translate-x-full group-hover:translate-x-0 transition-transform duration-300 ease-in-out">
          <Sidebar />
        </div>
      </div>
      <div className="md:hidden fixed left-2 top-2 z-50">
        <Sheet open={mobileMenuOpen} onOpenChange={setMobileMenuOpen}>
          <SheetTrigger asChild>
            <Button variant="outline" size="icon" className="bg-background/80 backdrop-blur-sm shadow-md">
              <Menu className="h-5 w-5" />
              <span className="sr-only">Toggle menu</span>
            </Button>
          </SheetTrigger>
          <SheetContent side="left" className="p-0 w-72">
            <SheetTitle className="sr-only">Navigation Menu</SheetTitle>
            <div className="h-full overflow-y-auto" onClick={() => setMobileMenuOpen(false)}>
              <Sidebar />
            </div>
          </SheetContent>
        </Sheet>
      </div>
      <main className="flex-1 flex flex-col min-h-0 w-full bg-background overflow-hidden">
        {!disableScroll && (
          <div className="flex justify-end items-center gap-2 p-2 shrink-0 pr-4 border-b border-border/50">
            {user && (
              <Button
                variant="ghost"
                size="icon"
                onClick={signOut}
                className="h-9 w-9 rounded-full bg-slate-100 hover:bg-rose-50 hover:text-rose-600 transition-all group"
                title="Sign Out Account"
              >
                <LogOut className="h-4 w-4 transition-transform group-hover:scale-110" />
              </Button>
            )}
            {isStaffLoggedIn && (
              <div className="flex items-center gap-3">
                <div className="hidden sm:flex flex-col items-end mr-2">
                  <span className="text-[10px] font-black uppercase text-slate-400 leading-none">Logged In Staff</span>
                  <span className="text-xs font-bold text-slate-900">
                    {activeStaff?.first_name} {activeStaff?.last_name}
                  </span>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={logoutStaff}
                  className="h-9 w-9 rounded-full bg-slate-100 hover:bg-red-50 hover:text-red-600 transition-all group"
                  title="Logout Staff PIN"
                >
                  <LogOut className="h-4 w-4 transition-transform group-hover:scale-110" />
                </Button>
              </div>
            )}
          </div>
        )}
        <div className="flex-1 flex flex-col min-h-0 relative">
          {disableScroll ? (
            <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
              {children}
            </div>
          ) : (
            <ScrollArea className="flex-1">
              <div className="p-4 md:p-6 lg:p-8">
                {children}
              </div>
            </ScrollArea>
          )}
        </div>
      </main>
    </div>
  );
}