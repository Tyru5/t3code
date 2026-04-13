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
        >
          {isElectron ? (
            <span className="inline-flex items-center gap-2 text-xs text-muted-foreground/56 wco:pr-[calc(100vw-env(titlebar-area-width)-env(titlebar-area-x)+1em)]">
              <TerminalSquareIcon className="size-3.5 text-muted-foreground/48" />
              <span>No active thread</span>
            </span>
          ) : (
            <div className="flex items-center gap-2">
              <SidebarTrigger className="size-7 shrink-0 md:hidden" />
              <span className="inline-flex items-center gap-2 text-sm font-medium text-foreground md:text-muted-foreground/60">
                <TerminalSquareIcon className="size-3.5 text-muted-foreground/56" />
                No active thread
              </span>
            </div>
          )}
        </header>

        <ThreadEmptyState variant="logo" className="flex-1" />
      </div>
    </SidebarInset>
  );
}
