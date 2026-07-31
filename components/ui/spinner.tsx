import * as React from "react"

import { cn } from "@/lib/utils"

function Spinner({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span
      role="status"
      aria-label="Loading"
      className={cn(
        "inline-block size-3 animate-orbit rounded-full border-2 border-current border-t-transparent",
        className
      )}
      {...props}
    />
  )
}

export { Spinner }
