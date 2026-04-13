import { TerminalSquareIcon } from "lucide-react";
import { SidebarInset, SidebarTrigger } from "./ui/sidebar";
import { isElectron } from "../env";
import { cn } from "~/lib/utils";
import { ThreadEmptyState } from "./ThreadEmptyState";

export function NoActiveThreadState() {
  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none bg-background text-foreground">
      <div
        className="flex min-h-0 min-w-0 flex-1 flex-col overflow-x-hidden bg-background"
        data-testid="no-active-thread-state"
      >
        <header
          className={cn(
            "border-b border-border px-3 sm:px-5",
            isElectron
              ? "drag-region flex h-[52px] items-center wco:h-[env(titlebar-area-height)]"
              : "py-2 sm:py-3",
          )}
        ></header>

        <ThreadEmptyState variant="logo" className="flex-1" />
      </div>
    </SidebarInset>
  );
}
