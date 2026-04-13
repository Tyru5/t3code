import { APP_BASE_NAME } from "../branding";
import { IrisWordmark } from "./IrisWordmark";

export function SplashScreen() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <div
        className="flex h-20 items-center justify-center"
        aria-label={`${APP_BASE_NAME} splash screen`}
      >
        <IrisWordmark className="h-8 text-foreground" />
      </div>
    </div>
  );
}
