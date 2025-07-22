import Image from "next/image";
import { useTheme } from "@/hooks/useTheme";

export function ThemedRybbitTextLogo(props: Omit<React.ComponentProps<typeof Image>, "src">) {
  const theme = useTheme();
  return (
    <Image
      src={theme === "dark" ? "/rybbit-text.svg" : "/rybbit-text-black.svg"}
      {...props}
    />
  );
}
