import { Loader2 } from "lucide-react";

export function LoadingState({ label }: { label: string }) {
  return (
    <div className="state">
      <Loader2 className="spin" size={24} />
      <span>{label}</span>
    </div>
  );
}

export function ErrorState({ message }: { message: string }) {
  return (
    <div className="state error">
      <strong>Unable to load</strong>
      <span>{message}</span>
    </div>
  );
}
